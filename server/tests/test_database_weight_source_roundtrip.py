"""Flask /api/database round-trip for extended WeightSource values.

Deployment checklist (acceptance):
1. Frontend build with WeightSource = manual|instrument|dictionary|default.
2. Backend without DDL / CHECK on gross_source / tare_source.
3. Do not migrate historical manual → dictionary/default.
4. Smoke POST/GET with dictionary and default (this file).
5. Manual smoke: autofill badges, lock, journal filter, reports summary, PrintAct unchanged.
"""

import json


def _ticket(**overrides):
    base = {
        'id': 'ws1',
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
        'tare_weight': 8500,
        'net_weight': 11500,
        'total_amount': 1150,
        'gross_source': 'instrument',
        'tare_source': 'dictionary',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-01T10:00:00',
        'tare_datetime': '2026-07-01T10:00:00',
        'scale_device': '',
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
    }
    base.update(overrides)
    return base


def _roundtrip(api_client, tickets):
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    assert get.status_code == 200
    body = get.get_json()
    assert body['success'] is True
    return json.loads(body['data']['app_weighing_tickets'])


def test_api_database_roundtrip_tare_source_dictionary(api_client):
    """TC-E2E-API-01: round-trip tare_source=dictionary."""
    loaded = _roundtrip(api_client, [_ticket(tare_source='dictionary', gross_source='instrument')])
    assert loaded[0]['tare_source'] == 'dictionary'
    assert loaded[0]['gross_source'] == 'instrument'


def test_api_database_roundtrip_tare_source_default(api_client):
    """TC-E2E-API-02: round-trip tare_source=default."""
    loaded = _roundtrip(
        api_client,
        [_ticket(id='ws2', tare_source='default', tare_weight=2500, net_weight=17500)],
    )
    assert loaded[0]['tare_source'] == 'default'


def test_api_database_roundtrip_legacy_manual_instrument(api_client):
    """TC-E2E-API-03: legacy manual/instrument without regression."""
    loaded = _roundtrip(
        api_client,
        [
            _ticket(
                id='ws3',
                gross_source='manual',
                tare_source='instrument',
                status='open',
                completed_at=None,
                weighing_mode='dual',
                tare_weight=None,
                net_weight=None,
                total_amount=None,
            )
        ],
    )
    assert loaded[0]['gross_source'] == 'manual'
    assert loaded[0]['tare_source'] == 'instrument'
