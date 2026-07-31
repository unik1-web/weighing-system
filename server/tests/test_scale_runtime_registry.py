"""Session lifecycle tests for backend scale runtime registry."""

from __future__ import annotations

import json
from time import time

import scale_api
import scale_runtime

ALLOWED_HEADERS = {'Origin': 'http://localhost:5173'}


def _seed_runtime(api_client, *, active_scale_set: str = 'primary') -> None:
    response = api_client.post(
        '/api/database',
        json={
            'data': {
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
                                'serial': {'port': 'COM1', 'baud_rate': 9600},
                            },
                            'name': 'Основные',
                            'created_at': '2026-07-31T00:00:00Z',
                        },
                        {
                            'id': 'scale-spare',
                            'site_id': 'default-site',
                            'role': 'spare',
                            'adapter_id': 'newton',
                            'connection': {
                                'transport': 'serial_backend',
                                'device_id': 'newton',
                                'serial': {'port': 'COM2', 'baud_rate': 9600},
                            },
                            'name': 'Резервные',
                            'created_at': '2026-07-31T00:00:00Z',
                        },
                    ],
                    ensure_ascii=False,
                ),
                'app_site_runtime': json.dumps(
                    [
                        {
                            'site_id': 'default-site',
                            'active_scale_set': active_scale_set,
                            'camera_mode': active_scale_set,
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
                'app_current_user': json.dumps(
                    {
                        'user': {
                            'id': 'u-1',
                            'username': 'operator',
                            'email': 'operator@example.com',
                        },
                        'profile': {
                            'username': 'operator',
                            'display_name': 'Operator',
                            'role': 'admin',
                        },
                    },
                    ensure_ascii=False,
                ),
            }
        },
    )
    assert response.status_code == 200


def _connect(api_client, *, scale_id: str = 'scale-primary', role: str = 'primary'):
    return api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': scale_id,
            'expected_scale_role': role,
        },
        headers=ALLOWED_HEADERS,
    )


def test_scale_runtime_registry_connect_is_idempotent(api_client):
    """Lifecycle: repeated connect reuses existing session."""
    _seed_runtime(api_client, active_scale_set='primary')
    first = _connect(api_client, scale_id='scale-primary', role='primary')
    second = _connect(api_client, scale_id='scale-primary', role='primary')
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.get_json()['session_id'] == second.get_json()['session_id']


def test_scale_runtime_registry_marks_stale_after_switch_and_config_write(api_client):
    """Lifecycle: old session becomes stale after runtime switch and config write."""
    _seed_runtime(api_client, active_scale_set='primary')
    connect = _connect(api_client, scale_id='scale-primary', role='primary')
    session_id = connect.get_json()['session_id']

    _seed_runtime(api_client, active_scale_set='spare')
    stale_after_switch = api_client.get(
        '/api/scales/status',
        query_string={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert stale_after_switch.status_code == 409
    assert stale_after_switch.get_json()['code'] == 'stale_session'

    _seed_runtime(api_client, active_scale_set='primary')
    reconnect = _connect(api_client, scale_id='scale-primary', role='primary')
    fresh_session_id = reconnect.get_json()['session_id']

    update = api_client.post(
        '/api/database',
        json={
            'data': {
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
                                'serial': {'port': 'COM1A', 'baud_rate': 9600},
                            },
                            'name': 'Основные',
                            'created_at': '2026-07-31T00:00:00Z',
                        }
                    ],
                    ensure_ascii=False,
                )
            }
        },
    )
    assert update.status_code == 200

    stale_after_write = api_client.get(
        '/api/scales/status',
        query_string={'session_id': fresh_session_id},
        headers=ALLOWED_HEADERS,
    )
    assert stale_after_write.status_code == 409
    assert stale_after_write.get_json()['code'] == 'stale_session'


def test_scale_runtime_registry_disconnect_is_idempotent(api_client):
    """Lifecycle: repeated disconnect and unknown disconnect are success."""
    _seed_runtime(api_client, active_scale_set='primary')
    connect = _connect(api_client, scale_id='scale-primary', role='primary')
    session_id = connect.get_json()['session_id']

    first = api_client.post(
        '/api/scales/disconnect',
        json={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    second = api_client.post(
        '/api/scales/disconnect',
        json={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    unknown = api_client.post(
        '/api/scales/disconnect',
        json={'session_id': 'missing-session'},
        headers=ALLOWED_HEADERS,
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert unknown.status_code == 200
    assert second.get_json()['status'] == 'disconnected'
    assert unknown.get_json()['status'] == 'disconnected'


def test_scale_runtime_registry_purges_expired_stale_marker(api_client):
    """Lifecycle: expired stale marker is purged on next operation."""
    _seed_runtime(api_client, active_scale_set='primary')
    runtime_service = scale_api._RUNTIME
    runtime_service._stale_markers['expired-session'] = {
        'site_id': 'default-site',
        'scale_id': 'scale-primary',
        'stale_until': time() - 1,
    }
    status = api_client.get(
        '/api/scales/status',
        query_string={'session_id': 'expired-session'},
        headers=ALLOWED_HEADERS,
    )
    assert status.status_code == 404
    assert status.get_json()['code'] == 'session_not_found'
    assert 'expired-session' not in runtime_service._stale_markers


def test_scale_runtime_registry_overloaded_returns_503(api_client):
    """Lifecycle: registry pressure returns session_registry_overloaded."""
    _seed_runtime(api_client, active_scale_set='primary')
    runtime_service = scale_api._RUNTIME
    runtime_service._stale_markers.clear()
    for index in range(scale_runtime._MAX_STALE_ENTRIES):
        runtime_service._stale_markers[f'stale-{index}'] = {
            'site_id': 'default-site',
            'scale_id': 'scale-primary',
            'stale_until': time() + 600,
        }

    connect = _connect(api_client, scale_id='scale-primary', role='primary')
    assert connect.status_code == 503
    body = connect.get_json()
    assert body['success'] is False
    assert body['code'] == 'session_registry_overloaded'
