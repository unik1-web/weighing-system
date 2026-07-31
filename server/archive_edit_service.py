"""Archive ticket edit service: whitelist PATCH, recalculation and audit."""

from __future__ import annotations

from typing import Any

from persistence import read_active_year
from sqlite_store import (
    connect,
    insert_ticket_audit_event,
    read_archive_ticket_for_update,
    save_archive_ticket_edit,
)
from stage6_logging import log_stage6_event
from ticket_audit_stage6 import build_archive_edit_audit_event
from year_context import ArchiveContractError, resolve_db_context


def _actor_log_fields(actor: dict[str, Any] | None) -> dict[str, Any]:
    """Extract operator identity for operational logs."""
    if not isinstance(actor, dict):
        return {}
    name = (
        actor.get('display_name')
        or actor.get('username')
        or actor.get('name')
        or actor.get('operator_name')
    )
    return {
        'operator_id': actor.get('id') or actor.get('operator_id'),
        'operator_name': name,
    }

ARCHIVE_EDIT_ALLOWLIST: frozenset[str] = frozenset(
    {
        'vehicle_number',
        'vehicle_brand',
        'trailer_number',
        'driver_name',
        'cargo_name',
        'shipper_name',
        'receiver_name',
        'carrier_name',
        'gross_weight',
        'tare_weight',
        'notes',
    }
)

ARCHIVE_EDIT_STRING_FIELDS: frozenset[str] = frozenset(
    {
        'vehicle_number',
        'vehicle_brand',
        'trailer_number',
        'driver_name',
        'cargo_name',
        'shipper_name',
        'receiver_name',
        'carrier_name',
        'notes',
    }
)

ARCHIVE_EDIT_WEIGHT_FIELDS: frozenset[str] = frozenset({'gross_weight', 'tare_weight'})


def validate_archive_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """
    Validate archive PATCH payload against the UC-05 allowlist.

    Args:
        patch: Raw patch object from the API body.

    Returns:
        The same patch when every key is allowlisted.

    Raises:
        ArchiveContractError: `archive_edit_forbidden_field` for unknown/denied keys.
    """
    if not isinstance(patch, dict):
        raise ArchiveContractError(
            'archive_edit_forbidden_field',
            'Некорректный формат patch',
            422,
        )
    forbidden = sorted(key for key in patch.keys() if key not in ARCHIVE_EDIT_ALLOWLIST)
    if forbidden:
        raise ArchiveContractError(
            'archive_edit_forbidden_field',
            f'Запрещено изменять поле {forbidden[0]}',
            422,
        )
    return patch


