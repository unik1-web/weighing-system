"""Flask /api/scales/* with mock TCP scale server."""

from __future__ import annotations

import json
import socket
import threading
import time

import pytest


def _seed_scales(api_client, transport='tcp', host='127.0.0.1', tcp_port=9001, adapter_id='microsim-m0601'):
    site_id = 'site-1'
    scale_id = 'scale-primary'
    data = {
        'app_sites': json.dumps(
            [{'id': site_id, 'name': 'Площадка', 'is_default': True, 'created_at': '2026-01-01T00:00:00Z'}]
        ),
        'app_scales': json.dumps(
            [
                {
                    'id': scale_id,
                    'site_id': site_id,
                    'role': 'primary',
                    'name': 'Основные',
                    'adapter_id': adapter_id,
                    'connection': {
                        'transport': transport,
                        'baudRate': 9600,
                        'parity': 'none',
                        'dataBits': 8,
                        'stopBits': 1,
                        'lineTerminator': '\r\n',
                        'host': host,
                        'tcpPort': tcp_port,
                    },
                    'enabled': True,
                    'created_at': '2026-01-01T00:00:00Z',
                }
            ]
        ),
        'app_site_runtime': json.dumps(
            [
                {
                    'site_id': site_id,
                    'active_scale_set': 'primary',
                    'camera_mode': 'normal',
                    'anpr_mode': 'enabled',
                    'switch_reason': None,
                    'switch_by_operator_id': None,
                    'switch_by_operator_name': None,
                    'switch_at': None,
                }
            ]
        ),
        'app_weighing_tickets': '[]',
    }
    resp = api_client.post('/api/database', json={'data': data})
    assert resp.status_code == 200
    assert resp.get_json()['success'] is True


class _MockTcpScale:
    def __init__(self, host: str, port: int, frames: list[bytes]):
        self.host = host
        self.port = port
        self.frames = frames
        self._server: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> int:
        self._server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server.bind((self.host, self.port))
        self._server.listen(1)
        self._server.settimeout(0.5)
        bound_port = self._server.getsockname()[1]
        self.port = bound_port

        def _serve() -> None:
            assert self._server is not None
            while not self._stop.is_set():
                try:
                    conn, _addr = self._server.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                with conn:
                    for frame in self.frames:
                        try:
                            conn.sendall(frame)
                            time.sleep(0.05)
                        except OSError:
                            break
                    # keep open briefly for client reads
                    time.sleep(0.3)

        self._thread = threading.Thread(target=_serve, daemon=True)
        self._thread.start()
        return bound_port

    def stop(self) -> None:
        self._stop.set()
        if self._server is not None:
            try:
                self._server.close()
            except OSError:
                pass
        if self._thread is not None:
            self._thread.join(timeout=2.0)


@pytest.fixture(autouse=True)
def _reset_scale_session():
    import scale_io

    scale_io.get_scale_session().disconnect()
    yield
    scale_io.get_scale_session().disconnect()


def test_scales_context(api_client):
    _seed_scales(api_client, transport='tcp', tcp_port=9010)
    resp = api_client.get('/api/scales/context')
    body = resp.get_json()
    assert resp.status_code == 200
    assert body['success'] is True
    assert body['adapter_id'] == 'microsim-m0601'
    assert body['transport'] == 'tcp'
    assert body['connection']['tcpPort'] == 9010


def test_scales_serial_stub_501(api_client):
    _seed_scales(api_client, transport='serial')
    resp = api_client.post('/api/scales/connect', json={})
    assert resp.status_code == 501
    body = resp.get_json()
    assert body['success'] is False
    assert 'serial' in body['message'].lower() or 'COM' in body['message']


def test_scales_web_serial_rejected(api_client):
    _seed_scales(api_client, transport='web_serial')
    resp = api_client.post('/api/scales/connect', json={})
    assert resp.status_code == 400
    assert 'браузере' in resp.get_json()['message']


def test_scales_tcp_connect_reading_disconnect(api_client):
    mock = _MockTcpScale('127.0.0.1', 0, [b'ST,GS,+  12345.6kg\r\n'])
    port = mock.start()
    try:
        _seed_scales(api_client, transport='tcp', tcp_port=port)
        connect = api_client.post('/api/scales/connect', json={})
        assert connect.status_code == 200, connect.get_json()
        assert connect.get_json()['connected'] is True

        reading = None
        for _ in range(40):
            resp = api_client.get('/api/scales/reading')
            body = resp.get_json()
            assert body['success'] is True
            if body.get('reading'):
                reading = body['reading']
                break
            time.sleep(0.05)

        assert reading is not None
        assert reading['weight'] == pytest.approx(12345.6)

        disc = api_client.post('/api/scales/disconnect', json={})
        assert disc.status_code == 200
        assert disc.get_json()['connected'] is False
    finally:
        mock.stop()
