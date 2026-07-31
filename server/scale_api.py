"""Scale runtime API contract routes."""

from __future__ import annotations

from typing import Any, Callable

from flask import Blueprint, g, jsonify, request
from persistence import read_database
from scale_api_guard import ScaleApiGuard
from scale_runtime import BackendScaleRuntimeService, RuntimeErrorPayload
from sqlite_store import read_runtime_snapshot

ScaleErrorBuilder = Callable[[str, str, int], tuple[Any, int]]
_RUNTIME = BackendScaleRuntimeService(read_runtime_snapshot)
_GUARD = ScaleApiGuard(read_database)


def set_scale_transport_factory(factory: Callable[[], Any]) -> None:
    """Override runtime transport factory (tests)."""
    _RUNTIME.set_transport_factory(factory)


def reset_scale_runtime_state() -> None:
    """Clear runtime sessions (test helper)."""
    _RUNTIME.reset()


def invalidate_for_scale_switch(site_id: str, from_scale_id: str) -> None:
    """Invalidate old active scale sessions."""
    _RUNTIME.invalidate_for_runtime_change(site_id, from_scale_id)


def invalidate_for_database_payload(changed_storage_keys: set[str]) -> None:
    """Invalidate sessions when critical storage blobs are updated."""
    _RUNTIME.invalidate_for_database_update(changed_storage_keys)


def register_scale_api(error_response: ScaleErrorBuilder) -> Blueprint:
    """Create a blueprint for `/api/scales/*` routes."""
    blueprint = Blueprint('scale_api', __name__, url_prefix='/api/scales')

    @blueprint.before_request
    def _guard_scale_request():
        operation = request.path.rsplit('/', 1)[-1]
        try:
            cors_origin = _GUARD.validate_origin(request)
            g.scale_api_allowed_origin = cors_origin
            if request.method != 'OPTIONS':
                operator_context = _GUARD.load_operator_context()
                _GUARD.require_permission(operation, operator_context)
        except RuntimeErrorPayload as exc:
            return error_response(exc.code, exc.message, exc.http_status)
        return None

    @blueprint.after_request
    def _apply_scale_cors_headers(response):
        response.headers.pop('Access-Control-Allow-Origin', None)
        response.headers.pop('Vary', None)
        allowed_origin = getattr(g, 'scale_api_allowed_origin', None)
        if allowed_origin:
            response.headers['Access-Control-Allow-Origin'] = allowed_origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
            response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
        return response

    @blueprint.post('/connect')
    def scale_connect():
        payload = request.get_json(silent=True) or {}
        expected_site_id = payload.get('expected_site_id')
        expected_scale_id = payload.get('expected_scale_id')
        expected_scale_role = payload.get('expected_scale_role')

        if not expected_site_id or not expected_scale_id or expected_scale_role not in ('primary', 'spare'):
            return error_response('invalid_request', 'expected_* поля обязательны', 400)

        try:
            response = _RUNTIME.connect(payload)
            return jsonify(response)
        except RuntimeErrorPayload as exc:
            return error_response(exc.code, exc.message, exc.http_status)

    @blueprint.get('/status')
    def scale_status():
        session_id = (request.args.get('session_id') or '').strip()
        if not session_id:
            return error_response('invalid_request', 'session_id обязателен', 400)
        try:
            return jsonify(_RUNTIME.status(session_id))
        except RuntimeErrorPayload as exc:
            return error_response(exc.code, exc.message, exc.http_status)

    @blueprint.post('/read')
    def scale_read():
        payload = request.get_json(silent=True) or {}
        session_id = payload.get('session_id')
        timeout_ms = payload.get('timeout_ms')
        if not session_id:
            return error_response('invalid_request', 'session_id обязателен', 400)
        if not isinstance(timeout_ms, int):
            return error_response('invalid_request', 'timeout_ms обязателен', 400)

        try:
            return jsonify(_RUNTIME.read(str(session_id), timeout_ms))
        except RuntimeErrorPayload as exc:
            return error_response(exc.code, exc.message, exc.http_status)

    @blueprint.post('/disconnect')
    def scale_disconnect():
        payload = request.get_json(silent=True) or {}
        session_id = payload.get('session_id')
        if not session_id:
            return error_response('invalid_request', 'session_id обязателен', 400)

        try:
            return jsonify(_RUNTIME.disconnect(str(session_id)))
        except RuntimeErrorPayload as exc:
            return error_response(exc.code, exc.message, exc.http_status)

    return blueprint