def _normalize_string(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def _normalize_weight(value: Any, field: str) -> float:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ArchiveContractError(
            'archive_edit_validation_failed',
            f'Поле {field} не прошло бизнес-валидацию',
            422,
        )
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ArchiveContractError(
            'archive_edit_validation_failed',
            f'Поле {field} не прошло бизнес-валидацию',
            422,
        ) from exc
    if not (number == number) or number < 0:  # NaN check
        raise ArchiveContractError(
            'archive_edit_validation_failed',
            f'Поле {field} не прошло бизнес-валидацию',
            422,
        )
    return number


def normalize_archive_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize allowlisted patch values before diff comparison.

    Strings are stripped. Weight fields are converted to float and validated.
    Empty patch after validation is allowed here; callers treat empty diff as no-op.

    Args:
        patch: Allowlisted patch dict.

    Returns:
        Normalized patch subset.
    """
    normalized: dict[str, Any] = {}
    for key, value in patch.items():
        if key in ARCHIVE_EDIT_STRING_FIELDS:
            normalized[key] = _normalize_string(value)
        elif key in ARCHIVE_EDIT_WEIGHT_FIELDS:
            normalized[key] = _normalize_weight(value, key)
        else:
            normalized[key] = value
    return normalized


def _as_optional_float(value: Any) -> float | None:
    if value is None or value == '':
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _calculate_totals(
    *,
    gross_weight: float | None,
    tare_weight: float | None,
    price: float | None,
    vat_rate: float | None,
) -> tuple[float | None, float | None]:
    """
    Calculate net_weight and total_amount like ordinary completed tickets.

    Matches frontend `netWeight` / `totalAmount`: net = gross - tare,
    total = (net / 1000) * price. `vat_rate` is stored separately and is not
    folded into `total_amount`.
    """
    _ = vat_rate
    if gross_weight is None or tare_weight is None:
        return None, None
    net_weight = float(gross_weight) - float(tare_weight)
    total_amount = round((net_weight / 1000.0) * float(price or 0), 2)
    return net_weight, total_amount


def recalculate_archive_ticket(ticket: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """
    Apply allowlisted patch and recalculate derived weight/amount fields.

    Direct PATCH of `net_weight` / `total_amount` is rejected earlier by the
    allowlist. Recalculation runs whenever weights are present after merge.

    Args:
        ticket: Current archive ticket row.
        patch: Normalized allowlisted patch.

    Returns:
        Updated ticket dict (does not mutate the input).

    Raises:
        ArchiveContractError: when weights are contradictory after merge.
    """
    updated = dict(ticket)
    updated.update(patch)

    gross = _as_optional_float(updated.get('gross_weight'))
    tare = _as_optional_float(updated.get('tare_weight'))
    if gross is not None and tare is not None and gross < tare:
        raise ArchiveContractError(
            'archive_edit_validation_failed',
            'Поля gross_weight и tare_weight не прошли бизнес-валидацию',
            422,
        )

    if 'gross_weight' in patch or 'tare_weight' in patch or (
        gross is not None and tare is not None
    ):
        net_weight, total_amount = _calculate_totals(
            gross_weight=gross,
            tare_weight=tare,
            price=_as_optional_float(updated.get('price')),
            vat_rate=_as_optional_float(updated.get('vat_rate')),
        )
        if 'gross_weight' in patch or 'tare_weight' in patch:
            updated['net_weight'] = net_weight
            updated['total_amount'] = total_amount

    return updated


def _comparable_value(field: str, value: Any) -> Any:
    """Normalize ticket field values for no-op / diff comparison."""
    if field in ARCHIVE_EDIT_STRING_FIELDS:
        return _normalize_string(value)
    if field in ARCHIVE_EDIT_WEIGHT_FIELDS or field in {'net_weight', 'total_amount', 'price', 'vat_rate'}:
        return _as_optional_float(value)
    return value


def _build_diff(
    ticket_before: dict[str, Any],
    ticket_after: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """Compare before/after tickets and return old/new maps plus changed keys."""
    keys = sorted(
        set(ARCHIVE_EDIT_ALLOWLIST)
        | {'net_weight', 'total_amount'}
    )
    old_values: dict[str, Any] = {}
    new_values: dict[str, Any] = {}
    changed_fields: list[str] = []
    for key in keys:
        before = _comparable_value(key, ticket_before.get(key))
        after = _comparable_value(key, ticket_after.get(key))
        if before != after:
            changed_fields.append(key)
            old_values[key] = ticket_before.get(key)
            new_values[key] = ticket_after.get(key)
    return old_values, new_values, changed_fields


def apply_archive_edit(
    year: int,
    ticket_id: str,
    patch: dict[str, Any],
    actor: dict[str, Any],
    acknowledge_reo_sent_warning: bool,
) -> dict[str, Any]:
    """
    Apply admin archive ticket edit with transactional audit.

    Args:
        year: Archive year (YYYY) selecting `weighing-ГГГГ.db`.
        ticket_id: Ticket identifier inside the archive DB.
        patch: Raw allowlisted patch payload.
        actor: Authenticated session actor.
        acknowledge_reo_sent_warning: Explicit REO sent confirmation flag.

    Returns:
        API success payload with `ticket`, `audit_event` and optional warning.

    Raises:
        ArchiveContractError: validation, auth, missing ticket or REO ack errors.
    """
    actor_ctx = _actor_log_fields(actor)
    if not isinstance(actor, dict) or actor.get('role') != 'admin':
        log_stage6_event(
            'archive_edit',
            'error',
            source_year=int(year),
            reason='insufficient_permissions',
            ticket_id=ticket_id,
            **actor_ctx,
        )
        raise ArchiveContractError(
            'insufficient_permissions',
            'Недостаточно прав для выполнения операции',
            403,
        )

    try:
        validate_archive_patch(patch)
    except ArchiveContractError as exc:
        if exc.code == 'archive_edit_forbidden_field':
            log_stage6_event(
                'archive_edit',
                'forbidden',
                source_year=int(year),
                reason=exc.code,
                ticket_id=ticket_id,
                **actor_ctx,
            )
        raise
    normalized = normalize_archive_patch(patch)

    context = resolve_db_context('archive', year=year)
    if not context.exists:
        log_stage6_event(
            'archive_edit',
            'error',
            source_year=int(year),
            reason='archive_year_not_found',
            ticket_id=ticket_id,
            **actor_ctx,
        )
        raise ArchiveContractError(
            'archive_year_not_found',
            'Архивный файл за указанный год не найден',
            404,
        )
    active_year = read_active_year()
    if active_year is not None and int(year) >= int(active_year):
        log_stage6_event(
            'archive_edit',
            'error',
            source_year=int(year),
            target_year=int(active_year),
            reason='archive_year_not_found',
            ticket_id=ticket_id,
            **actor_ctx,
        )
        raise ArchiveContractError(
            'archive_year_not_found',
            'Архивный файл за указанный год не найден',
            404,
        )

    with connect(db_path=context.db_path, read_only=False) as connection:
        ticket_before = read_archive_ticket_for_update(connection, ticket_id)
        if ticket_before is None:
            log_stage6_event(
                'archive_edit',
                'error',
                source_year=int(year),
                db_path=context.db_path,
                reason='archive_ticket_not_found',
                ticket_id=ticket_id,
                **actor_ctx,
            )
            raise ArchiveContractError(
                'archive_ticket_not_found',
                'Архивный тикет не найден',
                404,
            )

        original_reo_status = str(ticket_before.get('reo_status') or '')
        reo_was_sent = original_reo_status == 'sent'
        if reo_was_sent and not acknowledge_reo_sent_warning:
            log_stage6_event(
                'archive_edit',
                'error',
                source_year=int(year),
                db_path=context.db_path,
                reason='archive_reo_ack_required',
                ticket_id=ticket_id,
                **actor_ctx,
            )
            raise ArchiveContractError(
                'archive_reo_ack_required',
                'Нужно подтвердить предупреждение для тикета, уже отправленного в РЭО',
                409,
            )

        ticket_after = recalculate_archive_ticket(ticket_before, normalized)
        # Archive edit must never change REO status / sent timestamp.
        ticket_after['reo_status'] = ticket_before.get('reo_status')
        ticket_after['reo_sent_at'] = ticket_before.get('reo_sent_at')

        old_values, new_values, changed_fields = _build_diff(ticket_before, ticket_after)
        if not changed_fields:
            log_stage6_event(
                'archive_edit',
                'noop',
                source_year=int(year),
                db_path=context.db_path,
                reason='archive_edit_noop',
                ticket_id=ticket_id,
                **actor_ctx,
            )
            raise ArchiveContractError(
                'archive_edit_validation_failed',
                'Сохранять нечего: после нормализации изменения отсутствуют',
                422,
            )

        # Persist only allowlisted + derived fields that actually changed.
        for key in ARCHIVE_EDIT_ALLOWLIST:
            if key in normalized:
                ticket_after[key] = normalized[key]

        saved_ticket = save_archive_ticket_edit(connection, ticket_id, ticket_after)
        audit_event = build_archive_edit_audit_event(
            ticket_before={key: old_values[key] for key in changed_fields},
            ticket_after={key: new_values[key] for key in changed_fields},
            source_year=int(year),
            actor=actor,
            reo_divergence_warning=reo_was_sent,
        )
        audit_event['ticket_id'] = ticket_id
        audit_event['changed_fields'] = changed_fields
        audit_event['old_values'] = {key: old_values[key] for key in changed_fields}
        audit_event['new_values'] = {key: new_values[key] for key in changed_fields}
        persisted_audit = insert_ticket_audit_event(connection, audit_event)

    # Operational summary only — full field diffs stay in ticket_audit.
    log_stage6_event(
        'archive_edit',
        'success',
        source_year=int(year),
        db_path=context.db_path,
        ticket_id=ticket_id,
        changed_fields_count=len(changed_fields),
        reo_divergence_warning=bool(reo_was_sent),
        **actor_ctx,
    )
    if reo_was_sent:
        log_stage6_event(
            'archive_edit',
            'warning',
            source_year=int(year),
            db_path=context.db_path,
            reason='reo_divergence_warning',
            ticket_id=ticket_id,
            **actor_ctx,
        )

    response: dict[str, Any] = {
        'success': True,
        'year': int(year),
        'ticket': saved_ticket,
        'audit_event': {
            'event_type': 'archive_edit',
            'source_year': int(year),
            'changed_fields': list(persisted_audit.get('changed_fields') or changed_fields),
            'old_values': persisted_audit.get('old_values') or audit_event['old_values'],
            'new_values': persisted_audit.get('new_values') or audit_event['new_values'],
            'actor_id': persisted_audit.get('actor_id'),
            'actor_name': persisted_audit.get('actor_name'),
            'timestamp': persisted_audit.get('timestamp') or audit_event['timestamp'],
            'reo_divergence_warning': bool(reo_was_sent),
        },
    }
    if reo_was_sent:
        response['warning'] = {
            'code': 'archive_reo_sent_warning',
            'message': 'Архивный тикет уже отправлялся в РЭО; статус сохранён как sent',
        }
    return response


def patch_archive_ticket(ticket_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Backward-compatible wrapper around `apply_archive_edit`.

    Expects payload keys: `year`, `patch`, optional `acknowledge_reo_sent_warning`,
    and optional `actor` (required for real edits; app route injects session actor).
    """
    year = int(payload['year'])
    patch = payload.get('patch', {})
    if not isinstance(patch, dict):
        raise ArchiveContractError(
            'archive_edit_forbidden_field',
            'Некорректный формат patch',
            422,
        )
    actor = payload.get('actor')
    if not isinstance(actor, dict):
        actor = {'role': 'admin', 'id': None, 'username': 'system', 'display_name': 'system'}
    acknowledge = bool(payload.get('acknowledge_reo_sent_warning'))
    return apply_archive_edit(year, ticket_id, patch, actor, acknowledge)
