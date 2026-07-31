"""Backend adapter registry built on shared manifest."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from scale_registry_contract import (
    compile_stub_contract,
    load_catalog_contract,
    validate_portable_regex,
)

BUILTIN_ADAPTER_IDS = {'microsim-m0601', 'newton', 'cas', 'midl-mi-vda'}
_RUNTIME_FRAME_MAX_LENGTH = 1024


def load_adapter_catalog() -> dict[str, Any]:
    """Load adapter catalog from the shared manifest."""
    return load_catalog_contract()


def list_adapters() -> dict[str, Any]:
    """List adapters with schema version from manifest."""
    catalog = load_adapter_catalog()
    return {
        'adapter_schema_version': catalog['adapter_schema_version'],
        'adapters': catalog['adapters'],
    }


def get_adapter_schema(adapter_id: str, transport: str) -> dict[str, list[str]]:
    """Return stub transport/parser field schema for adapter configuration."""
    catalog = load_adapter_catalog()
    adapter = next((item for item in catalog['adapters'] if item['id'] == adapter_id), None)
    if adapter is None:
        raise ValueError(f'Unknown adapter_id: {adapter_id}')

    transport_fields = {
        'web_serial': [],
        'serial_backend': [
            'serial.port',
            'serial.baud_rate',
            'serial.data_bits',
            'serial.stop_bits',
            'serial.parity',
            'serial.line_terminator',
            'serial.read_timeout_ms',
        ],
        'tcp_client': ['tcp.host', 'tcp.port', 'tcp.connect_timeout_ms'],
    }.get(transport, [])

    parser_fields = (
        [
            'parser.kind',
            'parser.pattern',
            'parser.flags',
            'parser.weight_group',
            'parser.stability_group',
            'parser.stable_values',
            'parser.unstable_values',
            'parser.unit_group',
            'parser.validation_status',
            'parser.last_validation_at',
            'parser.validation_error_code',
            'parser.validation_error_message',
        ]
        if adapter_id == 'generic-regex'
        else ['parser.kind']
    )
    return {
        'transport_fields': transport_fields,
        'parser_fields': parser_fields,
    }


def validate_draft(adapter_id: str, draft: dict[str, Any]) -> dict[str, Any]:
    """Validate draft transport support against manifest."""
    resolved_adapter_id = _resolve_adapter_id(adapter_id, draft)
    catalog = load_adapter_catalog()
    adapter = next((item for item in catalog['adapters'] if item['id'] == resolved_adapter_id), None)
    if adapter is None:
        raise ValueError(f'Unknown adapter_id: {resolved_adapter_id}')
    transport = draft.get('transport')
    errors: list[str] = []
    if transport not in adapter['transports']:
        errors.append(f'transport_not_supported:{transport}')
    if resolved_adapter_id in BUILTIN_ADAPTER_IDS:
        if draft.get('device_id') != resolved_adapter_id:
            errors.append(f'device_id_mismatch:{resolved_adapter_id}')
        if transport not in ('web_serial', 'serial_backend'):
            errors.append(f'transport_not_supported:{transport}')
    return {'valid': len(errors) == 0, 'errors': errors}


def validate_connection(adapter_id: str, connection: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate connection and return list of API-style errors."""
    resolved_adapter_id = _resolve_adapter_id(adapter_id, connection)
    result = validate_draft(adapter_id, connection)
    errors = [{'code': code} for code in result['errors']]
    if resolved_adapter_id == 'generic-regex':
        parser = connection.get('parser') if isinstance(connection.get('parser'), dict) else {}
        test_frame = parser.get('test_frame')
        validation = validate_portable_regex(
            connection,
            test_frame if isinstance(test_frame, str) and test_frame.strip() else None,
        )
        _apply_parser_validation(connection, validation)
        if not validation['valid']:
            errors.append(
                {
                    'code': validation.get('validation_error_code') or 'invalid_connection_config',
                    'message': validation.get('validation_error_message') or 'Некорректная regex-конфигурация',
                }
            )
    return errors


