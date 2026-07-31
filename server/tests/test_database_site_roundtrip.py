"""Flask /api/database and /api/config smoke for site primary/spare stage.

Deployment checklist (acceptance):
1. Frontend build with site.ts + SiteScalesSettingsSection + ScaleSetSwitchWizard.
2. Backend: init_schema / ensure_site_schema → sites/scales/runtime/journal + ticket site_id/scale_id.
3. First client run: ensureDefaultSiteAndScales from scale_device_id.
4. Smoke API: site keys + ticket columns + partial POST + config mirror (this file).
5. Manual smoke: settings → spare (checklist) → form indicator → create spare ticket → primary;
   spare without device — manual weight.
6. Rollback: nullable columns / unused tables ok; keep scale_device_id in config.
7. Do not commit config.ini / BD/.
"""

import json


def _ticket(**overrides):
    base = {
        'id': 'site1',
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
        'manual_weight_reason': None,
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
        'site_id': 'default-site',
        'scale_id': 's-primary',
        'scale_role': 'primary',
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    base.update(overrides)
    return base


def _site_bundle():
    return {
        'app_sites': [
            {
                'id': 'default-site',
                'name': 'Площадка по умолчанию',
                'created_at': '2026-07-31T00:00:00.000Z',
            }
        ],
        'app_scales': [
            {
                'id': 's-primary',
                'site_id': 'default-site',
                'role': 'primary',
                'adapter_id': 'cas',
                'connection': {
                    'transport': 'serial_backend',
                    'device_id': 'cas',
                    'serial': {
                        'port': 'COM3',
                        'baud_rate': 9600,
                    },
                    'parser': {
                        'kind': 'regex',
                        'pattern': '^ST\\s+(\\d+)$',
                        'weight_group': 1,
                    },
                },
                'name': 'Основные',
                'created_at': '2026-07-31T00:00:00.000Z',
            },
            {
                'id': 's-spare',
                'site_id': 'default-site',
                'role': 'spare',
                'adapter_id': 'web_serial',
                'connection': {'device_id': None},
                'name': 'Резервные',
                'created_at': '2026-07-31T00:00:00.000Z',
            },
        ],
        'app_site_runtime': [
            {
                'site_id': 'default-site',
                'active_scale_set': 'spare',
                'camera_mode': 'spare',
                'anpr_mode': 'disabled_by_configuration',
                'last_switch_reason': 'repair',
                'last_switch_comment': None,
                'last_switch_operator_name': 'Оператор',
                'last_switch_operator_id': None,
                'last_switch_at': '2026-07-31T01:00:00.000Z',
                'updated_at': '2026-07-31T01:00:00.000Z',
            }
        ],
        'app_scale_switch_journal': [
            {
                'id': 'j1',
                'site_id': 'default-site',
                'from_set': 'primary',
                'to_set': 'spare',
                'reason': 'repair',
                'comment': None,
                'operator_name': 'Оператор',
                'operator_id': None,
                'switched_at': '2026-07-31T01:00:00.000Z',
            }
        ],
    }


def test_api_database_roundtrip_site_entities(api_client):
    """TC-E2E-API-01: round-trip site/scales/runtime/journal."""
    bundle = _site_bundle()
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                key: json.dumps(value, ensure_ascii=False) for key, value in bundle.items()
            }
        },
    )
    assert post.status_code == 200
    assert post.get_json()['success'] is True

    get = api_client.get('/api/database')
    body = get.get_json()
    assert body['success'] is True
    scales = json.loads(body['data']['app_scales'])
    assert scales[0]['connection']['device_id'] == 'cas'
    assert scales[1]['connection']['device_id'] is None
    runtime = json.loads(body['data']['app_site_runtime'])
    assert runtime[0]['anpr_mode'] == 'disabled_by_configuration'
    journal = json.loads(body['data']['app_scale_switch_journal'])
    assert journal[0]['reason'] == 'repair'


def test_api_database_roundtrip_ticket_site_fields(api_client):
    """TC-E2E-API-02: round-trip ticket site_id/scale_id/scale_role."""
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([_ticket()], ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200
    loaded = json.loads(api_client.get('/api/database').get_json()['data']['app_weighing_tickets'])
    assert loaded[0]['site_id'] == 'default-site'
    assert loaded[0]['scale_id'] == 's-primary'
    assert loaded[0]['scale_role'] == 'primary'


def test_api_database_partial_post_keeps_site_and_journal(api_client):
    """TC-E2E-API-03: partial POST without site keys keeps site data."""
    bundle = _site_bundle()
    api_client.post(
        '/api/database',
        json={
            'data': {
                **{key: json.dumps(value, ensure_ascii=False) for key, value in bundle.items()},
                'app_weighing_tickets': json.dumps([_ticket()], ensure_ascii=False),
            }
        },
    )
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(
                    [_ticket(id='site2', ticket_number=2)], ensure_ascii=False
                ),
            }
        },
    )
    data = api_client.get('/api/database').get_json()['data']
    assert len(json.loads(data['app_sites'])) == 1
    assert len(json.loads(data['app_scale_switch_journal'])) == 1
    assert len(json.loads(data['app_weighing_tickets'])) == 1


