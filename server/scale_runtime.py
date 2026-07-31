"""Scale runtime session orchestration for `/api/scales/*`."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from time import time
from typing import Any, Callable
from uuid import uuid4

from scale_integrity import run_scale_integrity_audit
from scale_registry import parse_reading
from scale_transports import SerialBackendError, SerialBackendTransport

RuntimeSnapshotReader = Callable[[], dict[str, Any]]
TransportFactory = Callable[[], Any]

_STALE_TTL_SECONDS = 15 * 60
_MAX_STALE_ENTRIES = 32
_IP_PATTERN = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
_TTY_PATTERN = re.compile(r'/dev/tty[^\s"\'`]+', re.IGNORECASE)
_COM_PATTERN = re.compile(r'\bCOM\d+\b', re.IGNORECASE)

scale_state_lock = RLock()
logger = logging.getLogger('weighing-system-api')


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


@dataclass
class RuntimeErrorPayload(Exception):
    """Typed error for scale runtime API endpoints."""

    code: str
    message: str
    http_status: int


class BackendScaleRuntimeService:
    """In-memory runtime sessions bound to persisted active scale context."""

    def __init__(
        self,
        snapshot_reader: RuntimeSnapshotReader,
        *,
        transport_factory: TransportFactory | None = None,
    ) -> None:
        self._read_snapshot = snapshot_reader
        self._make_transport = transport_factory or SerialBackendTransport
        self._sessions: dict[str, dict[str, Any]] = {}
        self._stale_markers: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _redact_sensitive_string(value: str) -> str:
        value = _COM_PATTERN.sub('COM***', value)
        value = _TTY_PATTERN.sub('/dev/tty***', value)
        value = _IP_PATTERN.sub('***.***.***.***', value)
        return value

    def _redact_payload(self, payload: Any) -> Any:
        if isinstance(payload, str):
            return self._redact_sensitive_string(payload)
        if isinstance(payload, list):
            return [self._redact_payload(item) for item in payload]
        if isinstance(payload, dict):
            return {key: self._redact_payload(value) for key, value in payload.items()}
        return payload

    def _log_runtime_event(self, event: str, *, level: int = logging.INFO, **context: Any) -> None:
        payload = {'event': event, **self._redact_payload(context)}
        logger.log(level, 'scale_runtime %s', json.dumps(payload, ensure_ascii=False))

    def _run_integrity_audit_or_raise(self, snapshot: dict[str, Any], *, phase: str) -> None:
        report = run_scale_integrity_audit(snapshot)
        for warning in report.warning_findings:
            self._log_runtime_event(
                'integrity_warning',
                level=logging.WARNING,
                phase=phase,
                code=warning.code,
                message=warning.message,
                details=warning.details,
            )
        if report.aut_read_allowed:
            return
        first_fatal = report.fatal_findings[0]
        self._log_runtime_event(
            'integrity_fatal',
            level=logging.ERROR,
            phase=phase,
            code=first_fatal.code,
            message=first_fatal.message,
            details=first_fatal.details,
        )
        raise RuntimeErrorPayload(
            'invalid_connection_config',
            f'Integrity audit blocked aut-read: {first_fatal.code}',
            422,
        )

    def set_transport_factory(self, transport_factory: TransportFactory) -> None:
        """Override transport factory (tests)."""
        with scale_state_lock:
            self._make_transport = transport_factory

    def reset(self) -> None:
        """Clear active and stale sessions (tests)."""
        with scale_state_lock:
            self._disconnect_all_locked()
            self._sessions.clear()
            self._stale_markers.clear()

    def connect(self, expected_scale_context: dict[str, Any]) -> dict[str, Any]:
        """Open or reuse a backend session for currently active scale."""
        expected_site_id = str(expected_scale_context.get('expected_site_id') or '')
        expected_scale_id = str(expected_scale_context.get('expected_scale_id') or '')
        expected_scale_role = str(expected_scale_context.get('expected_scale_role') or '')

        with scale_state_lock:
            self._cleanup_expired_stale_locked()
            snapshot = self._read_snapshot()
            self._run_integrity_audit_or_raise(snapshot, phase='connect')
            active_scale = self._resolve_active_scale_locked(expected_site_id, snapshot=snapshot)
            self._ensure_expected_active_scale(
                active_scale=active_scale,
                expected_site_id=expected_site_id,
                expected_scale_id=expected_scale_id,
                expected_scale_role=expected_scale_role,
            )
            self._ensure_supported_connection(active_scale['connection'])

            existing = self._find_active_session_locked(
                site_id=active_scale['site_id'],
                scale_id=active_scale['scale_id'],
            )
            if existing is not None:
                self._log_runtime_event(
                    'open',
                    phase='connect_reuse',
                    session_id=existing['session_id'],
                    site_id=active_scale['site_id'],
                    scale_id=active_scale['scale_id'],
                    scale_role=active_scale['scale_role'],
                    adapter_id=active_scale['adapter_id'],
                    transport=active_scale['transport'],
                )
                return {'success': True, **self._public_session(existing)}

            self._ensure_registry_capacity_locked()
            transport = self._create_transport(active_scale['connection'])
            try:
                transport.open(active_scale['connection'])
            except SerialBackendError as exc:
                self._log_runtime_event(
                    'error',
                    level=logging.ERROR,
                    phase='connect',
                    code=exc.code,
                    message=exc.message,
                    site_id=active_scale['site_id'],
                    scale_id=active_scale['scale_id'],
                    scale_role=active_scale['scale_role'],
                    adapter_id=active_scale['adapter_id'],
                    transport=active_scale['transport'],
                )
                raise RuntimeErrorPayload(exc.code, exc.message, exc.http_status) from exc

            session_id = str(uuid4())
            session = {
                'session_id': session_id,
                'status': 'connected',
                'scale': {
                    'site_id': active_scale['site_id'],
                    'scale_id': active_scale['scale_id'],
                    'scale_role': active_scale['scale_role'],
                    'adapter_id': active_scale['adapter_id'],
                    'transport': active_scale['transport'],
                },
                'connection': active_scale['connection'],
                'reading': None,
                'transport_instance': transport,
            }
            self._sessions[session_id] = session
            self._log_runtime_event(
                'open',
                phase='connect',
                session_id=session_id,
                site_id=active_scale['site_id'],
                scale_id=active_scale['scale_id'],
                scale_role=active_scale['scale_role'],
                adapter_id=active_scale['adapter_id'],
                transport=active_scale['transport'],
            )
            return {'success': True, **self._public_session(session)}

    def status(self, session_id: str) -> dict[str, Any]:
        """Return current status for active backend session."""
        with scale_state_lock:
            self._cleanup_expired_stale_locked()
            self._raise_if_stale_locked(session_id)
            session = self._sessions.get(session_id)
            if session is None:
                raise RuntimeErrorPayload('session_not_found', 'Сессия не найдена', 404)
            return {'success': True, **self._public_session(session)}

    def read(self, session_id: str, timeout_ms: int) -> dict[str, Any]:
        """Read a frame through backend transport and parse it with adapter."""
        if timeout_ms <= 0:
            raise RuntimeErrorPayload('invalid_request', 'timeout_ms должен быть положительным', 400)

        with scale_state_lock:
            self._cleanup_expired_stale_locked()
            snapshot = self._read_snapshot()
            self._run_integrity_audit_or_raise(snapshot, phase='read')
            self._raise_if_stale_locked(session_id)
            session = self._sessions.get(session_id)
            if session is None:
                raise RuntimeErrorPayload('session_not_found', 'Сессия не найдена', 404)

            transport = session.get('transport_instance')
            if transport is None:
                raise RuntimeErrorPayload('transport_unavailable', 'Транспорт недоступен', 503)
            try:
                raw_line = transport.read_line(timeout_ms)
            except SerialBackendError as exc:
                self._log_runtime_event(
                    'error',
                    level=logging.ERROR,
                    phase='read',
                    session_id=session_id,
                    code=exc.code,
                    message=exc.message,
                    site_id=session['scale']['site_id'],
                    scale_id=session['scale']['scale_id'],
                    scale_role=session['scale']['scale_role'],
                    adapter_id=session['scale']['adapter_id'],
                    transport=session['scale']['transport'],
                )
                raise RuntimeErrorPayload(exc.code, exc.message, exc.http_status) from exc

            reading = parse_reading(session['scale']['adapter_id'], raw_line, session['connection'])
            if reading is None:
                raise RuntimeErrorPayload(
                    'read_timeout',
                    'За отведённое время не получено валидное показание.',
                    504,
                )

            public_reading = {
                'value': reading.get('value'),
                'stable': bool(reading.get('stable')),
                'raw': reading.get('raw', raw_line),
                'captured_at': _now_iso(),
            }
            session['status'] = 'reading'
            session['reading'] = public_reading
            self._log_runtime_event(
                'read',
                phase='read',
                session_id=session_id,
                site_id=session['scale']['site_id'],
                scale_id=session['scale']['scale_id'],
                scale_role=session['scale']['scale_role'],
                adapter_id=session['scale']['adapter_id'],
                transport=session['scale']['transport'],
                stable=public_reading['stable'],
            )
            return {
                'success': True,
                'session_id': session_id,
                'status': 'reading',
                'reading': public_reading,
            }

    def disconnect(self, session_id: str) -> dict[str, Any]:
        """Close backend session, keeping stale semantics for switched sessions."""
        with scale_state_lock:
            self._cleanup_expired_stale_locked()
            self._raise_if_stale_locked(session_id)
            session = self._sessions.pop(session_id, None)
            if session is None:
                return {'success': True, 'session_id': session_id, 'status': 'disconnected'}
            self._close_session_transport(session)
            self._log_runtime_event(
                'disconnect',
                phase='disconnect',
                session_id=session_id,
                site_id=session['scale']['site_id'],
                scale_id=session['scale']['scale_id'],
                scale_role=session['scale']['scale_role'],
                adapter_id=session['scale']['adapter_id'],
                transport=session['scale']['transport'],
            )
            return {'success': True, 'session_id': session_id, 'status': 'disconnected'}

    def invalidate_for_runtime_change(self, site_id: str, scale_id: str | None = None) -> None:
        """Invalidate sessions after active scale/runtime context changes."""
        with scale_state_lock:
            self._cleanup_expired_stale_locked()
            stale_until = time() + _STALE_TTL_SECONDS
            for session_id, session in list(self._sessions.items()):
                scale = session.get('scale') or {}
                if str(scale.get('site_id')) != site_id:
                    continue
                if scale_id is not None and str(scale.get('scale_id')) != scale_id:
                    continue
                self._close_session_transport(session)
                self._sessions.pop(session_id, None)
                self._stale_markers[session_id] = {
                    'site_id': scale.get('site_id'),
                    'scale_id': scale.get('scale_id'),
                    'stale_until': stale_until,
                }
                self._log_runtime_event(
                    'stale',
                    phase='runtime_change',
                    session_id=session_id,
                    site_id=scale.get('site_id'),
                    scale_id=scale.get('scale_id'),
                )

    def invalidate_for_database_update(self, changed_storage_keys: set[str]) -> None:
        """Invalidate all sessions when runtime-critical blobs were changed."""
        if not changed_storage_keys.intersection({'app_site_runtime', 'app_scales', 'app_current_user'}):
            return
        with scale_state_lock:
            self._cleanup_expired_stale_locked()
            stale_until = time() + _STALE_TTL_SECONDS
            for session_id, session in list(self._sessions.items()):
                self._close_session_transport(session)
                self._sessions.pop(session_id, None)
                scale = session.get('scale') or {}
                self._stale_markers[session_id] = {
                    'site_id': scale.get('site_id'),
                    'scale_id': scale.get('scale_id'),
                    'stale_until': stale_until,
                }
                self._log_runtime_event(
                    'stale',
                    phase='database_update',
                    session_id=session_id,
                    site_id=scale.get('site_id'),
                    scale_id=scale.get('scale_id'),
                )

    def _resolve_active_scale_locked(self, site_id: str, *, snapshot: dict[str, Any]) -> dict[str, Any]:
        scales = snapshot.get('scales') if isinstance(snapshot.get('scales'), list) else []
        site_runtime = (
            snapshot.get('site_runtime')
            if isinstance(snapshot.get('site_runtime'), list)
            else []
        )
        runtime = next(
            (row for row in site_runtime if isinstance(row, dict) and str(row.get('site_id')) == site_id),
            None,
        )
        if runtime is None:
            raise RuntimeErrorPayload('invalid_connection_config', 'site_runtime не найден для площадки', 422)

        active_set = runtime.get('active_scale_set')
        if active_set not in ('primary', 'spare'):
            raise RuntimeErrorPayload(
                'invalid_connection_config',
                'active_scale_set должен быть primary или spare',
                422,
            )

        active_scale = next(
            (
                row
                for row in scales
                if isinstance(row, dict)
                and str(row.get('site_id')) == site_id
                and str(row.get('role')) == active_set
            ),
            None,
        )
        if active_scale is None:
            raise RuntimeErrorPayload('invalid_connection_config', 'Активный комплект не найден в app_scales', 422)

        connection = active_scale.get('connection')
        if not isinstance(connection, dict):
            raise RuntimeErrorPayload(
                'invalid_connection_config',
                'Некорректная конфигурация подключения активного комплекта',
                422,
            )
        return {
            'site_id': site_id,
            'scale_id': str(active_scale.get('id') or ''),
            'scale_role': str(active_scale.get('role') or active_set),
            'adapter_id': str(active_scale.get('adapter_id') or ''),
            'transport': str(connection.get('transport') or ''),
            'connection': connection,
        }

    @staticmethod
    def _ensure_expected_active_scale(
        *,
        active_scale: dict[str, Any],
        expected_site_id: str,
        expected_scale_id: str,
        expected_scale_role: str,
    ) -> None:
        if active_scale['site_id'] != expected_site_id:
            raise RuntimeErrorPayload(
                'inactive_scale_mismatch',
                'Активная площадка изменилась, откройте чтение заново.',
                409,
            )
        if active_scale['scale_id'] != expected_scale_id:
            raise RuntimeErrorPayload(
                'inactive_scale_mismatch',
                'Активный комплект изменился, откройте чтение заново.',
                409,
            )
        if active_scale['scale_role'] != expected_scale_role:
            raise RuntimeErrorPayload(
                'inactive_scale_mismatch',
                'Активная роль комплекта изменилась, откройте чтение заново.',
                409,
            )

    @staticmethod
    def _ensure_supported_connection(connection: dict[str, Any]) -> None:
        transport = str(connection.get('transport') or '').strip()
        if not transport:
            raise RuntimeErrorPayload('invalid_connection_config', 'Не задан transport активного комплекта', 422)
        if transport != 'serial_backend':
            raise RuntimeErrorPayload('unsupported_transport', 'Транспорт не поддерживается текущим релизом', 422)
        serial_cfg = connection.get('serial')
        if not isinstance(serial_cfg, dict) or not str(serial_cfg.get('port') or '').strip():
            raise RuntimeErrorPayload('invalid_connection_config', 'Не задан serial.port активного комплекта', 422)

    def _create_transport(self, connection: dict[str, Any]) -> Any:
        try:
            transport = self._make_transport()
        except Exception as exc:
            raise RuntimeErrorPayload('transport_unavailable', 'Не удалось создать transport', 503) from exc
        if not hasattr(transport, 'open') or not hasattr(transport, 'read_line') or not hasattr(transport, 'close'):
            raise RuntimeErrorPayload('transport_unavailable', 'Некорректный transport driver', 503)
        return transport

    def _cleanup_expired_stale_locked(self) -> None:
        now = time()
        expired_session_ids = [
            session_id
            for session_id, marker in self._stale_markers.items()
            if float(marker.get('stale_until') or 0) <= now
        ]
        for session_id in expired_session_ids:
            self._stale_markers.pop(session_id, None)

    def _ensure_registry_capacity_locked(self) -> None:
        if len(self._stale_markers) < _MAX_STALE_ENTRIES:
            return
        self._cleanup_expired_stale_locked()
        if len(self._stale_markers) >= _MAX_STALE_ENTRIES:
            raise RuntimeErrorPayload(
                'session_registry_overloaded',
                'Реестр сессий перегружен, повторите попытку.',
                503,
            )

    def _raise_if_stale_locked(self, session_id: str) -> None:
        if session_id in self._stale_markers:
            raise RuntimeErrorPayload('stale_session', 'Сессия устарела после переключения комплекта.', 409)

    def _find_active_session_locked(self, *, site_id: str, scale_id: str) -> dict[str, Any] | None:
        for session in self._sessions.values():
            scale = session.get('scale', {})
            if scale.get('site_id') == site_id and scale.get('scale_id') == scale_id:
                return session
        return None

    def _public_session(self, session: dict[str, Any]) -> dict[str, Any]:
        return {
            'session_id': session['session_id'],
            'status': session['status'],
            'scale': session['scale'],
            'reading': session.get('reading'),
        }

    def _close_session_transport(self, session: dict[str, Any]) -> None:
        transport = session.get('transport_instance')
        if transport is None:
            return
        try:
            transport.close()
        except Exception:
            pass
        finally:
            session['transport_instance'] = None

    def _disconnect_all_locked(self) -> None:
        for session in self._sessions.values():
            self._close_session_transport(session)


ScaleRuntimeService = BackendScaleRuntimeService
