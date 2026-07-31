"""Structured logging helpers for the camera / photo domain (stage 7)."""

from __future__ import annotations

import json
import logging
from typing import Any

from cameras import mask_url

logger = logging.getLogger('weighing-system-api')

_LEVEL_BY_STATUS = {
    'start': logging.INFO,
    'success': logging.INFO,
    'ok': logging.INFO,
    'noop': logging.INFO,
    'info': logging.INFO,
    'changed': logging.INFO,
    'warning': logging.WARNING,
    'timeout': logging.WARNING,
    'failed': logging.WARNING,
    'error': logging.ERROR,
    'unreachable': logging.WARNING,
}


def _resolve_level(status: str, level: int | None) -> int:
    """Map status string to a logging level (explicit level wins)."""
    if level is not None:
        return level
    return _LEVEL_BY_STATUS.get(str(status).lower(), logging.INFO)


def _safe_masked_url(url: str | None) -> str | None:
    """
    Return a URL safe for logs, or None when empty.

    Always runs ``cameras.mask_url`` so passwords never appear in plaintext.
    """
    if url is None:
        return None
    text = str(url).strip()
    if not text:
        return None
    return mask_url(text)


def log_camera_event(
    event: str,
    status: str,
    *,
    level: int | None = None,
    **context: Any,
) -> None:
    """
    Emit one structured camera-domain log record to ``logs/app.log``.

    Payload is JSON after the ``camera `` prefix (same logger as stage6 /
    scale_runtime). Callers must not pass plaintext credentials; any ``url`` /
    ``masked_url`` value is re-masked via ``mask_url``.

    Args:
        event: Stable event name (``capture``, ``etalon``, ``snapshot``, …).
        status: Outcome (``start``, ``success``, ``timeout``, ``failed``, …).
        level: Optional explicit logging level; otherwise derived from status.
        **context: Operational fields (ticket_id, camera_id, role, …).
    """
    payload: dict[str, Any] = {
        'event': event,
        'status': status,
    }
    for key, value in context.items():
        if value is None:
            continue
        if key in ('url', 'masked_url', 'http_snapshot_url', 'rtsp_url'):
            masked = _safe_masked_url(str(value))
            if masked is not None:
                # Canonical log field for capture URLs.
                payload['masked_url'] = masked
            continue
        payload[key] = value

    payload['event'] = event
    payload['status'] = status

    logger.log(
        _resolve_level(status, level),
        'camera %s',
        json.dumps(payload, ensure_ascii=False, default=str),
    )


def log_capture_start(
    ticket_id: str,
    event: str,
    camera_id: str,
    role: str,
    *,
    masked_url: str | None = None,
    **extra: Any,
) -> None:
    """
    Log the start of a per-camera phase capture attempt.

    Args:
        ticket_id: Weighing ticket id.
        event: Phase ``gross`` or ``tare``.
        camera_id: Camera UUID.
        role: Camera role (``entry`` / ``exit`` / ``overview``).
        masked_url: Optional capture URL (will be re-masked).
        **extra: Additional non-secret context.
    """
    log_camera_event(
        'capture',
        'start',
        ticket_id=ticket_id,
        capture_event=event,
        camera_id=camera_id,
        role=role,
        masked_url=masked_url,
        **extra,
    )


def log_capture_result(
    ticket_id: str,
    event: str,
    camera_id: str,
    role: str,
    *,
    status: str,
    error_code: str | None = None,
    masked_url: str | None = None,
    **extra: Any,
) -> None:
    """
    Log the outcome of a per-camera phase capture (success / fail / timeout).

    Args:
        ticket_id: Weighing ticket id.
        event: Phase ``gross`` or ``tare``.
        camera_id: Camera UUID.
        role: Camera role.
        status: ``success``, ``timeout``, ``failed``, …
        error_code: Typed error when not successful.
        masked_url: Capture URL used (re-masked before write).
        **extra: Additional non-secret context.
    """
    log_camera_event(
        'capture',
        status,
        ticket_id=ticket_id,
        capture_event=event,
        camera_id=camera_id,
        role=role,
        error_code=error_code,
        masked_url=masked_url,
        **extra,
    )


def log_etalon_result(
    camera_id: str,
    scale_set: str,
    *,
    status: str,
    error_code: str | None = None,
    masked_url: str | None = None,
    path: str | None = None,
    **extra: Any,
) -> None:
    """
    Log etalon capture success or failure (UC-02).

    Args:
        camera_id: Camera UUID.
        scale_set: ``primary`` or ``spare``.
        status: ``success`` / ``failed`` / ``timeout`` / …
        error_code: Typed error when failed.
        masked_url: Camera URL used for capture.
        path: Relative etalon path on success.
        **extra: Additional non-secret context.
    """
    log_camera_event(
        'etalon',
        status,
        camera_id=camera_id,
        scale_set=scale_set,
        error_code=error_code,
        masked_url=masked_url,
        path=path,
        **extra,
    )


def log_snapshot_result(
    *,
    status: str,
    camera_id: str | None = None,
    error_code: str | None = None,
    masked_url: str | None = None,
    **extra: Any,
) -> None:
    """
    Log live/test snapshot outcome (UC-01 / UC-06).

    Args:
        status: ``success`` / ``failed`` / ``timeout`` / …
        camera_id: Optional camera UUID when resolved from registry.
        error_code: Typed error when failed.
        masked_url: Snapshot URL used.
        **extra: Additional non-secret context.
    """
    log_camera_event(
        'snapshot',
        status,
        camera_id=camera_id,
        error_code=error_code,
        masked_url=masked_url,
        **extra,
    )


def log_video_enabled_changed(
    old: Any,
    new: Any,
    operator: str | None = None,
    **extra: Any,
) -> None:
    """
    Log toggle of ``video_enabled`` in config.ini (UC-05).

    Args:
        old: Previous value (string or bool-like).
        new: New value after save.
        operator: Actor username / display name when known.
        **extra: Additional non-secret context.
    """
    log_camera_event(
        'video_enabled',
        'changed',
        old_value=str(old),
        new_value=str(new),
        operator=operator,
        **extra,
    )


def log_photo_io_error(
    *,
    operation: str,
    path: str | None = None,
    ticket_id: str | None = None,
    camera_id: str | None = None,
    error: Any = None,
    **extra: Any,
) -> None:
    """
    Log a filesystem I/O failure under ``Photo/`` (write / unlink / etc.).

    Never logs JPEG/base64 payloads.

    Args:
        operation: Short operation tag (``write_ticket_photo``, ``write_etalon``, …).
        path: Relative photo path when known.
        ticket_id: Related ticket when applicable.
        camera_id: Related camera when applicable.
        error: Exception or short reason string.
        **extra: Additional non-secret context.
    """
    reason = str(error) if error is not None else None
    log_camera_event(
        'photo_io',
        'error',
        level=logging.ERROR,
        operation=operation,
        path=path,
        ticket_id=ticket_id,
        camera_id=camera_id,
        reason=reason,
        **extra,
    )
