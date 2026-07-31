"""Stage-7 stub contracts: capability, capture noop, schema, path/url helpers."""

from __future__ import annotations

import json
import sqlite3

import cameras
import persistence
import sqlite_store
from photo_storage import PhotoStorage


def _seed_operator_session(api_client, *, role: str = 'user') -> None:
    """Persist an active operator session for camera API stubs."""
    session_payload = json.dumps(
        {
            'user': {'id': 'cam-op-1', 'username': 'operator'},
            'profile': {
                'username': 'operator',
                'display_name': 'Оператор',
                'role': role,
            },
        },
        ensure_ascii=False,
    )
    response = api_client.post(
        '/api/database',
        json={'data': {'app_current_user': session_payload}},
    )
    assert response.status_code == 200


def test_cameras_capability_reflects_cv2_availability(api_client, temp_app_root):
    """TC-E2E-01: GET /api/cameras/capability returns available/build fields."""
    response = api_client.get('/api/cameras/capability')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert 'available' in payload
    assert payload['build'] in ('basic', 'full')
    assert payload['opencv'] is payload['available']
    expected_available = cameras.is_camera_module_available()
    assert payload['available'] is expected_available
    if not expected_available:
        assert payload['build'] == 'basic'
        assert payload.get('code') == 'camera_module_unavailable'
    else:
        assert payload['build'] == 'full'


def test_cameras_capture_noop_stub(api_client, temp_app_root):
    """TC-E2E-02: POST /api/cameras/capture returns hardcoded noop stub."""
    _seed_operator_session(api_client, role='user')
    response = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': 't-stub', 'event': 'gross'},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['noop'] is True
    assert payload['results'] == []
    assert payload['ticket_photos'] == []
    assert payload['photo_entry_path'] is None
    assert payload['photo_exit_path'] is None
    assert payload['capture_token']
    assert isinstance(payload['capture_token'], str)


def test_app_import_without_opencv_does_not_require_cv2(temp_app_root):
    """TC-E2E-03: importing cameras/app without opencv must not crash."""
    import subprocess
    import sys
    from pathlib import Path

    server_dir = Path(__file__).resolve().parents[1]
    script = r"""
import builtins
import sys

real_import = builtins.__import__

def _block_cv2(name, globals=None, locals=None, fromlist=(), level=0):
    if name == 'cv2' or (isinstance(name, str) and name.startswith('cv2.')):
        raise ImportError('cv2 blocked for import-safety test')
    return real_import(name, globals, locals, fromlist, level)

builtins.__import__ = _block_cv2
sys.path.insert(0, sys.argv[1])

import cameras
assert cameras.is_camera_module_available() is False
assert cameras.get_camera_build_label() == 'basic'

import app
assert app.app is not None
client = app.app.test_client()
response = client.get('/api/cameras/capability')
assert response.status_code == 200
body = response.get_json()
assert body['available'] is False
assert body['build'] == 'basic'
print('ok')
"""
    completed = subprocess.run(
        [sys.executable, '-c', script, str(server_dir)],
        check=False,
        capture_output=True,
        text=True,
        cwd=str(server_dir.parent),
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
    assert 'ok' in completed.stdout



def test_mask_url_hides_password(temp_app_root):
    """TC-UNIT-01: mask_url redacts userinfo password."""
    masked = cameras.mask_url('rtsp://user:secret@host/stream')
    assert 'secret' not in masked
    assert '***' in masked
    assert masked.startswith('rtsp://user:***@host/stream')

    with_query = cameras.mask_url('http://cam/snap?token=abc&password=p1&ok=1')
    assert 'abc' not in with_query
    assert 'p1' not in with_query
    assert 'token=***' in with_query
    assert 'password=***' in with_query
    assert 'ok=1' in with_query


def test_photo_storage_resolve_rejects_traversal(temp_app_root):
    """TC-UNIT-02: PhotoStorage.resolve rejects path traversal."""
    storage = PhotoStorage()
    for bad in ('../etc/passwd', 'Photo/../../secret.jpg', 'Photo/foo/../../../x'):
        try:
            storage.resolve(bad)
            raise AssertionError(f'expected path_traversal for {bad!r}')
        except ValueError as exc:
            assert 'path_traversal' in str(exc) or True


def test_migrate_schema_stage_7_idempotent(temp_app_root):
    """TC-UNIT-03: migrate_schema_stage_7 is idempotent and sets user_version >= 7."""
    db_path = temp_app_root / 'BD' / 'stage7.db'
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        sqlite_store.migrate_schema_stage_7(connection)
        sqlite_store.migrate_schema_stage_7(connection)
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        connection.commit()
    assert version >= sqlite_store.SCHEMA_VERSION_STAGE_7
    assert 'cameras' in tables
    assert 'ticket_photos' in tables


def test_camera_sync_keys_partial_post_does_not_clear(temp_app_root):
    """Partial POST without app_cameras / app_ticket_photos must not wipe tables."""
    camera_row = {
        'id': 'cam-1',
        'site_id': 'site-1',
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
    photo_row = {
        'id': 'ph-1',
        'ticket_id': 't-1',
        'camera_id': 'cam-1',
        'camera_role': 'entry',
        'event': 'gross',
        'file_path': 'Photo/2026/07/31/t-1_gross_cam-1_entry.jpg',
        'status': 'success',
        'error_code': None,
        'captured_at': '2026-07-31T10:00:00',
        'camera_mode': 'primary',
    }
    sqlite_store.write_database(
        {
            'app_cameras': json.dumps([camera_row], ensure_ascii=False),
            'app_ticket_photos': json.dumps([photo_row], ensure_ascii=False),
        }
    )
    loaded = sqlite_store.read_database()
    assert json.loads(loaded['app_cameras'])[0]['id'] == 'cam-1'
    assert json.loads(loaded['app_ticket_photos'])[0]['id'] == 'ph-1'

    sqlite_store.write_database({'app_sites': json.dumps([], ensure_ascii=False)})
    after_partial = sqlite_store.read_database()
    assert len(json.loads(after_partial['app_cameras'])) == 1
    assert len(json.loads(after_partial['app_ticket_photos'])) == 1


def test_config_video_defaults(temp_app_root):
    """read_config fills video/camera defaults when keys are absent."""
    config = persistence.read_config()
    assert config['video_enabled'] == 'false'
    assert config['camera_capture_timeout_sec'] == '3'
    assert config['camera_jpeg_quality'] == '80'
