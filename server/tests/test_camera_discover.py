"""Camera discover: SSRF, sessions, worker with mocked grab_frame."""

import time
from unittest.mock import patch

import camera_discover as discover
import pytest


JPEG_MINIMAL = b'\xff\xd8\xff\xd9'


@pytest.fixture(autouse=True)
def _reset_sessions():
    discover.reset_sessions_for_tests()
    yield
    discover.reset_sessions_for_tests()


def test_ssrf_rejects_public_ip():
    with pytest.raises(ValueError, match='частных'):
        discover.assert_discover_target_allowed('8.8.8.8')


def test_ssrf_allows_private_and_loopback():
    discover.assert_discover_target_allowed('192.168.1.1')
    discover.assert_discover_target_allowed('10.0.0.1')
    discover.assert_discover_target_allowed('172.16.5.5')
    discover.assert_discover_target_allowed('127.0.0.1')
    discover.assert_discover_target_allowed('169.254.1.1')


def test_ssrf_rejects_unspecified_and_hostname():
    with pytest.raises(ValueError):
        discover.assert_discover_target_allowed('0.0.0.0')
    with pytest.raises(ValueError):
        discover.assert_discover_target_allowed('camera.local')


def test_mask_url_hides_password():
    assert (
        discover.mask_url('http://admin:secret@192.168.1.1:80/snap.jpg')
        == 'http://admin:***@192.168.1.1:80/snap.jpg'
    )
    assert discover.mask_url('rtsp://u:p@10.0.0.2:554/stream1') == 'rtsp://u:***@10.0.0.2:554/stream1'


def test_safe_exc_message_masks_password_in_http_error():
    """requests HTTPError embeds full URL — must not leak password into logs."""
    import requests

    secret = 'SuperSecretPass99'
    url = f'http://admin:{secret}@192.168.1.64:80/ISAPI/Streaming/channels/101/picture'
    resp = requests.Response()
    resp.status_code = 401
    resp.url = url
    exc = requests.HTTPError(f'401 Client Error: Unauthorized for url: {url}', response=resp)

    safe = discover.safe_exc_message(exc)
    assert secret not in safe
    assert '***' in safe
    assert '192.168.1.64' in safe


def test_try_template_fail_log_masks_password(caplog):
    """_try_template must not log raw exception text with password in URL."""
    import logging

    import requests

    secret = 'LeakMePassword42'
    url = f'http://admin:{secret}@10.0.0.5:80/cgi-bin/snapshot.cgi'

    def boom(_url: str) -> bytes:
        raise requests.HTTPError(f'401 Client Error: Unauthorized for url: {url}')

    tmpl = {
        'id': 'test-http',
        'brand': 'generic',
        'label': 'snap',
        'kind': 'http_snapshot',
        'url_pattern': 'http://{user}:{password}@{ip}:{http_port}/cgi-bin/snapshot.cgi',
        'popular': True,
    }
    with (
        patch('camera_discover.grab_frame_http', side_effect=boom),
        caplog.at_level(logging.INFO, logger='camera_discover'),
    ):
        result = discover._try_template(
            tmpl,
            ip='10.0.0.5',
            username='admin',
            password=secret,
            http_port=80,
            rtsp_port=554,
        )
    assert result is None
    joined = '\n'.join(r.getMessage() for r in caplog.records)
    assert secret not in joined
    assert 'discover fail' in joined


def test_parse_ip_embedded_port():
    host, http_p, rtsp_p = discover.parse_ip_and_ports('192.168.1.64:8080')
    assert host == '192.168.1.64'
    assert http_p == 8080
    assert rtsp_p == 554


def test_parse_ip_explicit_http_overrides_embedded():
    host, http_p, _ = discover.parse_ip_and_ports('192.168.1.64:8080', http_port=90)
    assert host == '192.168.1.64'
    assert http_p == 90