def parse_reading(adapter_id: str, raw: str, connection: dict[str, Any]) -> dict[str, Any] | None:
    """Parse reading for built-in adapters."""
    resolved_adapter_id = _resolve_adapter_id(adapter_id, connection)
    adapter_ids = {item['id'] for item in load_adapter_catalog()['adapters']}
    if resolved_adapter_id not in adapter_ids:
        raise ValueError(f'Unknown adapter_id: {resolved_adapter_id}')
    parser = _PARSERS.get(resolved_adapter_id)
    if parser is None:
        return _parse_generic_regex(raw, connection)
    return parser(raw, connection)


def _resolve_adapter_id(adapter_id: str, connection: dict[str, Any]) -> str:
    if adapter_id == 'web_serial':
        device_id = connection.get('device_id')
        if isinstance(device_id, str) and device_id:
            return device_id
    return adapter_id


def _normalize_number(raw: str) -> float | None:
    candidate = raw.replace(' ', '').replace(',', '.')
    try:
        return float(candidate)
    except (TypeError, ValueError):
        return None


def _match_frame(
    pattern: str,
    raw: str,
    *,
    weight_group: int,
    unit_group: int | None,
    state_group: int | None = 1,
) -> dict[str, Any] | None:
    import re

    frame = raw.strip()
    if not frame:
        return None
    match = re.match(pattern, frame, re.IGNORECASE)
    if not match:
        return None
    weight_raw = match.group(weight_group)
    value = _normalize_number(weight_raw)
    if value is None:
        return None
    state = (match.group(state_group) if state_group else None) or 'ST'
    unit = (match.group(unit_group) if unit_group else None) or 'kg'
    return {
        'value': value,
        'stable': state.upper() == 'ST',
        'raw': frame,
        'unit': unit.lower(),
        'negative': value < 0,
    }


def _strip_terminator(raw: str, connection: dict[str, Any]) -> str:
    serial = connection.get('serial')
    terminator = serial.get('line_terminator') if isinstance(serial, dict) else None
    if isinstance(terminator, str) and terminator and raw.endswith(terminator):
        return raw[: -len(terminator)].strip()
    return raw.strip()


def _parse_microsim(raw: str, _connection: dict[str, Any]) -> dict[str, Any] | None:
    return _match_frame(
        r'^(ST|US)\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$',
        raw,
        weight_group=2,
        unit_group=3,
    )


def _parse_newton(raw: str, _connection: dict[str, Any]) -> dict[str, Any] | None:
    return _match_frame(
        r'^(ST|US|MOT|UNST)?\s*,?\s*(GS|NT|GROSS|NET)?\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$',
        raw,
        weight_group=3,
        unit_group=4,
    )


def _parse_cas(raw: str, connection: dict[str, Any]) -> dict[str, Any] | None:
    frame = _strip_terminator(raw, connection)
    return _match_frame(
        r'^(ST|US|MOT|UNST)?\s*,?\s*(GS|NT)?\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$',
        frame,
        weight_group=3,
        unit_group=4,
    )


