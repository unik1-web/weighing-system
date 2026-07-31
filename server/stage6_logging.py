"""Structured logging helper for stage-6 migration/rotation/archive flows."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger('weighing-system-api')

REDACTED = '***REDACTED***'

# Known config.ini secrets and credential-like keys from integrations.
_SENSITIVE_EXACT_KEYS = frozenset(
    {
        'reo_access_key',
        'vescom_db_password',
        'wa_db_password',
        'vescom_db_user',
        'wa_db_user',
        'access_key',
        'accesskey',
        'password',
        'passwd',
        'secret',
        'token',
        'apikey',
        'api_key',
        'authorization',
        'cookie',
        'connection',
        'connection_payload',
        'private_connection',
    }
)

_SENSITIVE_KEY_FRAGMENTS = (
    'password',
    'passwd',
    'secret',
    'token',
    'apikey',
    'api_key',
    'access_key',
    'authorization',
)

# Config-style keys with integration prefixes that must never leak full values.
_SENSITIVE_CONFIG_PREFIXES = ('reo_', 'vescom_', 'wa_')

# Operational fields that share a prefix but are not secrets.
_OPERATIONAL_PREFIX_ALLOWLIST = frozenset(
    {
        'reo_divergence_warning',
        'reo_status',
        'reo_sent_at',
        'pending_reo_count',
    }
)

_IP_RE = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
_TTY_RE = re.compile(r'/dev/tty[^\s"\'`]+', re.IGNORECASE)
_COM_RE = re.compile(r'\bCOM\d+\b', re.IGNORECASE)

_LEVEL_BY_STATUS = {
    'start': logging.INFO,
    'success': logging.INFO,
    'ok': logging.INFO,
    'noop': logging.INFO,
    'info': logging.INFO,
    'acquired': logging.INFO,
    'warning': logging.WARNING,
    'error': logging.ERROR,
    'failed': logging.ERROR,
    'forbidden': logging.WARNING,
}


def _is_sensitive_key(key: str) -> bool:
    """Return True when a context key may carry secrets or private payloads."""
    lowered = str(key).lower()
    if lowered in _OPERATIONAL_PREFIX_ALLOWLIST:
        return False
    if lowered in _SENSITIVE_EXACT_KEYS:
        return True
    if any(fragment in lowered for fragment in _SENSITIVE_KEY_FRAGMENTS):
        return True
    if lowered.endswith('_connection') or 'connection_payload' in lowered:
        return True
    if lowered.startswith(_SENSITIVE_CONFIG_PREFIXES):
        # Defensive: any config.ini-style reo_/vescom_/wa_ value is redacted.
        return True
    return False


def _redact_string(value: str) -> str:
    """Mask host/COM/TTY fragments that may appear in free-form strings."""
    value = _COM_RE.sub('COM***', value)
    value = _TTY_RE.sub('/dev/tty***', value)
    return _IP_RE.sub('***.***.***.***', value)


def redact_sensitive_stage6_context(context: dict[str, Any]) -> dict[str, Any]:
    """
    Return a copy of context with secrets and private payloads masked.

    Masks:
      - secrets from `config.ini` (`reo_access_key`, `*_db_password`, …)
      - potential tokens/keys
      - private connection payloads nested in context

    Args:
        context: Raw structured-log context.

    Returns:
        Safe dict suitable for writing into `logs/app.log`.
    """

    def _walk(value: Any, parent_key: str | None = None) -> Any:
        if isinstance(value, dict):
            redacted: dict[str, Any] = {}
            for key, nested in value.items():
                if _is_sensitive_key(str(key)):
                    redacted[key] = REDACTED
                else:
                    redacted[key] = _walk(nested, str(key))
            return redacted
        if isinstance(value, list):
            return [_walk(item, parent_key) for item in value]
        if isinstance(value, str):
            if parent_key is not None and _is_sensitive_key(parent_key):
                return REDACTED
            return _redact_string(value)
        return value

    if not isinstance(context, dict):
        return {}
    return _walk(context)


def _resolve_level(status: str, level: int | None) -> int:
    if level is not None:
        return level
    return _LEVEL_BY_STATUS.get(str(status).lower(), logging.INFO)


def log_stage6_event(
    event: str,
    status: str,
    *,
    level: int | None = None,
    source_year: Any = None,
    target_year: Any = None,
    db_path: Any = None,
    backup_path: Any = None,
    operator_id: Any = None,
    operator_name: Any = None,
    open_count: Any = None,
    auto_closed_count: Any = None,
    pending_reo_count: Any = None,
    lock_path: Any = None,
    lock_phase: Any = None,
    reason: Any = None,
    **extra: Any,
) -> None:
    """
    Emit one structured stage-6 operational log record.

    Always writes `event` and `status`. Optional keyword fields are included
    only when not None so callers can pass a shared set of context keys.

    Extra kwargs (HTTP path, ticket_id, warning codes, …) are merged after
    redaction. Full archive-edit diffs must stay in `ticket_audit`, not here.

    Args:
        event: Stable event name (`primary_migration`, `rotation_commit`, …).
        status: Outcome (`start`, `success`, `error`, `warning`, …).
        level: Optional explicit logging level; otherwise derived from status.
        source_year: Closing/archive year when applicable.
        target_year: New active year when applicable.
        db_path: Path to the relevant SQLite file.
        backup_path: Path to the created backup, if any.
        operator_id: Actor id from the active session.
        operator_name: Actor display name/username.
        open_count: Number of open tickets considered.
        auto_closed_count: Number of tickets auto-closed during rotation.
        pending_reo_count: Pending REO tickets count.
        lock_path: Path to `BD/.year_rotation.lock`.
        lock_phase: Lock phase (`started`, `backup_done`, …).
        reason: Short error/warning code or human-readable reason.
        **extra: Additional non-sensitive operational context.
    """
    context: dict[str, Any] = {
        'event': event,
        'status': status,
    }
    optional = {
        'source_year': source_year,
        'target_year': target_year,
        'db_path': db_path,
        'backup_path': backup_path,
        'operator_id': operator_id,
        'operator_name': operator_name,
        'open_count': open_count,
        'auto_closed_count': auto_closed_count,
        'pending_reo_count': pending_reo_count,
        'lock_path': lock_path,
        'lock_phase': lock_phase,
        'reason': reason,
    }
    for key, value in optional.items():
        if value is not None:
            context[key] = value
    context.update(extra)

    safe_payload = redact_sensitive_stage6_context(context)
    # Ensure event/status survive even if a caller misnamed them in extra.
    safe_payload['event'] = event
    safe_payload['status'] = status

    logger.log(
        _resolve_level(status, level),
        'stage6 %s',
        json.dumps(safe_payload, ensure_ascii=False, default=str),
    )
