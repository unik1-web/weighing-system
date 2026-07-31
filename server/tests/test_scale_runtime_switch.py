"""Integration tests for stale-session lifecycle on active set switch."""

from __future__ import annotations

import json

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


def _scales_payload() -> list[dict[str, object]]:
    return [
        {
            'id': 'scale-primary',
            'site_id': 'default-site',
            'role': 'primary',
            'adapter_id': 'cas',
            'connection': {
                'transport': 'serial_backend',
                'device_id': 'cas',
                'serial': {
                    'port': 'COM1',
                    'baud_rate': 9600,
                },
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
                'serial': {
                    'port': 'COM2',
                    'baud_rate': 9600,
                },
            },
            'name': 'Резервные',
            'created_at': '2026-07-31T00:00:00Z',
        },
    ]


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


def _seed_runtime(api_client, active_scale_set: str) -> None:
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
                'app_scales': json.dumps(_scales_payload(), ensure_ascii=False),
                'app_site_runtime': json.dumps(_runtime_payload(active_scale_set), ensure_ascii=False),
                'app_current_user': _active_session_payload(),
            }
        },
    )
    assert response.status_code == 200


def test_switch_invalidates_old_session_with_stale_response(api_client):
    """TC-E2E-01/02: old status/read/disconnect return 409 stale_session after switch."""
    _seed_runtime(api_client, 'primary')

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
    session_id = connect.get_json()['session_id']

    _seed_runtime(api_client, 'spare')

    status = api_client.get(
        '/api/scales/status',
        query_string={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert status.status_code == 409
    assert status.get_json()['code'] == 'stale_session'

    read = api_client.post(
        '/api/scales/read',
        json={'session_id': session_id, 'timeout_ms': 500},
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


def test_unrelated_database_update_keeps_active_session(api_client):
    """TC-UNIT-02: session remains active for unrelated `/api/database` updates."""
    _seed_runtime(api_client, 'primary')

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
    session_id = connect.get_json()['session_id']

    payload = {
        'id': 'ticket-1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': 'КамАЗ',
        'trailer_number': '',
        'driver_name': 'Иванов',
        'cargo_name': 'ТКО',
        'shipper_name': 'Отправитель',
        'receiver_name': 'Получатель',
        'carrier_name': 'Перевозчик',
        'price': 100,
        'vat_rate': 20,
        'gross_weight': 1000,
        'tare_weight': 500,
        'net_weight': 500,
        'total_amount': 50,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': None,
        'tare_datetime': None,
        'scale_device': 'CAS',
        'manual_weight_reason': None,
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-07-31T00:00:00Z',
        'completed_at': '2026-07-31T00:01:00Z',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': None,
        'site_id': 'default-site',
        'scale_id': 'scale-primary',
        'scale_role': 'primary',
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    update = api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps([payload], ensure_ascii=False)}},
    )
    assert update.status_code == 200

    status = api_client.get(
        '/api/scales/status',
        query_string={'session_id': session_id},
        headers=ALLOWED_HEADERS,
    )
    assert status.status_code == 200
    assert status.get_json()['success'] is True


def test_connect_reuses_same_session_for_active_scale(api_client):
    """TC-UNIT-02: connect idempotently reuses active session."""
    _seed_runtime(api_client, 'primary')

    payload = {
        'expected_site_id': 'default-site',
        'expected_scale_id': 'scale-primary',
        'expected_scale_role': 'primary',
    }
    first = api_client.post('/api/scales/connect', json=payload, headers=ALLOWED_HEADERS)
    second = api_client.post('/api/scales/connect', json=payload, headers=ALLOWED_HEADERS)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.get_json()['session_id'] == second.get_json()['session_id']