def _parse_midl(raw: str, _connection: dict[str, Any]) -> dict[str, Any] | None:
    return _match_frame(
        r'^(ST|US|MOT|UNST)?\s*,?\s*(GS|NT|GROSS|NET)?\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$',
        raw,
        weight_group=3,
        unit_group=4,
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _ensure_parser(connection: dict[str, Any]) -> dict[str, Any]:
    parser = connection.get('parser')
    if not isinstance(parser, dict):
        parser = {}
        connection['parser'] = parser
    return parser


def _apply_parser_validation(connection: dict[str, Any], validation: dict[str, Any]) -> None:
    parser = _ensure_parser(connection)
    parser['validation_status'] = validation.get('validation_status')
    parser['last_validation_at'] = _now_iso()
    parser['validation_error_code'] = validation.get('validation_error_code')
    parser['validation_error_message'] = validation.get('validation_error_message')


def _to_flags(flags: str) -> int:
    result = 0
    if 'i' in flags:
        result |= re.IGNORECASE
    if 'm' in flags:
        result |= re.MULTILINE
    if 's' in flags:
        result |= re.DOTALL
    return result


def _parse_generic_regex(raw: str, connection: dict[str, Any]) -> dict[str, Any] | None:
    parser = _ensure_parser(connection)
    frame = raw.strip()
    if len(frame) > _RUNTIME_FRAME_MAX_LENGTH:
        parser['validation_status'] = 'runtime_failed'
        parser['last_validation_at'] = _now_iso()
        parser['validation_error_code'] = 'runtime_frame_too_large'
        parser['validation_error_message'] = (
            f'Длина runtime-кадра превышает {_RUNTIME_FRAME_MAX_LENGTH} символов'
        )
        return None

    pattern = parser.get('pattern')
    if not isinstance(pattern, str) or not pattern:
        parser['validation_status'] = 'runtime_failed'
        parser['last_validation_at'] = _now_iso()
        parser['validation_error_code'] = None
        parser['validation_error_message'] = 'parse_mismatch'
        return None
    flags = parser.get('flags')
    flags_text = flags if isinstance(flags, str) else ''
    try:
        expression = re.compile(pattern, _to_flags(flags_text))
    except re.error:
        parser['validation_status'] = 'runtime_failed'
        parser['last_validation_at'] = _now_iso()
        parser['validation_error_code'] = 'regex_non_portable'
        parser['validation_error_message'] = 'runtime_compile_error'
        return None

    match = expression.search(frame)
    if match is None:
        parser['validation_status'] = 'runtime_failed'
        parser['last_validation_at'] = _now_iso()
        parser['validation_error_code'] = None
        parser['validation_error_message'] = 'parse_mismatch'
        return None

    weight_group = parser.get('weight_group', 1)
    if not isinstance(weight_group, int) or weight_group <= 0 or weight_group > len(match.groups()):
        parser['validation_status'] = 'runtime_failed'
        parser['last_validation_at'] = _now_iso()
        parser['validation_error_code'] = 'regex_group_index_out_of_range'
        parser['validation_error_message'] = 'weight_group не найден'
        return None

    weight_raw = match.group(weight_group) or ''
    value = _normalize_number(weight_raw)
    if value is None:
        parser['validation_status'] = 'runtime_failed'
        parser['last_validation_at'] = _now_iso()
        parser['validation_error_code'] = None
        parser['validation_error_message'] = 'parse_mismatch'
        return None

    stability_group = parser.get('stability_group')
    stable_values = {
        str(item).upper() for item in (parser.get('stable_values') or ['ST']) if str(item).strip()
    }
    unstable_values = {
        str(item).upper() for item in (parser.get('unstable_values') or ['US']) if str(item).strip()
    }
    stable = True
    if isinstance(stability_group, int) and stability_group > 0 and stability_group <= len(match.groups()):
        stability_raw = (match.group(stability_group) or '').upper()
        if stability_raw in unstable_values:
            stable = False
        elif stable_values:
            stable = stability_raw in stable_values

    unit_group = parser.get('unit_group')
    unit = None
    if isinstance(unit_group, int) and unit_group > 0 and unit_group <= len(match.groups()):
        unit_raw = match.group(unit_group) or ''
        unit = unit_raw.strip().lower() or None

    parser['validation_status'] = 'runtime_validated'
    parser['last_validation_at'] = _now_iso()
    parser['validation_error_code'] = None
    parser['validation_error_message'] = None
    return {
        'value': value,
        'stable': stable,
        'raw': frame,
        'unit': unit,
        'negative': value < 0,
    }


_PARSERS = {
    'microsim-m0601': _parse_microsim,
    'newton': _parse_newton,
    'cas': _parse_cas,
    'midl-mi-vda': _parse_midl,
}


def load_registry_contract_status() -> dict[str, Any]:
    """Expose backend stub compile-check status."""
    return compile_stub_contract()
