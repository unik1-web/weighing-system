"""Stage-6 helpers for `ticket_audit` event payloads (auto_close / archive_edit)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any


def _utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 form with Z suffix."""
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _actor_fields(actor: dict[str, Any] | None) -> tuple[Any, str]:
    """Extract actor_id and display name from session actor payload."""
    if not actor:
        return None, 'system'
    actor_id = actor.get('id') or actor.get('actor_id')
    actor_name = (
        actor.get('display_name')
        or actor.get('actor_name')
        or actor.get('username')
        or 'system'
    )
    return actor_id, str(actor_name)


def _diff_values(
    before: dict[str, Any],
    after: dict[str, Any],
) -> tuple[list[str], dict[str, Any], dict[str, Any]]:
    """
    Build changed field list and old/new maps for keys present in either side.

    Only keys that appear in `after` (or shared keys) are considered; equality
    uses direct `!=` comparison after callers normalize values.
    """
    keys = sorted(set(before.keys()) | set(after.keys()))
    changed_fields: list[str] = []
    old_values: dict[str, Any] = {}
    new_values: dict[str, Any] = {}
    for key in keys:
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changed_fields.append(key)
            old_values[key] = old
            new_values[key] = new
    return changed_fields, old_values, new_values


def build_auto_close_audit_event(
    *,
    ticket_id: str,
    source_year: int | None,
    old_values: dict[str, Any],
    new_values: dict[str, Any],
    actor: dict[str, Any] | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """
    Build stage-6 `ticket_audit` payload for rotation auto-close.

    Args:
        ticket_id: Closed ticket identifier.
        source_year: Archive/source year being closed.
        old_values: Ticket fields before auto-close.
        new_values: Ticket fields after auto-close.
        actor: Optional actor; defaults to system.
        timestamp: Optional ISO timestamp; defaults to now.

    Returns:
        Logical audit event with `event_type = auto_close`.
    """
    actor_id, actor_name = _actor_fields(actor)
    changed_fields, filtered_old, filtered_new = _diff_values(old_values, new_values)
    at = timestamp or _utc_now_iso()
    return {
        'id': str(uuid.uuid4()),
        'ticket_id': ticket_id,
        'action': 'auto_close',
        'event_type': 'auto_close',
        'source_year': source_year,
        'actor_id': actor_id,
        'actor_name': actor_name,
        'timestamp': at,
        'at': at,
        'changed_fields': changed_fields,
        'old_values': filtered_old,
        'new_values': filtered_new,
        'reo_divergence_warning': False,
    }


def build_archive_edit_audit_event(
    ticket_before: dict[str, Any],
    ticket_after: dict[str, Any],
    source_year: int,
    actor: dict[str, Any],
    reo_divergence_warning: bool,
) -> dict[str, Any]:
    """
    Build stage-6 `ticket_audit` payload for archive ticket edit.

    Diff includes only fields that actually changed between before and after
    (including backend-recalculated `net_weight` / `total_amount`).

    Args:
        ticket_before: Ticket snapshot before edit.
        ticket_after: Ticket snapshot after patch + recalculation.
        source_year: Archive year of the edited DB file.
        actor: Admin actor (`id`, `display_name` / `username`).
        reo_divergence_warning: True when original `reo_status` was `sent`.

    Returns:
        Logical audit event with `event_type = archive_edit`.
    """
    actor_id, actor_name = _actor_fields(actor)
    compare_keys = sorted(set(ticket_before.keys()) | set(ticket_after.keys()))
    before_slice = {key: ticket_before.get(key) for key in compare_keys}
    after_slice = {key: ticket_after.get(key) for key in compare_keys}
    changed_fields, old_values, new_values = _diff_values(before_slice, after_slice)
    at = _utc_now_iso()
    return {
        'id': str(uuid.uuid4()),
        'ticket_id': str(ticket_before.get('id') or ticket_after.get('id') or ''),
        'action': 'archive_edit',
        'event_type': 'archive_edit',
        'source_year': int(source_year),
        'actor_id': actor_id,
        'actor_name': actor_name,
        'timestamp': at,
        'at': at,
        'changed_fields': changed_fields,
        'old_values': old_values,
        'new_values': new_values,
        'reo_divergence_warning': bool(reo_divergence_warning),
    }
