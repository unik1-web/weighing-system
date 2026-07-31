"""Shared manifest contract for frontend/backend adapter registries."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _catalog_path() -> Path:
    """Return absolute path to shared adapter catalog manifest."""
    return Path(__file__).resolve().parent.parent / 'shared' / 'scale-adapters' / 'catalog.json'


def load_catalog_contract() -> dict[str, Any]:
    """Load catalog JSON as a plain contract dictionary."""
    path = _catalog_path()
    with path.open('r', encoding='utf-8') as handle:
        return json.load(handle)


def compile_stub_contract() -> dict[str, Any]:
    """Return a stub compile-check result for current stage."""
    return {
        'ok': True,
        'details': 'stub_contract_ready',
    }


_PATTERN_MAX_LENGTH = 512
_TEST_FRAME_MAX_LENGTH = 4096
_RUNTIME_FRAME_MAX_LENGTH = 1024
_ALLOWED_FLAGS = {'i', 'm', 's'}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _has_non_portable_constructs(pattern: str) -> bool:
    checks = [
        r'(?<!\\)\(\?<[=!]',
        r'(?<!\\)\(\?<[^=!]',
        r'(?<!\\)\(\?P<',
        r'(?<!\\)\(\?P=',
        r'(?<!\\)\\k<',
        r'(?<!\\)\\[1-9]',
        r'(?<!\\)\(\?\(',
        r'(?<!\\)\(\?>',
    ]
    return any(re.search(rule, pattern) is not None for rule in checks)


def _flags_to_re(flags: str) -> tuple[int, bool]:
    seen: set[str] = set()
    result = 0
    for flag in flags:
        if flag not in _ALLOWED_FLAGS or flag in seen:
            return 0, False
        seen.add(flag)
        if flag == 'i':
            result |= re.IGNORECASE
        elif flag == 'm':
            result |= re.MULTILINE
        elif flag == 's':
            result |= re.DOTALL
    return result, True


def _count_capturing_groups(pattern: str) -> int:
    count = 0
    escaped = False
    in_class = False
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if escaped:
            escaped = False
            index += 1
            continue
        if char == '\\':
            escaped = True
            index += 1
            continue
        if char == '[' and not in_class:
            in_class = True
            index += 1
            continue
        if char == ']' and in_class:
            in_class = False
            index += 1
            continue
        if in_class:
            index += 1
            continue
        if char == '(':
            if index + 1 < len(pattern) and pattern[index + 1] == '?':
                index += 1
                continue
            count += 1
        index += 1
    return count


def _valid_group(group: Any, group_count: int) -> bool:
    if group is None:
        return True
    if not isinstance(group, int):
        return False
    return 1 <= group <= group_count


def _to_weight(raw: str) -> float | None:
    value = raw.replace(' ', '').replace(',', '.')
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _base_result() -> dict[str, Any]:
    return {
        'valid': False,
        'validation_status': 'runtime_failed',
        'validation_error_code': None,
        'validation_error_message': None,
        'preview_reading': None,
    }


def validate_portable_regex(connection: dict[str, Any], test_frame: str | None) -> dict[str, Any]:
    """Validate portable regex contract compatible with JS and Python runtimes."""
    result = _base_result()
    parser = connection.get('parser') if isinstance(connection.get('parser'), dict) else {}
    pattern = str(parser.get('pattern') or '').strip()
    flags = str(parser.get('flags') or '').strip()

    if not pattern:
        result['validation_error_message'] = 'parser.pattern обязателен'
        return result
    if len(pattern) > _PATTERN_MAX_LENGTH:
        result['validation_error_code'] = 'regex_pattern_too_long'
        result['validation_error_message'] = (
            f'Длина parser.pattern не должна превышать {_PATTERN_MAX_LENGTH} символов'
        )
        return result
    re_flags, flags_ok = _flags_to_re(flags)
    if not flags_ok:
        result['validation_error_code'] = 'regex_non_portable'
        result['validation_error_message'] = 'Допустимы только флаги i, m, s без повторов'
        return result
    if _has_non_portable_constructs(pattern):
        result['validation_error_code'] = 'regex_non_portable'
        result['validation_error_message'] = 'Regex содержит non-portable конструкции'
        return result
    try:
        expression = re.compile(pattern, re_flags)
    except re.error as exc:
        result['validation_error_code'] = 'regex_non_portable'
        result['validation_error_message'] = str(exc)
        return result

    group_count = _count_capturing_groups(pattern)
    weight_group = parser.get('weight_group', 1)
    if not _valid_group(weight_group, group_count):
        result['validation_error_code'] = 'regex_group_index_out_of_range'
        result['validation_error_message'] = 'weight_group выходит за пределы capture-групп'
        return result
    if not _valid_group(parser.get('stability_group'), group_count):
        result['validation_error_code'] = 'regex_group_index_out_of_range'
        result['validation_error_message'] = 'stability_group выходит за пределы capture-групп'
        return result
    if not _valid_group(parser.get('unit_group'), group_count):
        result['validation_error_code'] = 'regex_group_index_out_of_range'
        result['validation_error_message'] = 'unit_group выходит за пределы capture-групп'
        return result

    if test_frame:
        if len(test_frame) > _TEST_FRAME_MAX_LENGTH:
            result['validation_error_code'] = 'regex_test_frame_too_large'
            result['validation_error_message'] = (
                f'Длина test_frame не должна превышать {_TEST_FRAME_MAX_LENGTH} символов'
            )
            return result
        matched = expression.search(test_frame.strip())
        if matched is None:
            result['validation_error_message'] = 'test_frame не позволяет извлечь числовой вес'
            return result
        if not isinstance(weight_group, int) or weight_group >= len(matched.groups()) + 1:
            result['validation_error_code'] = 'regex_group_index_out_of_range'
            result['validation_error_message'] = 'weight_group не найден в результате матча'
            return result
        raw_weight = matched.group(weight_group) or ''
        value = _to_weight(raw_weight)
        if value is None:
            result['validation_error_message'] = 'test_frame не позволяет извлечь числовой вес'
            return result

        stability_group = parser.get('stability_group')
        stable_values = {
            str(item).upper() for item in (parser.get('stable_values') or ['ST']) if str(item).strip()
        }
        unstable_values = {
            str(item).upper() for item in (parser.get('unstable_values') or ['US']) if str(item).strip()
        }
        stable = True
        if isinstance(stability_group, int) and stability_group > 0:
            stability_raw = (matched.group(stability_group) or '').upper()
            if stability_raw in unstable_values:
                stable = False
            elif stable_values:
                stable = stability_raw in stable_values

        unit_group = parser.get('unit_group')
        unit = None
        if isinstance(unit_group, int) and unit_group > 0:
            unit_raw = matched.group(unit_group) or ''
            unit = unit_raw.strip().lower() or None

        result.update(
            {
                'valid': True,
                'validation_status': 'preview_validated',
                'preview_reading': {
                    'value': value,
                    'stable': stable,
                    'raw': test_frame.strip(),
                    'unit': unit,
                    'negative': value < 0,
                },
            }
        )
        return result

    result.update(
        {
            'valid': True,
            'validation_status': 'pending_runtime',
        }
    )
    return result


def run_builtin_parity_check(fixtures_path: str) -> list[dict[str, Any]]:
    """Compare backend built-in parser output with shared fixture expectations."""
    from scale_registry import parse_reading

    path = Path(fixtures_path)
    with path.open('r', encoding='utf-8') as handle:
        payload = json.load(handle)
    cases = payload.get('cases', [])
    mismatches: list[dict[str, Any]] = []
    for case in cases:
        adapter_id = case.get('adapter_id')
        raw = case.get('raw', '')
        connection = case.get('connection', {})
        expected = case.get('expected')
        actual = parse_reading(adapter_id, raw, connection)
        if actual is None and expected is None:
            continue
        if actual is None or expected is None:
            mismatches.append(
                {
                    'case': case.get('name', '<unnamed>'),
                    'adapter_id': adapter_id,
                    'reason': 'null_mismatch',
                    'expected': expected,
                    'actual': actual,
                }
            )
            continue
        if (
            actual.get('value') != expected.get('value')
            or actual.get('stable') != expected.get('stable')
            or actual.get('raw') != expected.get('raw')
        ):
            mismatches.append(
                {
                    'case': case.get('name', '<unnamed>'),
                    'adapter_id': adapter_id,
                    'reason': 'value_stable_raw_mismatch',
                    'expected': {
                        'value': expected.get('value'),
                        'stable': expected.get('stable'),
                        'raw': expected.get('raw'),
                    },
                    'actual': {
                        'value': actual.get('value'),
                        'stable': actual.get('stable'),
                        'raw': actual.get('raw'),
                    },
                }
            )
    return mismatches
