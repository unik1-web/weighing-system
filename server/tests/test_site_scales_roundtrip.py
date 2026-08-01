"""Flask /api/database round-trip for sites/scales/runtime and ticket site fields."""

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
        'site_id': 'site-1',
        'scale_id': 'scale-primary',
        'scale_role': 'primary',
        'photo_entry_path': None,
        'photo_exit_path': None,
        'photo_overview_path': None,
    }
    base.update(overrides)
    return base


def _site_payload():
    sites = [
        {
            'id': 'site-1',
            'name': 'Основная площадка',
            'is_default': True,
            'created_at': '2026-01-01T00:00:00',
        }
    ]
    scales = [
        {
            'id': 'scale-primary',
            'site_id': 'site-1',
            'role': 'primary',
            'name': 'Микросим М0601',
            'adapter_id': 'microsim-m0601',
            'connection': {
                'baudRate': 9600,
                'parity': 'none',
                'dataBits': 8,
                'stopBits': 1,
                'lineTerminator': '\r',
            },
            'enabled': True,
            'created_at': '2026-01-01T00:00:00',
        },
        {
            'id': 'scale-spare',
            'site_id': 'site-1',
            'role': 'spare',
            'name': 'Резервные весы',
            'adapter_id': 'cas',
            'connection': {
                'baudRate': 9600,
                'parity': 'even',
                'dataBits': 7,
                'stopBits': 1,
                'lineTerminator': '\r\n',
            },
            'enabled': False,
            'created_at': '2026-01-01T00:00:00',
        },
    ]
    runtime = [
        {
            'site_id': 'site-1',
            'active_scale_set': 'primary',
            'camera_mode': 'normal',
            'anpr_mode': 'enabled',
            'switch_reason': None,
            'switch_by_operator_id': None,
            'switch_by_operator_name': None,
            'switch_at': None,
        }
    ]
    switches = [
        {
            'id': 'sw1',
            'site_id': 'site-1',
            'from_set': 'primary',
            'to_set': 'spare',
            'reason': 'repair',
            'operator_id': None,
            'operator_name': 'Оператор',
            'at': '2026-01-02T10:00:00',
            'camera_ack': 'no_cameras',
        }
    ]
    return sites, scales, runtime, switches


def test_api_database_roundtrip_sites_scales_and_ticket_site_fields(api_client):
    sites, scales, runtime, switches = _site_payload()
    tickets = [_ticket()]
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
                'app_sites': json.dumps(sites, ensure_ascii=False),
                'app_scales': json.dumps(scales, ensure_ascii=False),
                'app_site_runtime': json.dumps(runtime, ensure_ascii=False),
                'app_site_scale_switches': json.dumps(switches, ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    assert get.status_code == 200
    body = get.get_json()
    loaded_tickets = json.loads(body['data']['app_weighing_tickets'])
    loaded_sites = json.loads(body['data']['app_sites'])
    loaded_scales = json.loads(body['data']['app_scales'])
    loaded_runtime = json.loads(body['data']['app_site_runtime'])
    loaded_switches = json.loads(body['data']['app_site_scale_switches'])

    assert loaded_tickets[0]['site_id'] == 'site-1'
    assert loaded_tickets[0]['scale_id'] == 'scale-primary'
    assert loaded_tickets[0]['scale_role'] == 'primary'
    assert loaded_sites[0]['name'] == 'Основная площадка'
    assert loaded_sites[0]['is_default'] is True
    assert len(loaded_scales) == 2
    assert isinstance(loaded_scales[0]['connection'], dict)
    assert loaded_scales[0]['connection']['baudRate'] == 9600
    assert loaded_scales[1]['enabled'] is False
    assert loaded_runtime[0]['active_scale_set'] == 'primary'
    assert loaded_switches[0]['reason'] == 'repair'
    assert loaded_switches[0]['camera_ack'] == 'no_cameras'


def test_api_partial_post_without_sites_keeps_site_data(api_client):
    sites, scales, runtime, switches = _site_payload()
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_sites': json.dumps(sites, ensure_ascii=False),
                'app_scales': json.dumps(scales, ensure_ascii=False),
                'app_site_runtime': json.dumps(runtime, ensure_ascii=False),
                'app_site_scale_switches': json.dumps(switches, ensure_ascii=False),
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
    assert 'app_sites' in body['data']
    assert len(json.loads(body['data']['app_sites'])) == 1
    assert len(json.loads(body['data']['app_scales'])) == 2
    assert len(json.loads(body['data']['app_site_scale_switches'])) == 1
