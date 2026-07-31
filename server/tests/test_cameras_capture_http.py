"""HTTP snapshot capture: real local HTTP fixture and closed-port errors."""

from __future__ import annotations

import base64
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cameras
from cameras import CameraCaptureService

FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures'
MINIMAL_JPEG = (FIXTURES_DIR / 'minimal.jpg').read_bytes()


def _seed_operator_session(api_client, *, role: str = 'user') -> None:
    """Persist an active operator session for camera API."""
    session_payload = json.dumps(
        {
            'user': {'id': 'cam-http-op', 'username': 'operator'},
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


class _JpegHandler(BaseHTTPRequestHandler):
    """Serve fixed minimal JPEG for snapshot fixture."""

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
    """Bind ThreadingHTTPServer on 127.0.0.1 and return (server, base_url)."""
    server = ThreadingHTTPServer(('127.0.0.1', 0), _JpegHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f'http://{host}:{port}/snapshot.jpg'


def _pick_closed_port() -> int:
    """Reserve an ephemeral port, close it, and return the free port number."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def test_http_snapshot_e2e_returns_base64(api_client, temp_app_root):
    """TC-E2E-01: real HTTP GET fixture → POST /api/cameras/snapshot 200 + base64."""
    server, url = _start_jpeg_server()
    try:
        _seed_operator_session(api_client, role='user')
        response = api_client.post(
            '/api/cameras/snapshot',
            json={'http_snapshot_url': url, 'timeout_sec': 3},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 200, response.get_json()
        payload = response.get_json()
        assert payload['success'] is True
        assert payload['content_type'] == 'image/jpeg'
        decoded = base64.b64decode(payload['preview_jpeg_base64'])
        assert decoded.startswith(b'\xff\xd8\xff')
        assert decoded == MINIMAL_JPEG
    finally:
        server.shutdown()
        server.server_close()


def test_http_snapshot_closed_port_typed_error(api_client, temp_app_root):
    """TC-E2E-02: snapshot to closed port → typed error; app stays alive."""
    port = _pick_closed_port()
    _seed_operator_session(api_client, role='user')
    response = api_client.post(
        '/api/cameras/snapshot',
        json={
            'http_snapshot_url': f'http://127.0.0.1:{port}/missing.jpg',
            'timeout_sec': 1,
        },
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code == 503
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'camera_unreachable'

    health = api_client.get('/api/health')
    assert health.status_code == 200
    assert health.get_json()['success'] is True


def test_http_capture_service_does_not_import_cv2(temp_app_root, monkeypatch):
    """TC-UNIT-01: HTTP capture path never imports cv2."""
    import builtins

    server, url = _start_jpeg_server()
    real_import = builtins.__import__
    imported_cv2 = {'hit': False}

    def _track_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == 'cv2' or (isinstance(name, str) and name.startswith('cv2.')):
            imported_cv2['hit'] = True
            raise ImportError('cv2 must not be imported on HTTP path')
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, '__import__', _track_import)
    try:
        # Force capability probe false without touching HTTP path.
        monkeypatch.setattr(cameras, 'is_camera_module_available', lambda: False)
        service = CameraCaptureService()
        result = service.capture(url, None, 3.0, 80)
        assert result.ok is True
        assert result.jpeg_bytes == MINIMAL_JPEG
        assert imported_cv2['hit'] is False
    finally:
        server.shutdown()
        server.server_close()


def test_mask_url_in_log_helper(temp_app_root):
    """TC-UNIT-05: mask_url redacts credentials for log helpers."""
    masked = cameras.mask_url('http://admin:s3cret@127.0.0.1/snap?token=abc')
    assert 's3cret' not in masked
    assert 'abc' not in masked
    assert 'admin:***' in masked
    assert 'token=***' in masked
