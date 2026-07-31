"""Camera-domain structured logging: redaction and operational trails."""

from __future__ import annotations

import json
import logging
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import persistence
from camera_logging import (
    log_capture_result,
    log_capture_start,
    log_etalon_result,
    log_photo_io_error,
    log_snapshot_result,
    log_video_enabled_changed,
)
from cameras import mask_url

FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures'
MINIMAL_JPEG = (FIXTURES_DIR / 'minimal.jpg').read_bytes()


def _camera_payloads(caplog) -> list[dict]:
    """Parse structured JSON payloads from ``camera ...`` log messages."""
    payloads: list[dict] = []
    for record in caplog.records:
        message = record.getMessage()
        if not message.startswith('camera '):
            continue
        raw = message[len('camera ') :]
        payloads.append(json.loads(raw))
    return payloads


def test_mask_url_redaction_in_camera_logging(caplog):
    """TC-UNIT-01: mask_url / redaction — plaintext password never in camera logs."""
    secret_url = 'http://admin:s3cretPass@127.0.0.1/snap?token=abc&password=p1&ok=1'
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        log_capture_start(
            't-1',
            'gross',
            'cam-1',
            'entry',
            masked_url=secret_url,
        )
        log_capture_result(
            't-1',
            'gross',
            'cam-1',
            'entry',
            status='failed',
            error_code='unreachable',
            masked_url=secret_url,
        )
        log_etalon_result(
            'cam-1',
            'primary',
            status='failed',
            error_code='timeout',
            masked_url=secret_url,
        )
        log_snapshot_result(
            status='failed',
            camera_id='cam-1',
            error_code='unreachable',
            masked_url=secret_url,
        )

    text = caplog.text
    assert 's3cretPass' not in text
    assert 'token=abc' not in text
    assert 'password=p1' not in text
    assert '***' in text

    payloads = _camera_payloads(caplog)
    assert len(payloads) >= 4
    for payload in payloads:
        masked = payload.get('masked_url') or ''
        assert 's3cretPass' not in masked
        assert mask_url(secret_url) == masked or masked == ''


def test_capture_log_payload_required_fields(caplog):
    """TC-UNIT-02: payload contains ticket_id, capture_event, camera_id, status."""
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        log_capture_start('ticket-42', 'tare', 'cam-entry', 'entry')
        log_capture_result(
            'ticket-42',
            'tare',
            'cam-entry',
            'entry',
            status='timeout',
            error_code='timeout',
            masked_url='rtsp://user:***@cam/stream',
        )

    payloads = _camera_payloads(caplog)
    assert len(payloads) == 2
    start, result = payloads
    assert start['event'] == 'capture'
    assert start['status'] == 'start'
    assert start['ticket_id'] == 'ticket-42'
    assert start['capture_event'] == 'tare'
    assert start['camera_id'] == 'cam-entry'
    assert start['role'] == 'entry'

    assert result['event'] == 'capture'
    assert result['status'] == 'timeout'
    assert result['ticket_id'] == 'ticket-42'
    assert result['capture_event'] == 'tare'
    assert result['camera_id'] == 'cam-entry'
    assert result['error_code'] == 'timeout'


def test_video_enabled_and_photo_io_helpers(caplog):
    """Unit: video_enabled toggle and photo_io error emit structured events."""
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        log_video_enabled_changed('false', 'true', operator='admin')
        log_photo_io_error(
            operation='write_ticket_photo',
            path='Photo/2026/07/31/t.jpg',
            ticket_id='t-1',
            camera_id='cam-1',
            error=OSError('disk full'),
        )

    payloads = _camera_payloads(caplog)
    assert payloads[0]['event'] == 'video_enabled'
    assert payloads[0]['status'] == 'changed'
    assert payloads[0]['old_value'] == 'false'
    assert payloads[0]['new_value'] == 'true'
    assert payloads[0]['operator'] == 'admin'

    assert payloads[1]['event'] == 'photo_io'
    assert payloads[1]['status'] == 'error'
    assert payloads[1]['operation'] == 'write_ticket_photo'
    assert 'disk full' in str(payloads[1].get('reason', ''))


# --- E2E via real Flask capture / config endpoints ---


