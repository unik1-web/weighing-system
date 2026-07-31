"""Security tests for `/api/scales/*` origin/session/CORS guard."""

from __future__ import annotations

import json

ALLOWED_ORIGIN = 'http://localhost:5173'


def _seed_runtime(api_client, *, session_role: str | None = 'admin') -> None:
    payload = {
        'app_sites': json.dumps(
            [
                {
                    'id': 'default-site',
                    'name': 'Площадка по умолчанию',
                    'created_at': '2026-07-31T00:00:00Z',
                }
            ],
            ensure_ascii=False,
        ),
        'app_scales': json.dumps(
            [
                {
                    'id': 'scale-primary',
                    'site_id': 'default-site',
                    'role': 'primary',
                    'adapter_id': 'cas',
                    'connection': {
                        'transport': 'serial_backend',
                        'device_id': 'cas',
                        'serial': {'port': 'COM_TEST', 'baud_rate': 9600},
                    },
                    'name': 'Основные',
                    'created_at': '2026-07-31T00:00:00Z',
                }
            ],
            ensure_ascii=False,
        ),
        'app_site_runtime': json.dumps(
            [
                {
                    'site_id': 'default-site',
                    'active_scale_set': 'primary',
                    'camera_mode': 'primary',
                    'anpr_mode': 'enabled',
                    'last_switch_reason': None,
                    'last_switch_comment': None,
                    'last_switch_operator_name': None,
                    'last_switch_operator_id': None,
                    'last_switch_at': None,
                    'updated_at': '2026-07-31T00:00:00Z',
                }
            ],
            ensure_ascii=False,
        ),
    }
    if session_role is not None:
        payload['app_current_user'] = json.dumps(
            {
                'user': {'id': 'u-1', 'username': 'operator', 'email': 'operator@example.com'},
                'profile': {'username': 'operator', 'display_name': 'Operator', 'role': session_role},
            },
            ensure_ascii=False,
        )
    response = api_client.post('/api/database', json={'data': payload})
    assert response.status_code == 200


def _connect(api_client, *, origin: str):
    return api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-primary',
            'expected_scale_role': 'primary',
        },
        headers={'Origin': origin},
    )


def test_scale_api_security_rejects_unallowed_origin(api_client):
    """Security: forbidden Origin is rejected and no wildcard CORS."""
    _seed_runtime(api_client, session_role='admin')
    response = _connect(api_client, origin='http://evil.local')
    assert response.status_code == 403
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'origin_not_allowed'
    assert response.headers.get('Access-Control-Allow-Origin') != '*'


def test_scale_api_security_requires_active_session(api_client):
    """Security: missing active operator session returns 401."""
    _seed_runtime(api_client, session_role=None)
    response = _connect(api_client, origin=ALLOWED_ORIGIN)
    assert response.status_code == 401
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'auth_required'


def test_scale_api_security_requires_permissions(api_client):
    """Security: insufficient role returns 403 insufficient_permissions."""
    _seed_runtime(api_client, session_role='viewer')
    response = _connect(api_client, origin=ALLOWED_ORIGIN)
    assert response.status_code == 403
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'insufficient_permissions'


def test_scale_api_security_cors_is_scoped_to_origin(api_client):
    """Security: `/api/scales/*` never answers wildcard CORS."""
    _seed_runtime(api_client, session_role='admin')

    connect = _connect(api_client, origin=ALLOWED_ORIGIN)
    assert connect.status_code == 200
    assert connect.headers.get('Access-Control-Allow-Origin') == ALLOWED_ORIGIN
    assert connect.headers.get('Access-Control-Allow-Origin') != '*'
    session_id = connect.get_json()['session_id']

    read = api_client.post(
        '/api/scales/read',
        json={'session_id': session_id, 'timeout_ms': 1000},
        headers={'Origin': ALLOWED_ORIGIN},
    )
    assert read.status_code == 200
    assert read.headers.get('Access-Control-Allow-Origin') == ALLOWED_ORIGIN
    assert read.headers.get('Access-Control-Allow-Origin') != '*'
