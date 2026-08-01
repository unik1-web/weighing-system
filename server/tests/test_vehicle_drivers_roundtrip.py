"""Flask /api/database round-trip for vehicle_drivers and ticket audit stubs."""

import json


def _ticket(**overrides):
    base = {
        'id': 't1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': 'КамАЗ',
        'trailer_number': '',
        'driver_name': 'Иванов',
        'cargo_name': 'Грунт',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 100,
        'vat_rate': 20,
        'gross_weight': 20000,
        'tare_weight': 5000,
        'net_weight': 15000,
        'total_amount': 1500,
        'gross_source': 'instrument',
        'tare_source': 'dictionary',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-01-01T10:00:00',
        'tare_datetime': '2026-01-01T10:05:00',
        'scale_device': 'Микросим М0601',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-01-01T10:00:00',
        'completed_at': '2026-01-01T10:05:00',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': 'directory',
        'scale_role': None,
        'photo_entry_path': None,
        'photo_exit_path': None,
        'photo_overview_path': None,
    }
    base.update(overrides)
    return base


def test_api_database_roundtrip_vehicle_drivers_and_audit_stubs(api_client):
    tickets = [_ticket()]
    links = [
        {
            'id': 'vd1',
            'vehicle_number': 'А001АА56',
            'driver_name': 'Иванов И.И.',
            'last_used_at': '2026-01-01T10:05:00',
            'use_count': 3,
            'driver_id': None,
        }
    ]
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
                'app_vehicle_drivers': json.dumps(links, ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    assert get.status_code == 200
    body = get.get_json()
    loaded_tickets = json.loads(body['data']['app_weighing_tickets'])
    loaded_links = json.loads(body['data']['app_vehicle_drivers'])
    assert loaded_tickets[0]['plate_source'] == 'directory'
    assert loaded_tickets[0]['scale_role'] is None
    assert loaded_tickets[0]['photo_entry_path'] is None
    assert loaded_links[0]['use_count'] == 3
    assert loaded_links[0]['vehicle_number'] == 'А001АА56'


def test_api_partial_post_without_vehicle_drivers_keeps_links(api_client):
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_vehicle_drivers': json.dumps(
                    [
                        {
                            'id': 'vd1',
                            'vehicle_number': 'А001АА56',
                            'driver_name': 'Иванов',
                            'last_used_at': '2026-01-01T10:00:00',
                            'use_count': 1,
                            'driver_id': None,
                        }
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([_ticket(id='t2')], ensure_ascii=False),
            }
        },
    )
    body = api_client.get('/api/database').get_json()
    assert 'app_vehicle_drivers' in body['data']
    assert len(json.loads(body['data']['app_vehicle_drivers'])) == 1


def test_api_config_driver_mode_and_scale_device(api_client):
    keys = {
        'driver_input_mode': 'vehicle',
        'scale_device_id': 'cas',
    }
    post = api_client.post('/api/config', json={'config': keys})
    assert post.status_code == 200
    config = api_client.get('/api/config').get_json()['config']
    assert config['driver_input_mode'] == 'vehicle'
    assert config['scale_device_id'] == 'cas'
