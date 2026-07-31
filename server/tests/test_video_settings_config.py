"""Admin gate for video_* config keys and etalon cleanup on camera delete."""

from __future__ import annotations

import json

import persistence
import sqlite_store
from photo_storage import PhotoStorage


MINIMAL_JPEG = (
    b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
    b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
    b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342'
    b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14'
    b'\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
    b'\x08\xff\xc4\x00\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
    b'\x00\x00\x00\x00\x00\x00\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xaa'
    b'\xff\xd9'
)


def _camera_row(**overrides):
    row = {
        'id': 'cam-1',
        'site_id': 'default-site',
        'name': 'Въезд',
        'role': 'entry',
        'http_snapshot_url': 'http://cam/snap',
        'rtsp_url': None,
        'enabled': 1,
        'roi_x': None,
        'roi_y': None,
        'roi_w': None,
        'roi_h': None,
        'etalon_primary_path': None,
        'etalon_spare_path': None,
        'sort_order': 0,
        'created_at': '2026-07-31T00:00:00',
        'updated_at': '2026-07-31T00:00:00',
    }
    row.update(overrides)
    return row


def _seed_admin_session(api_client):
    session = {
        'user': {'id': 'u-admin', 'username': 'admin'},
        'profile': {
            'username': 'admin',
            'display_name': 'Админ',
            'role': 'admin',
        },
    }
    api_client.post(
        '/api/database',
        json={'data': {'app_current_user': json.dumps(session, ensure_ascii=False)}},
    )


def _seed_user_session(api_client):
    session = {
        'user': {'id': 'u-user', 'username': 'operator'},
        'profile': {
            'username': 'operator',
            'display_name': 'Оператор',
            'role': 'user',
        },
    }
    api_client.post(
        '/api/database',
        json={'data': {'app_current_user': json.dumps(session, ensure_ascii=False)}},
    )


def test_config_video_enabled_requires_admin(api_client, temp_app_root):
    """Changing video_enabled via POST /api/config requires admin session."""
    # Weighing-only payload without video keys still works without session.
    weighing = api_client.post(
        '/api/config',
        json={
            'config': {
                'weighing_mode_default': 'single',
                'stable_mode': 'false',
                'tara_threshold': '15000',
                'max_time_between': '24',
                'tara_default': '0',
            }
        },
    )
    assert weighing.status_code == 200

    denied = api_client.post(
        '/api/config',
        json={'config': {'video_enabled': 'true', 'weighing_mode_default': 'single'}},
    )
    assert denied.status_code == 401
    assert denied.get_json().get('code') == 'auth_required'

    _seed_user_session(api_client)
    forbidden = api_client.post(
        '/api/config',
        json={'config': {'video_enabled': 'true', 'weighing_mode_default': 'single'}},
    )
    assert forbidden.status_code == 403
    assert forbidden.get_json().get('code') == 'insufficient_permissions'

    _seed_admin_session(api_client)
    allowed = api_client.post(
        '/api/config',
        json={
            'config': {
                'video_enabled': 'true',
                'camera_capture_timeout_sec': '3',
                'camera_jpeg_quality': '80',
                'weighing_mode_default': 'single',
            }
        },
    )
    assert allowed.status_code == 200
    loaded = api_client.get('/api/config').get_json()['config']
    assert loaded['video_enabled'] == 'true'


def test_config_same_video_values_without_admin_ok(api_client, temp_app_root):
    """Re-posting unchanged video defaults does not require admin."""
    current = persistence.read_config()
    payload = {
        'weighing_mode_default': 'dual',
        'video_enabled': current['video_enabled'],
        'camera_capture_timeout_sec': current['camera_capture_timeout_sec'],
        'camera_jpeg_quality': current['camera_jpeg_quality'],
    }
    response = api_client.post('/api/config', json={'config': payload})
    assert response.status_code == 200


def test_replace_cameras_removes_etalon_dir(api_client, temp_app_root):
    """When camera id disappears from app_cameras, Photo/etalons/{id}/ is removed."""
    storage = PhotoStorage()
    storage.write_etalon('cam-gone', 'primary', MINIMAL_JPEG)
    storage.write_etalon('cam-gone', 'spare', MINIMAL_JPEG)
    etalon_dir = temp_app_root / 'Photo' / 'etalons' / 'cam-gone'
    assert etalon_dir.is_dir()

    seed = _camera_row(id='cam-gone', etalon_primary_path='Photo/etalons/cam-gone/primary.jpg')
    keep = _camera_row(id='cam-keep', name='Остаётся', http_snapshot_url='http://cam/keep')

    api_client.post(
        '/api/database',
        json={'data': {'app_cameras': json.dumps([seed, keep], ensure_ascii=False)}},
    )
    assert etalon_dir.is_dir()

    # Drop cam-gone from registry.
    api_client.post(
        '/api/database',
        json={'data': {'app_cameras': json.dumps([keep], ensure_ascii=False)}},
    )

    loaded = json.loads(sqlite_store.read_database()['app_cameras'])
    assert len(loaded) == 1
    assert loaded[0]['id'] == 'cam-keep'
    assert not etalon_dir.exists()
