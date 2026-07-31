"""No-mock E2E: flush → capture → client upsert merge → flush orchestration."""

from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import persistence

FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures'
MINIMAL_JPEG = (FIXTURES_DIR / 'minimal.jpg').read_bytes()


def _seed_operator_session(api_client, *, role: str = 'user') -> None:
    """Persist an active operator session for camera API."""
    session_payload = json.dumps(
        {
            'user': {'id': 'orch-op', 'username': 'operator'},
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
    """Minimal weighing ticket dict for sync payloads."""
    base = {
        'id': 't-orch-a',
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
        'id': 'cam-entry',
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
    """Serve fixed minimal JPEG for HTTP snapshot fixture."""

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
    """Bind ThreadingHTTPServer on 127.0.0.1; return (server, snapshot_url)."""
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


def _enable_video() -> None:
    """Turn on video_enabled in isolated config.ini."""
    config = persistence.read_config()
    config['video_enabled'] = 'true'
    config['camera_capture_timeout_sec'] = '2'
    config['camera_jpeg_quality'] = '80'
    persistence.write_config(config)


def _upsert_ticket_photos(full_list: list[dict], capture_rows: list[dict]) -> list[dict]:
    """
    Client-side upsert by id or UNIQUE (ticket_id, camera_id, event).

    Mirrors ``upsertTicketPhotosFromCapture`` — never replaceAll.
    """
    result = [dict(row) for row in full_list]
    for incoming in capture_rows:
        by_id = next((i for i, row in enumerate(result) if row.get('id') == incoming.get('id')), -1)
        if by_id >= 0:
            result[by_id] = dict(incoming)
            continue
        key = (
            str(incoming.get('ticket_id')),
            str(incoming.get('camera_id')),
            str(incoming.get('event')),
        )
        by_key = next(
            (
                i
                for i, row in enumerate(result)
                if (
                    str(row.get('ticket_id')),
                    str(row.get('camera_id')),
                    str(row.get('event')),
                )
                == key
            ),
            -1,
        )
        if by_key >= 0:
            result[by_key] = dict(incoming)
        else:
            result.append(dict(incoming))
    return result


def _load_sync(api_client) -> dict[str, str]:
    """GET /api/database → data map."""
    payload = api_client.get('/api/database').get_json()
    assert payload.get('success') is True
    return payload['data']


def test_orchestration_single_save_http_fixture_files_and_preview(
    api_client, temp_app_root
):
    """
    TC-E2E-01 (no-mock): flush ticket → HTTP capture → client upsert → flush.

    Asserts JPEG on disk, photo_* stubs, and preview rows in app_ticket_photos.
    """
    server, url = _start_jpeg_server()
    try:
        _enable_video()
        _seed_operator_session(api_client)

        ticket = _ticket_row()
        camera = _camera_row(http_snapshot_url=url)

        # 1) Client flush after single save (ticket in active DB before capture).
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps([ticket], ensure_ascii=False),
                    'app_cameras': json.dumps([camera], ensure_ascii=False),
                    'app_ticket_photos': json.dumps([], ensure_ascii=False),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        # 2) Capture gross (single gesture would also call tare — one phase is enough here).
        capture = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': ticket['id'], 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert capture.status_code == 200, capture.get_json()
        body = capture.get_json()
        assert body['success'] is True
        assert body['noop'] is False
        assert body['capture_token']
        assert body['photo_entry_path']
        assert len(body['ticket_photos']) >= 1

        from photo_storage import PhotoStorage

        storage = PhotoStorage()
        for row in body['ticket_photos']:
            assert row['ticket_id'] == ticket['id']
            if row['status'] == 'success':
                assert storage.file_exists(row['file_path'])

        # 3) Client immediate merge (upsert into full app_ticket_photos) + capture_token.
        data = _load_sync(api_client)
        existing_photos = json.loads(data.get('app_ticket_photos') or '[]')
        merged_photos = _upsert_ticket_photos(existing_photos, body['ticket_photos'])
        tickets = json.loads(data.get('app_weighing_tickets') or '[]')
        for row in tickets:
            if row['id'] == ticket['id']:
                row['photo_entry_path'] = body['photo_entry_path']
                row['photo_exit_path'] = body.get('photo_exit_path')
                row['capture_token'] = body['capture_token']

        flush2 = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
                    'app_ticket_photos': json.dumps(merged_photos, ensure_ascii=False),
                    'app_cameras': data.get('app_cameras') or json.dumps([camera]),
                }
            },
        )
        assert flush2.status_code == 200, flush2.get_json()

        # 4) Preview data in storage + stubs + weight intact.
        final = _load_sync(api_client)
        final_photos = json.loads(final['app_ticket_photos'])
        final_tickets = json.loads(final['app_weighing_tickets'])
        assert any(p['ticket_id'] == ticket['id'] and p.get('file_path') for p in final_photos)
        match = next(t for t in final_tickets if t['id'] == ticket['id'])
        assert match['gross_weight'] == 20000
        assert match['photo_entry_path'] == body['photo_entry_path']
        assert storage.file_exists(match['photo_entry_path'])
    finally:
        server.shutdown()
        server.server_close()


