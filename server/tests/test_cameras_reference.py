"""Camera reference (etalon) save: overwrite, optional URL, missing camera."""

import json
import os
from unittest.mock import patch

import year_db
from sqlite_store import write_database

FAKE_JPEG_A = b'\xff\xd8\xff\xe0' + b'A' * 64 + b'\xff\xd9'
FAKE_JPEG_B = b'\xff\xd8\xff\xe0' + b'B' * 64 + b'\xff\xd9'


def _seed_camera(capture_url: str = 'http://127.0.0.1:9/old.jpg'):
    year_db.write_active_year(2026)
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
            'app_cameras': json.dumps(
                [
                    {
                        'id': 'cam-ref-1',
                        'site_id': 'site-1',
                        'role': 'overview',
                        'name': 'Обзор',
                        'capture_url': capture_url,
                        'capture_kind': 'http_snapshot',
                        'enabled': True,
                        'sort_order': 0,
                        'roi': None,
                        'reference_normal_path': None,
                        'reference_spare_path': None,
                        'created_at': '2026-08-02T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
        }
    )


def test_save_reference_overwrites_same_path(api_client, temp_app_root):
    _seed_camera()
    with patch('cameras.grab_frame', return_value=FAKE_JPEG_A) as grab:
        resp1 = api_client.post(
            '/api/cameras/reference',
            json={'camera_id': 'cam-ref-1', 'mode': 'normal'},
        )
    assert resp1.status_code == 200
    cam1 = resp1.get_json()['camera']
    path = cam1['reference_normal_path']
    assert path == 'Photo/refs/cam-ref-1_normal.jpg'
    abs_path = temp_app_root / path.replace('/', os.sep)
    assert abs_path.read_bytes() == FAKE_JPEG_A
    assert grab.call_count == 1

    with patch('cameras.grab_frame', return_value=FAKE_JPEG_B) as grab2:
        resp2 = api_client.post(
            '/api/cameras/reference',
            json={'camera_id': 'cam-ref-1', 'mode': 'normal'},
        )
    assert resp2.status_code == 200
    cam2 = resp2.get_json()['camera']
    assert cam2['reference_normal_path'] == path
    assert cam2['id'] == 'cam-ref-1'
    assert abs_path.read_bytes() == FAKE_JPEG_B
    assert grab2.call_count == 1


def test_save_reference_optional_capture_url(api_client, temp_app_root):
    _seed_camera('http://127.0.0.1:9/db.jpg')
    captured = {}

    def fake_grab(camera):
        captured['url'] = camera.get('capture_url')
        captured['kind'] = camera.get('capture_kind')
        return FAKE_JPEG_A

    with patch('cameras.grab_frame', side_effect=fake_grab):
        resp = api_client.post(
            '/api/cameras/reference',
            json={
                'camera_id': 'cam-ref-1',
                'mode': 'spare',
                'capture_url': 'http://127.0.0.1:9/form.jpg',
                'capture_kind': 'http_snapshot',
            },
        )
    assert resp.status_code == 200
    assert captured['url'] == 'http://127.0.0.1:9/form.jpg'
    cam = resp.get_json()['camera']
    assert cam['id'] == 'cam-ref-1'
    assert cam['reference_spare_path'] == 'Photo/refs/cam-ref-1_spare.jpg'
    # DB capture_url stays as stored (override only for grab)
    assert cam['capture_url'] == 'http://127.0.0.1:9/db.jpg'


def test_save_reference_missing_camera(api_client, temp_app_root):
    _seed_camera()
    resp = api_client.post(
        '/api/cameras/reference',
        json={'camera_id': 'missing', 'mode': 'normal'},
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert 'не найдена' in (body.get('message') or '').lower()


def test_cameras_photo_cache_control(api_client, temp_app_root):
    _seed_camera()
    with patch('cameras.grab_frame', return_value=FAKE_JPEG_A):
        ref = api_client.post(
            '/api/cameras/reference',
            json={'camera_id': 'cam-ref-1', 'mode': 'normal'},
        )
    path = ref.get_json()['camera']['reference_normal_path']
    photo = api_client.get('/api/cameras/photo', query_string={'path': path})
    assert photo.status_code == 200
    assert 'no-store' in (photo.headers.get('Cache-Control') or '')
