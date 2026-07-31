"""Contract tests for `/api/scales/*` runtime endpoints."""

from __future__ import annotations

import json

import scale_api
from scale_transports import SerialBackendError

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


def _scale_payload(
    *,
    scale_id: str = 'scale-primary',
    role: str = 'primary',
    transport: str = 'serial_backend',
    serial_port: str | None = 'COM_TEST',
) -> dict[str, object]:
    serial = {
        'baud_rate': 9600,
        'data_bits': 7,
        'stop_bits': 1,
        'parity': 'even',
        'line_terminator': '\r\n',
        'read_timeout_ms': 1000,
    }
    if serial_port is not None:
        serial['port'] = serial_port
    return {
        'id': scale_id,
        'site_id': 'default-site',
        'role': role,
        'adapter_id': 'cas',
        'connection': {
            'transport': transport,
            'device_id': 'cas',
            'serial': serial,
        },
        'name': 'Основные' if role == 'primary' else 'Резервные',
        'created_at': '2026-07-31T00:00:00Z',
    }


def _runtime_payload(active_scale_set: str) -> list[dict[str, object]]:
    return [
        {
            'site_id': 'default-site',
            'active_scale_set': active_scale_set,
            'camera_mode': active_scale_set,
            'anpr_mode': 'enabled' if active_scale_set == 'primary' else 'disabled_by_configuration',
            'last_switch_reason': None,
            'last_switch_comment': None,
            'last_switch_operator_name': None,
            'last_switch_operator_id': None,
            'last_switch_at': None,
            'updated_at': '2026-07-31T00:00:00Z',
        }
    ]


def _seed_runtime(api_client, *, scales: list[dict[str, object]], active_scale_set: str = 'primary') -> None:
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
                'app_scales': json.dumps(scales, ensure_ascii=False),
                'app_site_runtime': json.dumps(_runtime_payload(active_scale_set), ensure_ascii=False),
                'app_current_user': _active_session_payload(),
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


def test_scale_api_contract_success_flow(api_client):
    """Contract: connect/status/read/disconnect returns success payloads."""
    _seed_runtime(api_client, scales=[_scale_payload()])

    connect = _connect(api_client)
    assert connect.status_code == 200
    connect_body = connect.get_json()
    assert connect_body['success'] is True
    assert isinstance(connect_body['session_id'], str) and connect_body['session_id']
    assert connect_body['scale']['scale_id'] == 'scale-primary'
    session_id = connect_body['session_id']

    status = api_client.get(
        '/api/scales/status',
        query_string={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert status.status_code == 200
    status_body = status.get_json()
    assert status_body['success'] is True
    assert status_body['session_id'] == session_id

    read = api_client.post(
        '/api/scales/read',
        json={'session_id': session_id, 'timeout_ms': 1000},
        headers=ALLOWED_HEADERS,
    )
    assert read.status_code == 200
    read_body = read.get_json()
    assert read_body['success'] is True
    assert read_body['status'] == 'reading'
    assert isinstance(read_body['reading']['captured_at'], str)

    disconnect = api_client.post(
        '/api/scales/disconnect',
        json={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert disconnect.status_code == 200
    disconnect_body = disconnect.get_json()
    assert disconnect_body == {'success': True, 'session_id': session_id, 'status': 'disconnected'}


def test_scale_api_connect_inactive_scale_mismatch(api_client):
    """Contract: connect returns 409 inactive_scale_mismatch for wrong expected_*."""
    _seed_runtime(api_client, scales=[_scale_payload()])
    response = _connect(api_client, scale_id='scale-spare', role='spare')
    assert response.status_code == 409
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'inactive_scale_mismatch'
    assert isinstance(body['message'], str) and body['message']


def test_scale_api_stale_session_for_status_read_disconnect(api_client):
    """Contract: old session returns 409 stale_session after active-set switch."""
    _seed_runtime(
        api_client,
        scales=[
            _scale_payload(scale_id='scale-primary', role='primary'),
            _scale_payload(scale_id='scale-spare', role='spare'),
        ],
        active_scale_set='primary',
    )
    connect = _connect(api_client, scale_id='scale-primary', role='primary')
    assert connect.status_code == 200
    session_id = connect.get_json()['session_id']

    _seed_runtime(
        api_client,
        scales=[
            _scale_payload(scale_id='scale-primary', role='primary'),
            _scale_payload(scale_id='scale-spare', role='spare'),
        ],
        active_scale_set='spare',
    )

    status = api_client.get(
        '/api/scales/status',
        query_string={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert status.status_code == 409
    assert status.get_json()['code'] == 'stale_session'

    read = api_client.post(
        '/api/scales/read',
        json={'session_id': session_id, 'timeout_ms': 1000},
        headers=ALLOWED_HEADERS,
    )
    assert read.status_code == 409
    assert read.get_json()['code'] == 'stale_session'

    disconnect = api_client.post(
        '/api/scales/disconnect',
        json={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert disconnect.status_code == 409
    assert disconnect.get_json()['code'] == 'stale_session'


def test_scale_api_connect_invalid_connection_config(api_client):
    """Contract: missing serial.port returns 422 invalid_connection_config."""
    _seed_runtime(api_client, scales=[_scale_payload(serial_port=None)])
    response = _connect(api_client)
    assert response.status_code == 422
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'invalid_connection_config'


def test_scale_api_connect_unsupported_transport(api_client):
    """Contract: tcp_client returns 422 unsupported_transport."""
    _seed_runtime(api_client, scales=[_scale_payload(transport='tcp_client')])
    response = _connect(api_client)
    assert response.status_code == 422
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'unsupported_transport'


def test_scale_api_connect_transport_unavailable(api_client):
    """Contract: transport open errors map to 503 transport_unavailable."""
    _seed_runtime(api_client, scales=[_scale_payload()])

    class BrokenOpenTransport:
        def open(self, _connection):
            raise SerialBackendError('transport_unavailable', 'port busy', 503)

        def read_line(self, _timeout_ms):
            return 'ST,GS,+00045.0kg\r\n'

        def close(self):
            return None

    scale_api.set_scale_transport_factory(BrokenOpenTransport)
    response = _connect(api_client)
    assert response.status_code == 503
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'transport_unavailable'


def test_scale_api_read_timeout(api_client):
    """Contract: read timeout maps to 504 read_timeout."""
    _seed_runtime(api_client, scales=[_scale_payload()])

    class TimeoutTransport:
        def open(self, _connection):
            return None

        def read_line(self, _timeout_ms):
            raise SerialBackendError(
                'read_timeout',
                'За отведённое время не получено валидное показание.',
                504,
            )

        def close(self):
            return None

    scale_api.set_scale_transport_factory(TimeoutTransport)
    connect = _connect(api_client)
    assert connect.status_code == 200
    session_id = connect.get_json()['session_id']
    read = api_client.post(
        '/api/scales/read',
        json={'session_id': session_id, 'timeout_ms': 1000},
        headers=ALLOWED_HEADERS,
    )
    assert read.status_code == 504
    body = read.get_json()
    assert body['success'] is False
    assert body['code'] == 'read_timeout'
