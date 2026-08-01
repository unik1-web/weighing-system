"""Flask /api/database round-trip for weighing_mode, version, app_ticket_audit."""

import json


def _ticket(**overrides):
    base = {
        'id': 't1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Иванов',
        'cargo_name': 'Грунт',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 100,
        'vat_rate': 20,
        'gross_weight': 20000,
        'tare_weight': None,
        'net_weight': None,
        'total_amount': None,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-01-01T10:00:00',
        'tare_datetime': None,
        'scale_device': '',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'open',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-01-01T10:00:00',
        'completed_at': None,
        'weighing_mode': 'dual',
        'version': 1,
    }
    base.update(overrides)
    return base


def test_api_database_roundtrip_tickets_and_audit(api_client):
    tickets = [_ticket()]
    audit = [
        {
            'id': 'a1',
            'ticket_id': 't1',
            'action': 'created',
            'at': '2026-01-01T10:00:00',
            'operator_name': 'Оператор',
            'operator_id': None,
        }
    ]
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
                'app_ticket_audit': json.dumps(audit, ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    assert get.status_code == 200
    body = get.get_json()
    assert body['success'] is True
    loaded_tickets = json.loads(body['data']['app_weighing_tickets'])
    loaded_audit = json.loads(body['data']['app_ticket_audit'])
    assert loaded_tickets[0]['weighing_mode'] == 'dual'
    assert loaded_tickets[0]['version'] == 1
    assert loaded_audit[0]['action'] == 'created'


def test_api_partial_post_without_audit_keeps_audit(api_client):
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([], ensure_ascii=False),
                'app_ticket_audit': json.dumps(
                    [
                        {
                            'id': 'a1',
                            'ticket_id': 't1',
                            'action': 'created',
                            'at': '2026-01-01T10:00:00',
                            'operator_name': 'Op',
                            'operator_id': None,
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
    assert 'app_ticket_audit' in body['data']
    assert len(json.loads(body['data']['app_ticket_audit'])) == 1
    assert json.loads(body['data']['app_weighing_tickets'])[0]['id'] == 't2'


def test_api_config_weighing_settings_roundtrip(api_client):
    keys = {
        'weighing_mode_default': 'dual',
        'stable_mode': 'true',
        'tara_threshold': '12000',
        'max_time_between': '12',
        'tara_default': '2500',
    }
    post = api_client.post('/api/config', json={'config': keys})
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/config')
    assert get.status_code == 200
    config = get.get_json()['config']
    for key, value in keys.items():
        assert config[key] == value


def test_api_database_roundtrip_weight_source_literals(api_client):
    """Smoke: extended WeightSource literals survive /api/database round-trip."""
    tickets = [
        _ticket(
            id='t-src',
            ticket_number=42,
            status='completed',
            completed_at='2026-01-01T11:00:00',
            tare_weight=3200,
            net_weight=16800,
            total_amount=1680,
            gross_source='instrument',
            tare_source='dictionary',
            weighing_mode='single',
            version=1,
        ),
        _ticket(
            id='t-src-2',
            ticket_number=43,
            status='completed',
            completed_at='2026-01-01T12:00:00',
            tare_weight=2500,
            net_weight=17500,
            total_amount=1750,
            gross_source='manual',
            tare_source='default',
            weighing_mode='single',
            version=1,
        ),
    ]
    post = api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False)}},
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    assert get.status_code == 200
    loaded = json.loads(get.get_json()['data']['app_weighing_tickets'])
    by_id = {row['id']: row for row in loaded}
    assert by_id['t-src']['gross_source'] == 'instrument'
    assert by_id['t-src']['tare_source'] == 'dictionary'
    assert by_id['t-src-2']['gross_source'] == 'manual'
    assert by_id['t-src-2']['tare_source'] == 'default'
