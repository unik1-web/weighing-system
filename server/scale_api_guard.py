"""Security guard for `/api/scales/*` routes."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlparse

from flask import Request

from scale_runtime import RuntimeErrorPayload

StorageReader = Callable[[], dict[str, str]]

_APP_CURRENT_USER_KEY = 'app_current_user'
_ALLOWED_ORIGINS = {
    'http://127.0.0.1:5001',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
}
_RUNTIME_OPERATIONS = {'connect', 'status', 'read', 'disconnect'}
logger = logging.getLogger('weighing-system-api')


@dataclass(frozen=True)
class OperatorContext:
    """Current operator context from persisted local session."""

    user_id: str
    username: str
    role: str


class ScaleApiGuard:
    """Enforce origin allowlist and active operator-session checks."""

    def __init__(self, storage_reader: StorageReader) -> None:
        self._read_storage = storage_reader

    def validate_origin(self, request: Request) -> str | None:
        """
        Validate request origin/referer against allowlist.

        Returns:
            Exact allowed origin that can be echoed in CORS headers.
            Returns None for non-browser callers without Origin/Referer.
        """
        origin = (request.headers.get('Origin') or '').strip()
        referer = (request.headers.get('Referer') or '').strip()
        resolved_origin = origin or self._origin_from_referer(referer)
        if not resolved_origin:
            return None
        if resolved_origin not in _ALLOWED_ORIGINS:
            logger.warning(
                'scale_guard deny origin_not_allowed: %s',
                json.dumps(
                    {
                        'code': 'origin_not_allowed',
                        'origin_present': bool(origin),
                        'referer_present': bool(referer),
                    },
                    ensure_ascii=False,
                ),
            )
            raise RuntimeErrorPayload(
                'origin_not_allowed',
                'Origin не разрешён для runtime API весов.',
                403,
            )
        return resolved_origin

    def load_operator_context(self) -> OperatorContext:
        """Load active operator session from persisted `app_current_user`."""
        payload = self._read_storage()
        raw_session = payload.get(_APP_CURRENT_USER_KEY)
        if not isinstance(raw_session, str) or not raw_session.strip():
            logger.warning('scale_guard deny auth_required: {"code":"auth_required","reason":"session_missing"}')
            raise RuntimeErrorPayload('auth_required', 'Требуется активная сессия оператора.', 401)
        try:
            parsed = json.loads(raw_session)
        except json.JSONDecodeError as exc:
            logger.warning('scale_guard deny auth_required: {"code":"auth_required","reason":"session_json_invalid"}')
            raise RuntimeErrorPayload('auth_required', 'Некорректная сессия оператора.', 401) from exc

        if not isinstance(parsed, dict):
            logger.warning('scale_guard deny auth_required: {"code":"auth_required","reason":"session_shape_invalid"}')
            raise RuntimeErrorPayload('auth_required', 'Некорректная сессия оператора.', 401)

        user = parsed.get('user')
        profile = parsed.get('profile')
        if not isinstance(user, dict) or not isinstance(profile, dict):
            logger.warning('scale_guard deny auth_required: {"code":"auth_required","reason":"user_profile_missing"}')
            raise RuntimeErrorPayload('auth_required', 'Требуется активная сессия оператора.', 401)

        user_id = str(user.get('id') or '').strip()
        username = str(user.get('username') or '').strip()
        role = str(profile.get('role') or '').strip()
        if not user_id or not username or not role:
            logger.warning('scale_guard deny auth_required: {"code":"auth_required","reason":"required_fields_missing"}')
            raise RuntimeErrorPayload('auth_required', 'Требуется активная сессия оператора.', 401)

        return OperatorContext(user_id=user_id, username=username, role=role)

    def require_permission(self, operation: str, operator_context: OperatorContext) -> None:
        """Check that operator may execute runtime operation."""
        if operation not in _RUNTIME_OPERATIONS:
            logger.warning(
                'scale_guard deny insufficient_permissions: %s',
                json.dumps({'code': 'insufficient_permissions', 'operation': operation}, ensure_ascii=False),
            )
            raise RuntimeErrorPayload('insufficient_permissions', 'Операция не разрешена.', 403)
        if operator_context.role not in {'admin', 'user'}:
            logger.warning(
                'scale_guard deny insufficient_permissions: %s',
                json.dumps({'code': 'insufficient_permissions', 'role': operator_context.role}, ensure_ascii=False),
            )
            raise RuntimeErrorPayload('insufficient_permissions', 'Недостаточно прав.', 403)

    @staticmethod
    def _origin_from_referer(referer: str) -> str:
        if not referer:
            return ''
        parsed = urlparse(referer)
        if not parsed.scheme or not parsed.netloc:
            return ''
        return f'{parsed.scheme}://{parsed.netloc}'
