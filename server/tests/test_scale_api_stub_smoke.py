"""Smoke/integration tests for runtime `/api/scales/*` contract."""

from __future__ import annotations

import json

import scale_api

ALLOWED_HEADERS = {'Origin': 'http://localhost:5173'}


def _active_session_payload() -> str:
    return json.dumps(
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
    )


def _seed_runtime(api_client, *, scale_id: str = 'scale-primary', transport: str = 'serial_backend'):
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
                            'id': scale_id,
                            'site_id': 'default-site',
                            'role': 'primary',
                            'adapter_id': 'cas',
                            'connection': {
                                'transport': transport,
                                'device_id': 'cas',
                                'serial': {
                                    'port': 'COM_TEST',
                                    'baud_rate': 9600,
                                    'data_bits': 7,
                                    'stop_bits': 1,
                                    'parity': 'even',
                                    'line_terminator': '\r\n',
                                    'read_timeout_ms': 1000,
                                },
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
                'app_current_user': _active_session_payload(),
            }
        },
    )
    assert response.status_code == 200


def test_scale_api_connect_status_read_disconnect_flow(api_client):
    """TC-E2E-01: runtime flow connect -> status -> read -> disconnect."""
    _seed_runtime(api_client)
    connect = api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-primary',
            'expected_scale_role': 'primary',
        },
        headers=ALLOWED_HEADERS,
    )
    assert connect.status_code == 200
    connect_body = connect.get_json()
    assert connect_body['success'] is True
    session_id = connect_body['session_id']
    assert isinstance(session_id, str) and session_id

    status = api_client.get(
        '/api/scales/status',
        query_string={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert status.status_code == 200
    status_body = status.get_json()
    assert status_body['success'] is True
    assert status_body['session_id'] == session_id
    assert status_body['status'] == 'connected'

    read = api_client.post(
        '/api/scales/read',
        json={'session_id': session_id, 'timeout_ms': 1000},
        headers=ALLOWED_HEADERS,
    )
    assert read.status_code == 200
    read_body = read.get_json()
    assert read_body['success'] is True
    assert read_body['session_id'] == session_id
    assert read_body['status'] == 'reading'
    assert read_body['reading']['value'] == 45.0
    assert read_body['reading']['stable'] is True
    assert isinstance(read_body['reading']['raw'], str) and read_body['reading']['raw']
    assert isinstance(read_body['reading']['captured_at'], str) and read_body['reading']['captured_at']

    disconnect = api_client.post(
        '/api/scales/disconnect',
        json={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert disconnect.status_code == 200
    disconnect_body = disconnect.get_json()
    assert disconnect_body['success'] is True
    assert disconnect_body['session_id'] == session_id
    assert disconnect_body['status'] == 'disconnected'


def test_scale_api_connect_mismatch_returns_409_and_does_not_open_transport(api_client):
    """TC-E2E-02: connect mismatch returns inactive_scale_mismatch."""
    _seed_runtime(api_client, scale_id='scale-primary')

    class CountingTransport:
        open_calls = 0

        def open(self, _connection):
            CountingTransport.open_calls += 1

        def read_line(self, _timeout_ms):
            return 'ST,GS,+00045.0kg\r\n'

        def close(self):
            return None

    scale_api.set_scale_transport_factory(CountingTransport)

    response = api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-spare',
            'expected_scale_role': 'spare',
        },
        headers=ALLOWED_HEADERS,
    )
    assert response.status_code == 409
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'inactive_scale_mismatch'
    assert CountingTransport.open_calls == 0


def test_scale_api_connect_returns_unsupported_transport_for_tcp_client(api_client):
    """TC-E2E-04: tcp_client returns unsupported_transport."""
    _seed_runtime(api_client, transport='tcp_client')
    response = api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-primary',
            'expected_scale_role': 'primary',
        },
        headers=ALLOWED_HEADERS,
    )
    assert response.status_code == 422
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'unsupported_transport'


def test_scale_api_error_body_contains_code_and_message(api_client):
    """TC-UNIT: scale routes return unified error body."""
    _seed_runtime(api_client)
    bad = api_client.post('/api/scales/read', json={'timeout_ms': 1000}, headers=ALLOWED_HEADERS)
    assert bad.status_code == 400
    body = bad.get_json()
    assert body['success'] is False
    assert body['code'] == 'invalid_request'
    assert isinstance(body['message'], str) and body['message']


def test_scale_api_connect_rejects_broken_active_runtime_contour(api_client):
    """TC-E2E-01: broken active contour blocks aut-read with diagnostic error."""
    response = api_client.post(
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
                                'serial': {'port': 'COM_TEST'},
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
                            'active_scale_set': 'spare',
                            'camera_mode': 'spare',
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
                'app_current_user': _active_session_payload(),
            }
        },
    )
    assert response.status_code == 200

    connect = api_client.post(
        '/api/scales/connect',
        json={
            'expected_site_id': 'default-site',
            'expected_scale_id': 'scale-primary',
            'expected_scale_role': 'primary',
        },
        headers=ALLOWED_HEADERS,
    )
    assert connect.status_code == 422
    body = connect.get_json()
    assert body['success'] is False
    assert body['code'] == 'invalid_connection_config'
    assert 'Integrity audit blocked aut-read' in body['message']
