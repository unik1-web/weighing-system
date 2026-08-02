"""Camera capture: metadata, stubs, degrade paths with mocks."""

import json
import os
from unittest.mock import patch

import year_db
from config_ini import CONFIG_SECTION, write_ini_section
from sqlite_store import write_database


def _seed_site_and_ticket(api_client):
    year_db.write_active_year(2026)
    tickets = [
        {
            'id': 't-photo-1',
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
            'tare_weight': 5000,
            'net_weight': 15000,
            'total_amount': 1500,
            'gross_source': 'manual',
            'tare_source': 'manual',
            'gross_raw': None,
            'tare_raw': None,
            'gross_datetime': '2026-08-02T10:00:00',
            'tare_datetime': '2026-08-02T10:05:00',
            'scale_device': 'test',
            'operator_id': None,
            'operator_name': 'Оператор',
            'status': 'completed',
            'reo_status': 'pending',
            'reo_sent_at': None,
            'notes': '',
            'created_at': '2026-08-02T10:00:00',
            'completed_at': '2026-08-02T10:05:00',
            'weighing_mode': 'single',
            'version': 1,
            'site_id': 'site-1',
            'scale_id': 'scale-1',
            'scale_role': 'primary',
            'photo_entry_path': None,
            'photo_exit_path': None,
            'photo_overview_path': None,
        }
    ]
    cameras = [
        {
            'id': 'cam-entry',
            'site_id': 'site-1',
            'role': 'entry',
            'name': 'Въезд',
            'capture_url': 'http://127.0.0.1:9/snapshot.jpg',
            'capture_kind': 'http_snapshot',
            'enabled': True,
            'sort_order': 0,
            'roi': None,
            'reference_normal_path': None,
            'reference_spare_path': None,
            'created_at': '2026-08-02T00:00:00',
        },
        {
            'id': 'cam-overview',
            'site_id': 'site-1',
            'role': 'overview',
            'name': 'Обзор',
            'capture_url': 'http://127.0.0.1:9/overview.jpg',
            'capture_kind': 'http_snapshot',
            'enabled': True,
            'sort_order': 1,
            'roi': {'x': 0.1, 'y': 0.1, 'w': 0.8, 'h': 0.8},
            'reference_normal_path': None,
            'reference_spare_path': None,
            'created_at': '2026-08-02T00:00:00',
        },
    ]
    write_database(
        {
            'app_sites': json.dumps(
                [
                    {
                        'id': 'site-1',
                        'name': 'Площадка',
                        'is_default': True,
                        'created_at': '2026-08-02T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
            'app_site_runtime': json.dumps(
                [
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
                ],
                ensure_ascii=False,
            ),
            'app_cameras': json.dumps(cameras, ensure_ascii=False),
            'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
        }
    )
    return cameras


def _set_video_enabled(temp_app_root, enabled: bool):
    write_ini_section(
        str(temp_app_root / 'config.ini'),
        CONFIG_SECTION,
        {'video_enabled': 'true' if enabled else 'false', 'active_year': '2026'},
    )


FAKE_JPEG = b'\xff\xd8\xff\xe0' + b'\x00' * 64 + b'\xff\xd9'


def test_cameras_database_roundtrip_and_partial_post(api_client, temp_app_root):
    _seed_site_and_ticket(api_client)
    body = api_client.get('/api/database').get_json()
    cams = json.loads(body['data']['app_cameras'])
    assert len(cams) == 2
    assert cams[0]['role'] == 'entry'
    assert cams[1]['roi']['w'] == 0.8

    api_client.post(
        '/api/database',
        json={'data': {'app_weighing_tickets': json.dumps([], ensure_ascii=False)}},
    )
    body2 = api_client.get('/api/database').get_json()
    assert 'app_cameras' in body2['data']
    assert len(json.loads(body2['data']['app_cameras'])) == 2


def test_capture_ok_writes_files_rows_and_stubs(api_client, temp_app_root):
    _seed_site_and_ticket(api_client)
    _set_video_enabled(temp_app_root, True)

    with patch('cameras.grab_frame', return_value=FAKE_JPEG):
        resp = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-photo-1', 'phase': 'gross', 'site_id': 'site-1'},
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['success'] is True
    assert len(data['photos']) == 2
    assert all(p['status'] == 'ok' for p in data['photos'])
    assert data['stubs']['photo_entry_path']
    assert data['stubs']['photo_overview_path']
    assert data['stubs']['photo_exit_path'] is None

    for photo in data['photos']:
        assert photo['relative_path']
        abs_path = temp_app_root / photo['relative_path'].replace('/', os.sep)
        assert abs_path.is_file()

    db = api_client.get('/api/database').get_json()['data']
    photos = json.loads(db['app_ticket_photos'])
    assert len(photos) == 2
    ticket = json.loads(db['app_weighing_tickets'])[0]
    assert ticket['photo_entry_path'] == data['stubs']['photo_entry_path']


def test_capture_partial_fail(api_client, temp_app_root):
    _seed_site_and_ticket(api_client)
    _set_video_enabled(temp_app_root, True)

    def grab(camera):
        if camera['id'] == 'cam-entry':
            raise RuntimeError('timeout')
        return FAKE_JPEG

    with patch('cameras.grab_frame', side_effect=grab):
        resp = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-photo-1', 'phase': 'tare', 'site_id': 'site-1'},
        )
    data = resp.get_json()
    assert data['success'] is True
    statuses = {p['camera_id']: p['status'] for p in data['photos']}
    assert statuses['cam-entry'] == 'failed'
    assert statuses['cam-overview'] == 'ok'
    assert data['stubs']['photo_overview_path']
    assert data['stubs']['photo_entry_path'] is None


def test_capture_video_disabled_skipped(api_client, temp_app_root):
    _seed_site_and_ticket(api_client)
    _set_video_enabled(temp_app_root, False)

    resp = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': 't-photo-1', 'phase': 'gross', 'site_id': 'site-1'},
    )
    data = resp.get_json()
    assert data['success'] is True
    assert all(p['status'] == 'skipped' for p in data['photos'])
    assert all(p['relative_path'] is None for p in data['photos'])


def test_capabilities_endpoint(api_client, temp_app_root):
    _set_video_enabled(temp_app_root, True)
    resp = api_client.get('/api/cameras/capabilities')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['success'] is True
    assert data['capture_available'] is True
    assert 'http_snapshot' in data['backends']
    assert data['video_enabled'] is True
    assert data['photo_root'] == 'Photo'


def test_sync_after_capture_ok(api_client, temp_app_root):
    """ticket_photos FK must not block POST /api/database after capture."""
    _seed_site_and_ticket(api_client)
    _set_video_enabled(temp_app_root, True)

    with patch('cameras.grab_frame', return_value=FAKE_JPEG):
        cap = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-photo-1', 'phase': 'gross', 'site_id': 'site-1'},
        )
    assert cap.status_code == 200
    assert len(cap.get_json()['photos']) == 2

    db = api_client.get('/api/database').get_json()['data']
    tickets = db['app_weighing_tickets']
    photos = db['app_ticket_photos']
    assert len(json.loads(photos)) == 2

    sync = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': tickets,
                'app_ticket_photos': photos,
            }
        },
    )
    assert sync.status_code == 200, sync.get_json()
    assert sync.get_json()['success'] is True

    db2 = api_client.get('/api/database').get_json()['data']
    assert len(json.loads(db2['app_ticket_photos'])) == 2
    assert len(json.loads(db2['app_weighing_tickets'])) == 1