def test_api_config_scale_device_id_mirror(api_client):
    """TC-E2E-API-04: config scale_device_id round-trip."""
    post = api_client.post(
        '/api/config',
        json={'config': {'scale_device_id': 'cas', 'weighing_mode_default': 'single'}},
    )
    assert post.status_code == 200
    get = api_client.get('/api/config')
    assert get.get_json()['config']['scale_device_id'] == 'cas'


def test_api_database_legacy_ticket_without_site_fields(api_client):
    """TC-E2E-API-05: legacy ticket without site fields reads without 500."""
    legacy = _ticket(id='legacy-site')
    for key in ('site_id', 'scale_id', 'scale_role', 'plate_source', 'photo_entry_path', 'photo_exit_path'):
        legacy.pop(key, None)

    post = api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps([legacy], ensure_ascii=False)}},
    )
    assert post.status_code == 200
    get = api_client.get('/api/database')
    assert get.status_code == 200
    loaded = json.loads(get.get_json()['data']['app_weighing_tickets'])
    assert loaded[0]['id'] == 'legacy-site'
    assert loaded[0].get('site_id') is None
    assert loaded[0].get('scale_id') is None


def test_api_database_roundtrip_preserves_manual_reason_and_connection_json(api_client):
    """TC-E2E-02: app_scales.connection_json и manual_weight_reason round-trip."""
    ticket = _ticket(manual_weight_reason='заглушка')
    bundle = _site_bundle()
    payload = {
        **{key: json.dumps(value, ensure_ascii=False) for key, value in bundle.items()},
        'app_weighing_tickets': json.dumps([ticket], ensure_ascii=False),
    }
    post = api_client.post('/api/database', json={'data': payload})
    assert post.status_code == 200

    data = api_client.get('/api/database').get_json()['data']
    scales = json.loads(data['app_scales'])
    tickets = json.loads(data['app_weighing_tickets'])
    assert scales[0]['connection']['transport'] == 'serial_backend'
    assert scales[0]['connection']['parser']['kind'] == 'regex'
    assert tickets[0]['manual_weight_reason'] == 'заглушка'


def test_api_database_rejects_invalid_generic_regex_without_partial_commit(api_client):
    """TC-UNIT: /api/database returns 422 invalid_connection_config for bad regex."""
    bundle = _site_bundle()
    bad_scales = bundle['app_scales']
    bad_scales[0]['adapter_id'] = 'generic-regex'
    bad_scales[0]['connection']['device_id'] = None
    bad_scales[0]['connection']['parser']['pattern'] = r'^(?<state>ST|US)\s+(\d+)$'
    bad_scales[0]['connection']['parser']['test_frame'] = 'ST 100'

    response = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_sites': json.dumps(bundle['app_sites'], ensure_ascii=False),
                'app_scales': json.dumps(bad_scales, ensure_ascii=False),
            }
        },
    )
    assert response.status_code == 422
    payload = response.get_json()
    assert payload['success'] is False
    assert payload['code'] == 'invalid_connection_config'

    # No partial commit.
    data = api_client.get('/api/database').get_json()['data']
    assert json.loads(data.get('app_scales', '[]')) == []


def test_api_database_writes_generic_regex_pending_runtime(api_client):
    """TC-E2E-02: valid regex without test_frame is saved as pending_runtime."""
    bundle = _site_bundle()
    scales = bundle['app_scales']
    scales[0]['adapter_id'] = 'generic-regex'
    scales[0]['connection']['device_id'] = None
    scales[0]['connection']['parser']['pattern'] = r'^(ST|US)\s+(\d+)$'
    scales[0]['connection']['parser']['weight_group'] = 2
    scales[0]['connection']['parser']['stability_group'] = 1
    scales[0]['connection']['parser']['unit_group'] = None
    scales[0]['connection']['parser'].pop('test_frame', None)

    response = api_client.post(
        '/api/database',
        json={'data': {'app_scales': json.dumps(scales, ensure_ascii=False)}},
    )
    assert response.status_code == 200
    data = api_client.get('/api/database').get_json()['data']
    stored_scales = json.loads(data['app_scales'])
    parser = stored_scales[0]['connection']['parser']
    assert parser['validation_status'] == 'pending_runtime'
    assert parser['validation_error_code'] is None