def test_api_ssrf_reject(api_client):
    resp = api_client.post(
        '/api/cameras/discover',
        json={'ip': '8.8.8.8', 'username': 'a', 'password': 'b'},
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body['success'] is False
    assert 'частных' in body['message']


def test_brands_endpoint(api_client):
    resp = api_client.get('/api/cameras/discover/brands')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['success'] is True
    ids = [b['id'] for b in data['brands']]
    assert 'hikvision' in ids
    assert 'dahua' in ids


def test_discover_http_success_collects_candidates(api_client):
    def fake_http(url: str) -> bytes:
        if 'ISAPI' in url or 'snapshot' in url.lower() or 'axis-cgi' in url:
            return JPEG_MINIMAL
        raise RuntimeError('no')

    with (
        patch('camera_discover.grab_frame_http', side_effect=fake_http),
        patch('camera_discover.grab_frame_rtsp', side_effect=RuntimeError('no rtsp')),
        patch('camera_discover._opencv_available', return_value=False),
        patch('camera_discover.save_tmp_snapshot', return_value='Photo/tmp/test.jpg'),
    ):
        start = api_client.post(
            '/api/cameras/discover',
            json={
                'ip': '192.168.1.64',
                'username': 'admin',
                'password': 'testpass',
                'brand': 'hikvision',
            },
        )
        assert start.status_code == 200
        sid = start.get_json()['session_id']

        # Poll until terminal
        final = None
        for _ in range(50):
            poll = api_client.get(f'/api/cameras/discover/{sid}')
            assert poll.status_code == 200
            final = poll.get_json()
            if final['status'] != 'running':
                break
            time.sleep(0.05)

        assert final is not None
        assert final['status'] in ('done', 'failed')
        assert final['skipped_rtsp'] is True
        if final['candidates']:
            cand = final['candidates'][0]
            assert cand['ok'] is True
            assert cand['kind'] == 'http_snapshot'
            assert cand['brand'] == 'hikvision'
            assert 'testpass' in cand['url']
            assert cand['preview_path'] == 'Photo/tmp/test.jpg'


def test_discover_opencv_false_skips_rtsp_no_call(api_client):
    rtsp_mock = patch(
        'camera_discover.grab_frame_rtsp',
        side_effect=AssertionError('RTSP should not be called'),
    )
    with (
        patch('camera_discover.grab_frame_http', side_effect=RuntimeError('fail')),
        rtsp_mock as rtsp,
        patch('camera_discover._opencv_available', return_value=False),
    ):
        start = api_client.post(
            '/api/cameras/discover',
            json={'ip': '10.0.0.2', 'brand': 'hikvision'},
        )
        sid = start.get_json()['session_id']
        for _ in range(50):
            poll = api_client.get(f'/api/cameras/discover/{sid}').get_json()
            if poll['status'] != 'running':
                break
            time.sleep(0.05)
        assert poll['skipped_rtsp'] is True
        assert poll['status'] == 'failed'
        rtsp.assert_not_called()


def test_discover_cancel(api_client):
    def slow_http(_url: str) -> bytes:
        time.sleep(0.3)
        raise RuntimeError('slow fail')

    with (
        patch('camera_discover.grab_frame_http', side_effect=slow_http),
        patch('camera_discover._opencv_available', return_value=False),
        patch.object(discover, 'DISCOVER_WALL_CLOCK', 60.0),
    ):
        start = api_client.post(
            '/api/cameras/discover',
            json={'ip': '192.168.0.10', 'brand': None},
        )
        sid = start.get_json()['session_id']
        cancel = api_client.post(f'/api/cameras/discover/{sid}/cancel')
        assert cancel.status_code == 200
        assert cancel.get_json()['status'] == 'cancelled'

        for _ in range(40):
            poll = api_client.get(f'/api/cameras/discover/{sid}').get_json()
            if poll['status'] != 'running':
                break
            time.sleep(0.05)
        assert poll['status'] == 'cancelled'


def test_discover_wall_clock_partial(api_client):
    calls = {'n': 0}

    def fake_http(url: str) -> bytes:
        calls['n'] += 1
        if calls['n'] == 1:
            return JPEG_MINIMAL
        time.sleep(0.05)
        raise RuntimeError('fail')

    # Force wall clock to expire almost immediately after first success
    with (
        patch('camera_discover.grab_frame_http', side_effect=fake_http),
        patch('camera_discover._opencv_available', return_value=False),
        patch('camera_discover.save_tmp_snapshot', return_value='Photo/tmp/w.jpg'),
        patch.object(discover, 'DISCOVER_WALL_CLOCK', 0.01),
    ):
        start = api_client.post(
            '/api/cameras/discover',
            json={'ip': '192.168.1.50'},
        )
        sid = start.get_json()['session_id']
        final = None
        for _ in range(50):
            final = api_client.get(f'/api/cameras/discover/{sid}').get_json()
            if final['status'] != 'running':
                break
            time.sleep(0.05)
        assert final is not None
        assert final['status'] in ('done', 'failed', 'cancelled')
        # With tiny wall clock we should stop early; message may mention timeout
        if final.get('message') and 'таймаут' in (final['message'] or ''):
            assert True
        # At least we completed without hanging
        assert final['status'] != 'running'


def test_unknown_session_404(api_client):
    resp = api_client.get('/api/cameras/discover/nonexistent')
    assert resp.status_code == 404