def test_orchestration_dual_gross_then_tare_both_phases(api_client, temp_app_root):
    """TC-E2E-02: dual first gross then complete tare → photos for both events."""
    server, url = _start_jpeg_server()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        open_ticket = _ticket_row(
            id='t-dual',
            status='open',
            completed_at=None,
            tare_weight=None,
            net_weight=None,
            total_amount=None,
            weighing_mode='dual',
        )
        camera = _camera_row(http_snapshot_url=url)
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps([open_ticket], ensure_ascii=False),
                    'app_cameras': json.dumps([camera], ensure_ascii=False),
                    'app_ticket_photos': json.dumps([], ensure_ascii=False),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        gross = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-dual', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert gross.status_code == 200, gross.get_json()
        gbody = gross.get_json()
        assert gbody['noop'] is False

        data = _load_sync(api_client)
        photos = _upsert_ticket_photos(
            json.loads(data.get('app_ticket_photos') or '[]'),
            gbody['ticket_photos'],
        )
        tickets = json.loads(data['app_weighing_tickets'])
        for row in tickets:
            if row['id'] == 't-dual':
                row['status'] = 'completed'
                row['tare_weight'] = 8000
                row['net_weight'] = 12000
                row['total_amount'] = 1200
                row['completed_at'] = '2026-07-31T11:00:00'
                row['photo_entry_path'] = gbody['photo_entry_path']
                row['capture_token'] = gbody['capture_token']

        assert (
            api_client.post(
                '/api/database',
                json={
                    'data': {
                        'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
                        'app_ticket_photos': json.dumps(photos, ensure_ascii=False),
                        'app_cameras': data['app_cameras'],
                    }
                },
            ).status_code
            == 200
        )

        tare = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-dual', 'event': 'tare'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert tare.status_code == 200, tare.get_json()
        tbody = tare.get_json()
        data2 = _load_sync(api_client)
        photos2 = _upsert_ticket_photos(
            json.loads(data2.get('app_ticket_photos') or '[]'),
            tbody['ticket_photos'],
        )
        events = {p['event'] for p in photos2 if p['ticket_id'] == 't-dual'}
        assert 'gross' in events
        assert 'tare' in events
    finally:
        server.shutdown()
        server.server_close()


def test_orchestration_camera_down_ticket_completed(api_client, temp_app_root):
    """TC-E2E-03: camera down → ticket completed, failed metadata, no hard-fail."""
    closed = _pick_closed_port()
    _enable_video()
    _seed_operator_session(api_client)
    ticket = _ticket_row(id='t-degrade')
    camera = _camera_row(
        http_snapshot_url=f'http://127.0.0.1:{closed}/missing.jpg',
    )
    seed = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([ticket], ensure_ascii=False),
                'app_cameras': json.dumps([camera], ensure_ascii=False),
            }
        },
    )
    assert seed.status_code == 200, seed.get_json()

    capture = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': 't-degrade', 'event': 'gross'},
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert capture.status_code == 200, capture.get_json()
    body = capture.get_json()
    assert body['success'] is True
    assert any(r['status'] == 'failed' for r in body['results'])
    assert any(p['status'] == 'failed' for p in body['ticket_photos'])

    data = _load_sync(api_client)
    tickets = json.loads(data['app_weighing_tickets'])
    match = next(t for t in tickets if t['id'] == 't-degrade')
    assert match['status'] == 'completed'
    assert match['gross_weight'] == 20000


def test_orchestration_capture_a_flush_preserves_b(api_client, temp_app_root):
    """TC-E2E-04: capture A + client upsert flush does not remove ticket B photos."""
    server, url = _start_jpeg_server()
    try:
        _enable_video()
        _seed_operator_session(api_client)
        ticket_a = _ticket_row(id='t-a', ticket_number=1)
        ticket_b = _ticket_row(id='t-b', ticket_number=2, vehicle_number='В002ВВ56')
        photo_b = {
            'id': 'ph-b',
            'ticket_id': 't-b',
            'camera_id': 'cam-entry',
            'camera_role': 'entry',
            'event': 'gross',
            'file_path': 'Photo/2026/07/31/b.jpg',
            'status': 'success',
            'error_code': None,
            'captured_at': '2026-07-31T09:00:00',
            'camera_mode': 'primary',
        }
        camera = _camera_row(http_snapshot_url=url)
        seed = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(
                        [ticket_a, ticket_b], ensure_ascii=False
                    ),
                    'app_cameras': json.dumps([camera], ensure_ascii=False),
                    'app_ticket_photos': json.dumps([photo_b], ensure_ascii=False),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        capture = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 't-a', 'event': 'gross'},
            headers={'Origin': 'http://127.0.0.1:5001'},
        )
        assert capture.status_code == 200, capture.get_json()
        body = capture.get_json()
        assert all(p['ticket_id'] == 't-a' for p in body['ticket_photos'])

        data = _load_sync(api_client)
        existing = json.loads(data.get('app_ticket_photos') or '[]')
        before_b = [p for p in existing if p['ticket_id'] == 't-b']
        assert len(before_b) >= 1

        # Correct client merge
        merged = _upsert_ticket_photos(existing, body['ticket_photos'])
        tickets = json.loads(data['app_weighing_tickets'])
        for row in tickets:
            if row['id'] == 't-a':
                row['photo_entry_path'] = body['photo_entry_path']
                row['capture_token'] = body['capture_token']

        flush = api_client.post(
            '/api/database',
            json={
                'data': {
                    'app_weighing_tickets': json.dumps(tickets, ensure_ascii=False),
                    'app_ticket_photos': json.dumps(merged, ensure_ascii=False),
                    'app_cameras': data['app_cameras'],
                }
            },
        )
        assert flush.status_code == 200, flush.get_json()

        final = json.loads(_load_sync(api_client)['app_ticket_photos'])
        after_b = [p for p in final if p['ticket_id'] == 't-b']
        assert len(after_b) >= len(before_b)
        assert any(p['ticket_id'] == 't-a' for p in final)
    finally:
        server.shutdown()
        server.server_close()