def test_full_site_camera_sync_twice(api_client, temp_app_root):
    """cameras/scales FK must not block repeated full sync of site graph."""
    _seed_site_and_ticket(api_client)
    db = api_client.get('/api/database').get_json()['data']

    payload = {
        'app_sites': db['app_sites'],
        'app_scales': db.get(
            'app_scales',
            json.dumps(
                [
                    {
                        'id': 'scale-1',
                        'site_id': 'site-1',
                        'role': 'primary',
                        'name': 'Основные',
                        'adapter_id': 'manual',
                        'connection': {},
                        'enabled': True,
                        'created_at': '2026-08-02T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
        ),
        'app_site_runtime': db['app_site_runtime'],
        'app_site_scale_switches': db.get(
            'app_site_scale_switches', json.dumps([], ensure_ascii=False)
        ),
        'app_cameras': db['app_cameras'],
    }

    for i in range(2):
        resp = api_client.post('/api/database', json={'data': payload})
        assert resp.status_code == 200, f'sync #{i + 1}: {resp.get_json()}'
        assert resp.get_json()['success'] is True

    db2 = api_client.get('/api/database').get_json()['data']
    assert len(json.loads(db2['app_sites'])) == 1
    assert len(json.loads(db2['app_cameras'])) == 2


def test_capture_wall_clock_timeout(api_client, temp_app_root):
    """Hung grab_frame must not block capture beyond CAPTURE_WALL_CLOCK."""
    import threading
    import time

    import cameras as cameras_mod

    _seed_site_and_ticket(api_client)
    _set_video_enabled(temp_app_root, True)

    release = threading.Event()

    def slow_grab(_camera):
        release.wait(timeout=60)
        return FAKE_JPEG

    wall = 0.8
    started = time.monotonic()
    try:
        with patch.object(cameras_mod, 'CAPTURE_WALL_CLOCK', wall):
            with patch('cameras.grab_frame', side_effect=slow_grab):
                resp = api_client.post(
                    '/api/cameras/capture',
                    json={'ticket_id': 't-photo-1', 'phase': 'gross', 'site_id': 'site-1'},
                )
        elapsed = time.monotonic() - started

        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is True
        assert all(p['status'] == 'failed' for p in data['photos'])
        assert all('Таймаут' in (p.get('error_message') or '') for p in data['photos'])
        assert elapsed < wall + 2.0, f'elapsed={elapsed:.2f}s wall={wall}'
    finally:
        release.set()
