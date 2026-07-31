"""API E2E tests for POST /api/cameras/capture orchestration."""

from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import persistence

FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures'
MINIMAL_JPEG = (FIXTURES_DIR / 'minimal.jpg').read_bytes()


def _seed_operator_session(api_client, *, role: str = 'user') -> None:
    """Persist an active operator session for camera API."""
    session_payload = json.dumps(
        {
            'user': {'id': 'capture-api-op', 'username': 'operator'},
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


def _ticket_row(**overrides):
    """Minimal weighing ticket."""
    base = {
        'id': 't-capture-1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Иванов И.И.',
        'cargo_name': 'Грунт',
        'shipper_name': 'Отправитель',
        'receiver_name': 'Получатель',
        'carrier_name': 'Перевозчик',
        'price': 100,
        'vat_rate': 0,
        'gross_weight': 20000,
        'tare_weight': 8000,
        'net_weight': 12000,
        'total_amount': 1200,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-31T10:00:00',
        'tare_datetime': '2026-07-31T10:05:00',
        'scale_device': 'test',
        'manual_weight_reason': None,
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-07-31T10:00:00',
        'completed_at': '2026-07-31T10:05:00',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': 'directory',
        'site_id': 'site-1',
        'scale_id': 's-primary',
        'scale_role': 'primary',
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    base.update(overrides)
    return base


def _camera_row(**overrides):
    """Enabled camera registry row."""
    base = {
        'id': 'cam-1',
        'site_id': 'site-1',
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
    """Serve fixed minimal JPEG; optional artificial delay via class attr."""

    delay_sec = 0.0
    hang_forever = False

    def do_GET(self):  # noqa: N802
        if self.hang_forever:
            while True:
                time.sleep(60)
        if self.delay_sec > 0:
            time.sleep(self.delay_sec)
        payload = MINIMAL_JPEG
        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A003
        return


def _start_jpeg_server(
    *,
    delay_sec: float = 0.0,
    hang_forever: bool = False,
) -> tuple[ThreadingHTTPServer, str]:
    """Bind local JPEG fixture server; return (server, snapshot_url)."""
    handler = type(
        'BoundJpegHandler',
        (_JpegHandler,),
        {'delay_sec': delay_sec, 'hang_forever': hang_forever},
    )
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f'http://{host}:{port}/snapshot.jpg'


def _pick_closed_port() -> int:
    """Return a free TCP port that is not listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def _enable_video() -> None:
    """Turn on video_enabled in isolated config.ini."""
    config = persistence.read_config()
    config['video_enabled'] = 'true'
    config['camera_capture_timeout_sec'] = '2'
    config['camera_jpeg_quality'] = '80'
    persistence.write_config(config)


def test_capture_two_http_cameras_success(api_client, temp_app_root):
    """TC-E2E-01: ticket + 2 HTTP cameras → 2 files + success rows + stubs."""
    server_a, url_a = _start_jpeg_server()
    server_b, url_b = _start_jpeg_server()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(
                        [_ticket_row()], ensure_ascii=False
                    ),
                    'app_cameras': json.dumps(
                        [
                            _camera_row(
                                id='cam-entry',
                                role='entry',
                                http_snapshot_url=url_a,
                                sort_order=0,
                            ),
                            _camera_row(
                                id='cam-exit',
                                role='exit',
                                name='Выезд',
                                http_snapshot_url=url_b,
                                sort_order=1,
                            ),
                        ],
                        ensure_ascii=False,
                    ),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        response = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-capture-1', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body['success'] is True
        assert body['noop'] is False
        assert body['capture_token']
        assert len(body['results']) == 2
        assert all(r['status'] == 'success' for r in body['results'])
        assert body['photo_entry_path']
        assert body['photo_exit_path']
        assert len(body['ticket_photos']) == 2
        assert all(p['ticket_id'] == 't-capture-1' for p in body['ticket_photos'])

        from photo_storage import PhotoStorage

        storage = PhotoStorage()
        for row in body['ticket_photos']:
            assert row['status'] == 'success'
            assert storage.file_exists(row['file_path'])

        # Weight / ticket intact
        loaded = api_client.get('/api/database').get_json()['data']
        tickets = json.loads(loaded['app_weighing_tickets'])
        assert tickets[0]['gross_weight'] == 20000
        assert tickets[0]['photo_entry_path'] == body['photo_entry_path']
        assert tickets[0]['photo_exit_path'] == body['photo_exit_path']
    finally:
        server_a.shutdown()
        server_a.server_close()
        server_b.shutdown()
        server_b.server_close()


def test_capture_mixed_timeout_keeps_ticket(api_client, temp_app_root):
    """TC-E2E-02: one camera timeout → HTTP 200 mixed results; ticket not rolled back."""
    server_ok, url_ok = _start_jpeg_server()
    closed = _pick_closed_port()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(
                        [_ticket_row()], ensure_ascii=False
                    ),
                    'app_cameras': json.dumps(
                        [
                            _camera_row(
                                id='cam-ok',
                                role='entry',
                                http_snapshot_url=url_ok,
                            ),
                            _camera_row(
                                id='cam-bad',
                                role='exit',
                                name='Выезд',
                                http_snapshot_url=(
                                    f'http://127.0.0.1:{closed}/missing.jpg'
                                ),
                                sort_order=1,
                            ),
                        ],
                        ensure_ascii=False,
                    ),
                }
            },
        )
        assert seed.status_code == 200

        response = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-capture-1', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body['success'] is True
        assert body['noop'] is False
        statuses = {r['camera_id']: r['status'] for r in body['results']}
        assert statuses['cam-ok'] == 'success'
        assert statuses['cam-bad'] == 'failed'
        assert body['photo_entry_path']
        # exit failed → stub null (or preserved if any)
        assert body['photo_exit_path'] is None

        loaded = api_client.get('/api/database').get_json()['data']
        tickets = json.loads(loaded['app_weighing_tickets'])
        assert tickets[0]['gross_weight'] == 20000
        assert tickets[0]['net_weight'] == 12000
    finally:
        server_ok.shutdown()
        server_ok.server_close()


def test_capture_ticket_not_found_no_files(api_client, temp_app_root):
    """TC-E2E-03: missing ticket → 404; Photo/ stays empty of ticket files."""
    server, url = _start_jpeg_server()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_cameras': json.dumps(
                        [_camera_row(http_snapshot_url=url)],
                        ensure_ascii=False,
                    ),
                }
            },
        )
        photo_root = temp_app_root / 'Photo'
        before = {p for p in photo_root.rglob('*') if p.is_file()} if photo_root.exists() else set()

        response = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 'missing-ticket', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 404
        body = response.get_json()
        assert body['success'] is False
        assert body['code'] == 'ticket_not_found'

        after = {p for p in photo_root.rglob('*') if p.is_file()} if photo_root.exists() else set()
        assert after == before
    finally:
        server.shutdown()
        server.server_close()


def test_capture_success_then_failed_preserves_via_api(api_client, temp_app_root):
    """TC-E2E-05 via API: success then failed keeps success file and stubs."""
    server_ok, url_ok = _start_jpeg_server()
    closed = _pick_closed_port()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        cameras = [
            _camera_row(id='cam-entry', role='entry', http_snapshot_url=url_ok),
        ]
        api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(
                        [_ticket_row()], ensure_ascii=False
                    ),
                    'app_cameras': json.dumps(cameras, ensure_ascii=False),
                }
            },
        )

        first = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-capture-1', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert first.status_code == 200
        first_body = first.get_json()
        entry_path = first_body['photo_entry_path']
        assert entry_path

        # Point camera to closed port for failed re-capture
        cameras[0]['http_snapshot_url'] = f'http://127.0.0.1:{closed}/x.jpg'
        api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_cameras': json.dumps(cameras, ensure_ascii=False),
                }
            },
        )

        second = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-capture-1', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert second.status_code == 200
        second_body = second.get_json()
        assert second_body['photo_entry_path'] == entry_path
        assert second_body['results'][0]['status'] == 'failed'
        from photo_storage import PhotoStorage

        assert PhotoStorage().file_exists(entry_path)
        rows = [
            r
            for r in second_body['ticket_photos']
            if r['camera_id'] == 'cam-entry' and r['event'] == 'gross'
        ]
        assert len(rows) == 1
        assert rows[0]['status'] == 'success'
    finally:
        server_ok.shutdown()
        server_ok.server_close()


def test_capture_ignores_client_camera_list(api_client, temp_app_root):
    """Enabled cameras come from SQLite only — body camera list is ignored."""
    _enable_video()
    _seed_operator_session(api_client)
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(
                    [_ticket_row()], ensure_ascii=False
                ),
                'app_cameras': json.dumps([], ensure_ascii=False),
            }
        },
    )
    response = api_client.post(
        '/api/cameras/capture',
        json={
            'ticket_id': 't-capture-1',
            'event': 'gross',
            'cameras': [{'id': 'spoof', 'http_snapshot_url': 'http://evil/'}],
        },
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body['noop'] is True
    assert body['results'] == []


def test_capture_http_timeout_keeps_ticket(api_client, temp_app_root):
    """TC-E2E-02: hung HTTP snapshot → failed/timeout policy; ticket weight intact."""
    hang_server, hang_url = _start_jpeg_server(hang_forever=True)
    try:
        config = persistence.read_config()
        config['video_enabled'] = 'true'
        config['camera_capture_timeout_sec'] = '1'
        config['camera_jpeg_quality'] = '80'
        persistence.write_config(config)

        _seed_operator_session(api_client)
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(
                        [_ticket_row()], ensure_ascii=False
                    ),
                    'app_cameras': json.dumps(
                        [
                            _camera_row(
                                id='cam-hang',
                                role='entry',
                                http_snapshot_url=hang_url,
                            ),
                        ],
                        ensure_ascii=False,
                    ),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        response = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-capture-1', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body['success'] is True
        assert body['noop'] is False
        assert len(body['results']) == 1
        assert body['results'][0]['status'] in ('failed', 'timeout')
        assert body['results'][0].get('error_code') == 'timeout'
        assert any(p['status'] == 'failed' for p in body['ticket_photos'])
        assert body['photo_entry_path'] is None

        loaded = api_client.get('/api/database').get_json()['data']
        tickets = json.loads(loaded['app_weighing_tickets'])
        assert tickets[0]['id'] == 't-capture-1'
        assert tickets[0]['gross_weight'] == 20000
        assert tickets[0]['net_weight'] == 12000
        assert tickets[0]['status'] == 'completed'
    finally:
        hang_server.shutdown()
        hang_server.server_close()


def test_capture_noop_with_zero_enabled_cameras(api_client, temp_app_root):
    """TC-UNIT-04: video on + ticket present + 0 enabled cameras → noop."""
    _enable_video()
    _seed_operator_session(api_client)
    seed = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps(
                    [_ticket_row()], ensure_ascii=False
                ),
                'app_cameras': json.dumps(
                    [
                        _camera_row(
                            id='cam-off',
                            enabled=0,
                            http_snapshot_url='http://127.0.0.1:9/x.jpg',
                        ),
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    assert seed.status_code == 200, seed.get_json()

    response = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': 't-capture-1', 'event': 'gross'},
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body['success'] is True
    assert body['noop'] is True
    assert body['results'] == []
    assert body.get('capture_token')


def test_capture_rotation_in_progress_no_files(api_client, temp_app_root):
    """TC-UNIT-05: rotation lock → 409 rotation_in_progress; Photo/ unchanged."""
    from datetime import datetime

    server, url = _start_jpeg_server()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(
                        [_ticket_row()], ensure_ascii=False
                    ),
                    'app_cameras': json.dumps(
                        [_camera_row(http_snapshot_url=url)],
                        ensure_ascii=False,
                    ),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        photo_root = temp_app_root / 'Photo'
        before = (
            {p for p in photo_root.rglob('*') if p.is_file()}
            if photo_root.exists()
            else set()
        )

        persistence.write_rotation_lock(
            {
                'source_year': 2026,
                'target_year': 2027,
                'preview_token': 'preview-capture-gate',
                'source_db_fingerprint': 'fingerprint',
                'started_at': datetime.now().isoformat(),
                'phase': 'tmp_ready',
                'recovery_mode': 'none',
                'backup_path': None,
                'tmp_db_path': str(temp_app_root / 'BD' / 'weighing-2027.db.tmp'),
                'lock_ttl_seconds': 900,
            }
        )

        response = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-capture-1', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert response.status_code == 409, response.get_json()
        body = response.get_json()
        assert body.get('success') is False
        assert body.get('code') == 'rotation_in_progress'

        after = (
            {p for p in photo_root.rglob('*') if p.is_file()}
            if photo_root.exists()
            else set()
        )
        assert after == before
    finally:
        persistence.remove_rotation_lock()
        server.shutdown()
        server.server_close()
