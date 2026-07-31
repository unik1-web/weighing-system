"""API E2E / unit tests for POST /api/cameras/etalon (UC-02)."""

from __future__ import annotations

import base64
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import persistence
import sqlite_store
from photo_storage import PhotoStorage

FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures'
MINIMAL_JPEG = (FIXTURES_DIR / 'minimal.jpg').read_bytes()

# Distinct marker JPEG so overwrite-protection tests can detect changes.
OLD_ETALON_JPEG = (
    MINIMAL_JPEG[:-1] + b'\x00'
    if len(MINIMAL_JPEG) > 2
    else MINIMAL_JPEG
)
if OLD_ETALON_JPEG == MINIMAL_JPEG:
    OLD_ETALON_JPEG = MINIMAL_JPEG + b'\x00'


def _seed_session(api_client, *, role: str = 'admin') -> None:
    """Persist an active operator session for camera API."""
    session_payload = json.dumps(
        {
            'user': {'id': f'etalon-{role}', 'username': role},
            'profile': {
                'username': role,
                'display_name': role,
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


def _camera_row(**overrides):
    """Camera registry row for etalon tests."""
    base = {
        'id': 'cam-etalon-1',
        'site_id': 'default-site',
        'name': 'Въезд',
        'role': 'entry',
        'http_snapshot_url': 'http://127.0.0.1:9/missing.jpg',
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
    base.update(overrides)
    return base


class _JpegHandler(BaseHTTPRequestHandler):
    """Serve fixed minimal JPEG."""

    def do_GET(self):  # noqa: N802
        payload = MINIMAL_JPEG
        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A003
        return


def _start_jpeg_server() -> tuple[ThreadingHTTPServer, str]:
    """Bind local JPEG fixture server; return (server, snapshot_url)."""
    server = ThreadingHTTPServer(('127.0.0.1', 0), _JpegHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f'http://{host}:{port}/snapshot.jpg'


def _pick_closed_port() -> int:
    """Return a free TCP port that is not listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def test_etalon_spare_capture_writes_file_and_path(api_client, temp_app_root):
    """TC-E2E-01: spare etalon → Photo/etalons/{id}/spare.jpg + path; primary null."""
    server, url = _start_jpeg_server()
    try:
        _seed_session(api_client, role='admin')
        cam = _camera_row(http_snapshot_url=url)
        seed = api_client.post(
            '/api/database',
            json={'data': {'app_cameras': json.dumps([cam], ensure_ascii=False)}},
        )
        assert seed.status_code == 200

        response = api_client.post(
            '/api/cameras/etalon',
            json={'camera_id': cam['id'], 'scale_set': 'spare'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 200, response.get_json()
        payload = response.get_json()
        assert payload['success'] is True
        assert payload['path'] == f"Photo/etalons/{cam['id']}/spare.jpg"
        decoded = base64.b64decode(payload['preview_jpeg_base64'])
        assert decoded == MINIMAL_JPEG
        assert payload['camera']['etalon_spare_path'] == payload['path']
        assert payload['camera'].get('etalon_primary_path') in (None, '')

        on_disk = temp_app_root / 'Photo' / 'etalons' / cam['id'] / 'spare.jpg'
        assert on_disk.is_file()
        assert on_disk.read_bytes() == MINIMAL_JPEG
        assert not (temp_app_root / 'Photo' / 'etalons' / cam['id'] / 'primary.jpg').exists()

        loaded = json.loads(sqlite_store.read_database()['app_cameras'])
        assert loaded[0]['etalon_spare_path'] == payload['path']
        assert loaded[0]['etalon_primary_path'] is None
    finally:
        server.shutdown()
        server.server_close()


def test_etalon_capture_failure_preserves_previous_file(api_client, temp_app_root):
    """TC-E2E-02: camera error → old etalon file and DB path unchanged."""
    storage = PhotoStorage()
    old_path = storage.write_etalon('cam-etalon-1', 'spare', OLD_ETALON_JPEG)
    on_disk = temp_app_root / 'Photo' / 'etalons' / 'cam-etalon-1' / 'spare.jpg'
    assert on_disk.read_bytes() == OLD_ETALON_JPEG

    closed = _pick_closed_port()
    _seed_session(api_client, role='admin')
    cam = _camera_row(
        http_snapshot_url=f'http://127.0.0.1:{closed}/missing.jpg',
        etalon_spare_path=old_path,
        etalon_primary_path=None,
    )
    seed = api_client.post(
        '/api/database',
        json={'data': {'app_cameras': json.dumps([cam], ensure_ascii=False)}},
    )
    assert seed.status_code == 200

    # Short timeout for closed-port fail-fast.
    persistence.write_config(
        {
            **persistence.read_config(),
            'camera_capture_timeout_sec': '1',
        }
    )

    response = api_client.post(
        '/api/cameras/etalon',
        json={'camera_id': cam['id'], 'scale_set': 'spare'},
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code in (503, 504), response.get_json()
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] in ('camera_unreachable', 'camera_timeout')

    assert on_disk.is_file()
    assert on_disk.read_bytes() == OLD_ETALON_JPEG
    loaded = json.loads(sqlite_store.read_database()['app_cameras'])
    assert loaded[0]['etalon_spare_path'] == old_path
    assert loaded[0]['etalon_primary_path'] is None


def test_etalon_stale_client_null_does_not_wipe_path(api_client, temp_app_root):
    """TC-E2E-03: stale client null does not erase etalon path on sync replace."""
    server, url = _start_jpeg_server()
    try:
        _seed_session(api_client, role='admin')
        cam = _camera_row(http_snapshot_url=url)
        api_client.post(
            '/api/database',
            json={'data': {'app_cameras': json.dumps([cam], ensure_ascii=False)}},
        )
        captured = api_client.post(
            '/api/cameras/etalon',
            json={'camera_id': cam['id'], 'scale_set': 'primary'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert captured.status_code == 200, captured.get_json()
        path = captured.get_json()['path']

        stale = dict(cam)
        stale['etalon_primary_path'] = None
        stale['etalon_spare_path'] = None
        stale['name'] = 'Stale client'
        sync = api_client.post(
            '/api/database',
            json={'data': {'app_cameras': json.dumps([stale], ensure_ascii=False)}},
        )
        assert sync.status_code == 200

        loaded = json.loads(sqlite_store.read_database()['app_cameras'])
        assert loaded[0]['etalon_primary_path'] == path
        assert loaded[0]['name'] == 'Stale client'
        assert (temp_app_root / 'Photo' / 'etalons' / cam['id'] / 'primary.jpg').is_file()
    finally:
        server.shutdown()
        server.server_close()


def test_etalon_path_format_unit(temp_app_root):
    """TC-UNIT-01: etalon path format Photo/etalons/{id}/{primary|spare}.jpg."""
    storage = PhotoStorage()
    assert storage.etalon_relpath('cam-x', 'primary') == 'Photo/etalons/cam-x/primary.jpg'
    assert storage.etalon_relpath('cam-x', 'spare') == 'Photo/etalons/cam-x/spare.jpg'
    written = storage.write_etalon('cam-x', 'primary', MINIMAL_JPEG)
    assert written == 'Photo/etalons/cam-x/primary.jpg'
    assert (temp_app_root / 'Photo' / 'etalons' / 'cam-x' / 'primary.jpg').is_file()


def test_etalon_requires_admin(api_client, temp_app_root):
    """TC-UNIT-02: user role gets 403 on POST /api/cameras/etalon."""
    _seed_session(api_client, role='user')
    cam = _camera_row()
    api_client.post(
        '/api/database',
        json={'data': {'app_cameras': json.dumps([cam], ensure_ascii=False)}},
    )
    response = api_client.post(
        '/api/cameras/etalon',
        json={'camera_id': cam['id'], 'scale_set': 'primary'},
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code == 403
    assert response.get_json().get('code') == 'insufficient_permissions'
