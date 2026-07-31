"""Unit tests for `ScaleApiGuard` behavior through API routes."""

from __future__ import annotations

import json


def _seed_runtime(api_client, *, with_session: bool) -> None:
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
    if with_session:
        payload['app_current_user'] = json.dumps(
            {
                'user': {'id': 'u-1', 'username': 'operator', 'email': 'operator@example.com'},
                'profile': {'username': 'operator', 'display_name': 'Operator', 'role': 'admin'},
            },
            ensure_ascii=False,
        )
    response = api_client.post('/api/database', json={'data': payload})
    assert response.status_code == 200


def test_scale_api_guard_rejects_unallowed_origin(api_client):
    """TC-UNIT-01: origin outside allowlist is rejected."""
    _seed_runtime(api_client, with_session=True)
    response = api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-primary',
            'expected_scale_role': 'primary',
        },
        headers={'Origin': 'http://evil.local'},
    )
    assert response.status_code == 403
    body = response.get_json()
    assert body['code'] == 'origin_not_allowed'
    assert response.headers.get('Access-Control-Allow-Origin') != '*'


def test_scale_api_guard_requires_active_session(api_client):
    """Runtime route requires persisted active operator-session."""
    _seed_runtime(api_client, with_session=False)
    response = api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-primary',
            'expected_scale_role': 'primary',
        },
        headers={'Origin': 'http://localhost:5173'},
    )
    assert response.status_code == 401
    assert response.get_json()['code'] == 'auth_required'