def _seed_operator_session(api_client, *, role: str = 'user') -> None:
    session_payload = json.dumps(
        {
            'user': {'id': 'cam-log-op', 'username': 'operator'},
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
    base = {
        'id': 't-cam-log-1',
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
        'tare_weight': None,
        'net_weight': None,
        'total_amount': None,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-31T10:00:00',
        'tare_datetime': None,
        'scale_device': 'test',
        'manual_weight_reason': None,
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'open',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-07-31T10:00:00',
        'completed_at': None,
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
    base = {
        'id': 'cam-log-1',
        'site_id': 'site-1',
        'name': 'Въезд',
        'role': 'entry',
        'http_snapshot_url': 'http://admin:SuperSecret99@127.0.0.1:9/missing.jpg',
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


class _HangHandler(BaseHTTPRequestHandler):
    """HTTP handler that never responds (forces capture timeout)."""

    def do_GET(self):  # noqa: N802
        while True:
            time.sleep(60)

    def log_message(self, format, *args):  # noqa: A003
        return


def _start_hang_server() -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(('127.0.0.1', 0), _HangHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f'http://admin:HangSecret@{host}:{port}/snap.jpg'


def _pick_closed_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def _enable_video() -> None:
    config = persistence.read_config()
    config['video_enabled'] = 'true'
    config['camera_capture_timeout_sec'] = '1'
    config['camera_jpeg_quality'] = '80'
    persistence.write_config(config)


def test_e2e_capture_degrade_logs_without_password(api_client, temp_app_root, caplog):
    """TC-E2E-01: capture degrade logs timeout/unreachable without plaintext password."""
    hang_server, hang_url = _start_hang_server()
    closed = _pick_closed_port()
    unreachable_url = f'http://admin:UnreachSecret99@127.0.0.1:{closed}/snap.jpg'
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
                                id='cam-timeout',
                                role='entry',
                                http_snapshot_url=hang_url,
                                sort_order=0,
                            ),
                            _camera_row(
                                id='cam-unreachable',
                                role='exit',
                                name='Выезд',
                                http_snapshot_url=unreachable_url,
                                sort_order=1,
                            ),
                        ],
                        ensure_ascii=False,
                    ),
                }
            },
        )
        assert seed.status_code == 200, seed.get_json()

        with caplog.at_level(logging.INFO, logger='weighing-system-api'):
            response = api_client.post(
                '/api/cameras/capture',
                json={'ticket_id': 't-cam-log-1', 'event': 'gross'},
            )

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body.get('success') is True
        assert body.get('noop') is False
        results = {row['camera_id']: row for row in body.get('results') or []}
        assert results['cam-timeout']['status'] == 'failed'
        assert results['cam-timeout']['error_code'] == 'timeout'
        assert results['cam-unreachable']['status'] == 'failed'
        assert results['cam-unreachable']['error_code'] == 'unreachable'

        log_text = caplog.text
        assert 'HangSecret' not in log_text
        assert 'UnreachSecret99' not in log_text
        assert 'SuperSecret99' not in log_text

        payloads = _camera_payloads(caplog)
        capture_events = [p for p in payloads if p.get('event') == 'capture']
        assert any(p.get('status') == 'start' for p in capture_events)
        statuses = {p.get('status') for p in capture_events}
        assert 'timeout' in statuses
        assert 'failed' in statuses
        for payload in capture_events:
            assert payload.get('ticket_id') == 't-cam-log-1'
            assert payload.get('capture_event') == 'gross'
            assert payload.get('camera_id') in ('cam-timeout', 'cam-unreachable')
            masked = payload.get('masked_url') or ''
            if masked:
                assert 'HangSecret' not in masked
                assert 'UnreachSecret99' not in masked
                assert ':***' in masked or '***' in masked
    finally:
        hang_server.shutdown()


def test_e2e_video_enabled_change_logs_event(api_client, temp_app_root, caplog):
    """TC-E2E-02: changing video_enabled writes a structured log event."""
    _seed_operator_session(api_client, role='admin')
    current = persistence.read_config()
    old_value = str(current.get('video_enabled', 'false'))
    new_value = 'false' if old_value.lower() in ('1', 'true', 'yes', 'on') else 'true'

    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        response = api_client.post(
            '/api/config',
            json={
                'config': {
                    'video_enabled': new_value,
                    'camera_capture_timeout_sec': current.get(
                        'camera_capture_timeout_sec', '3'
                    ),
                    'camera_jpeg_quality': current.get('camera_jpeg_quality', '80'),
                    'weighing_mode_default': current.get(
                        'weighing_mode_default', 'single'
                    ),
                }
            },
        )

    assert response.status_code == 200, response.get_json()
    payloads = [p for p in _camera_payloads(caplog) if p.get('event') == 'video_enabled']
    assert len(payloads) == 1
    assert payloads[0]['status'] == 'changed'
    assert payloads[0]['old_value'] == old_value
    assert payloads[0]['new_value'] == new_value
    assert payloads[0].get('operator') in ('admin', 'Админ', 'Оператор')
