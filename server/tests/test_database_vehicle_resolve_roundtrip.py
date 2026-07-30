"""Flask /api/database and /api/config smoke for vehicle resolve stage.

Deployment checklist (acceptance):
1. Frontend build with vehicle-resolve + driver_input_mode / scale_device_id.
2. Backend: init_schema / ensure_ticket_schema → vehicle_drivers + stub columns.
3. Smoke API: drivers history + stubs + config keys (this file).
4. Manual smoke: confirmed plate autofill; driver mode; scale model reload; card/CSV;
   dual completing without overwrite; complete → history.
5. Rollback: old client ignores extra fields; DROP not required.
6. Do not commit config.ini / BD/.
"""

import json


def _ticket(**overrides):
    base = {
        'id': 'vr1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': 'КамАЗ',
        'trailer_number': '',
        'driver_name': 'Иванов И.И.',
        'cargo_name': 'ТКО',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 100,
        'vat_rate': 20,
        'gross_weight': 20000,
        'tare_weight': 8500,
        'net_weight': 11500,
        'total_amount': 1150,
        'gross_source': 'instrument',
        'tare_source': 'dictionary',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-01T10:00:00',
        'tare_datetime': '2026-07-01T10:00:00',
        'scale_device': 'Микросим М0601',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-07-01T10:00:00',
        'completed_at': '2026-07-01T10:01:00',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': 'directory',
        'scale_role': None,
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    base.update(overrides)
    return base


def _drivers():
    return [
        {
            'id': 'd1',
            'vehicle_key': 'а001аа56',
            'driver_name': 'Иванов И.И.',
            'last_used_at': '2026-07-01T10:00:00.000Z',
            'use_count': 2,
        },
        {
            'id': 'd2',
            'vehicle_key': 'а001аа56',
            'driver_name': 'Петров П.П.',
            'last_used_at': '2026-07-02T10:00:00.000Z',
            'use_count': 1,
        },
    ]


def test_api_database_roundtrip_vehicle_drivers(api_client):
    """TC-E2E-API-01: round-trip app_vehicle_drivers."""
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_vehicle_drivers': json.dumps(_drivers(), ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    body = get.get_json()
    assert body['success'] is True
    loaded = json.loads(body['data']['app_vehicle_drivers'])
    assert len(loaded) == 2
    assert {row['driver_name'] for row in loaded} == {'Иванов И.И.', 'Петров П.П.'}


def test_api_database_roundtrip_ticket_stubs(api_client):
    """TC-E2E-API-02: round-trip ticket stub fields."""
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([_ticket()], ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    get = api_client.get('/api/database')
    loaded = json.loads(get.get_json()['data']['app_weighing_tickets'])
    assert loaded[0]['plate_source'] == 'directory'
    assert loaded[0]['scale_role'] is None
    assert loaded[0]['photo_entry_path'] is None
    assert loaded[0]['photo_exit_path'] is None


def test_api_database_partial_post_keeps_vehicle_drivers(api_client):
    """TC-E2E-API-03: partial POST without app_vehicle_drivers keeps history."""
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_vehicle_drivers': json.dumps(_drivers(), ensure_ascii=False),
                'app_weighing_tickets': json.dumps([_ticket()], ensure_ascii=False),
            }
        },
    )
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(
                    [_ticket(id='vr2', ticket_number=2)], ensure_ascii=False
                ),
            }
        },
    )
    get = api_client.get('/api/database')
    data = get.get_json()['data']
    assert len(json.loads(data['app_vehicle_drivers'])) == 2
    assert len(json.loads(data['app_weighing_tickets'])) == 1


def test_api_config_driver_input_mode_and_scale_device_id(api_client):
    """TC-E2E-API-04: config keys driver_input_mode / scale_device_id."""
    post = api_client.post(
        '/api/config',
        json={
            'config': {
                'driver_input_mode': 'all',
                'scale_device_id': 'newton',
                'weighing_mode_default': 'single',
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/config')
    config = get.get_json()['config']
    assert config['driver_input_mode'] == 'all'
    assert config['scale_device_id'] == 'newton'

    # Unknown keys must not crash the process
    post2 = api_client.post(
        '/api/config',
        json={'config': {'driver_input_mode': 'free', 'totally_unknown_key': 'x'}},
    )
    assert post2.status_code == 200


def test_api_database_legacy_ticket_without_stubs(api_client):
    """TC-E2E-API-05: legacy ticket without stub keys reads without 500."""
    legacy = _ticket(id='legacy1')
    for key in ('plate_source', 'scale_role', 'photo_entry_path', 'photo_exit_path'):
        legacy.pop(key, None)

    post = api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps([legacy], ensure_ascii=False)}},
    )
    assert post.status_code == 200
    get = api_client.get('/api/database')
    assert get.status_code == 200
    loaded = json.loads(get.get_json()['data']['app_weighing_tickets'])
    assert loaded[0]['id'] == 'legacy1'
    assert loaded[0].get('plate_source') is None


def test_api_database_tare_source_dictionary_still_roundtrips(api_client):
    """Regression: tare_source=dictionary still round-trips."""
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(
                    [_ticket(tare_source='dictionary')], ensure_ascii=False
                ),
            }
        },
    )
    assert post.status_code == 200
    loaded = json.loads(api_client.get('/api/database').get_json()['data']['app_weighing_tickets'])
    assert loaded[0]['tare_source'] == 'dictionary'
