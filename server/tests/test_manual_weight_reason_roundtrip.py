"""Round-trip manual_weight_reason column via /api/database."""

from __future__ import annotations

import json


def test_manual_weight_reason_roundtrip(api_client):
    ticket = {
        'id': 't-reason-1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Иванов',
        'cargo_name': 'Грунт',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 0,
        'vat_rate': 20,
        'gross_weight': 10000,
        'tare_weight': 4000,
        'net_weight': 6000,
        'total_amount': 0,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-01-01T10:00:00',
        'tare_datetime': '2026-01-01T10:05:00',
        'scale_device': '',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-01-01T10:05:00',
        'completed_at': '2026-01-01T10:05:00',
        'weighing_mode': 'single',
        'version': 1,
        'manual_weight_reason': 'прибор недоступен',
    }

    post = api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps([ticket])}},
    )
    assert post.status_code == 200

    get = api_client.get('/api/database')
    body = get.get_json()
    assert body['success'] is True
    tickets = json.loads(body['data']['app_weighing_tickets'])
    assert len(tickets) == 1
    assert tickets[0]['manual_weight_reason'] == 'прибор недоступен'


def test_manual_weight_reason_null_for_legacy(api_client):
    ticket = {
        'id': 't-reason-2',
        'ticket_number': 2,
        'vehicle_number': 'В002ВВ56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Петров',
        'cargo_name': 'Песок',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 0,
        'vat_rate': 20,
        'gross_weight': 8000,
        'tare_weight': 3000,
        'net_weight': 5000,
        'total_amount': 0,
        'gross_source': 'instrument',
        'tare_source': 'instrument',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-01-01T11:00:00',
        'tare_datetime': '2026-01-01T11:05:00',
        'scale_device': 'CAS',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-01-01T11:05:00',
        'completed_at': '2026-01-01T11:05:00',
        'weighing_mode': 'single',
        'version': 1,
    }
    api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps([ticket])}},
    )
    tickets = json.loads(api_client.get('/api/database').get_json()['data']['app_weighing_tickets'])
    assert tickets[0].get('manual_weight_reason') in (None, '')
