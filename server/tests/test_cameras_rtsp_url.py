"""RTSP/HTTP URL normalization for empty password and comma-IP typos."""

import pytest

from cameras import normalize_stream_url


def test_normalize_empty_password_adds_colon():
    assert (
        normalize_stream_url('rtsp://admin@192.168.1.3:554/cam/realmonitor?channel=1&subtype=0')
        == 'rtsp://admin:@192.168.1.3:554/cam/realmonitor?channel=1&subtype=0'
    )


def test_normalize_keeps_explicit_empty_password():
    url = 'rtsp://admin:@192.168.1.3:554/h264'
    assert normalize_stream_url(url) == url


def test_normalize_keeps_password():
    url = 'rtsp://admin:secret@192.168.1.3:554/h264'
    assert normalize_stream_url(url) == url


def test_normalize_rejects_comma_ip():
    with pytest.raises(ValueError, match='запятыми'):
        normalize_stream_url('rtsp://admin@192.168,1,3:554/h264')


def test_normalize_http_empty_password():
    assert (
        normalize_stream_url('http://admin@192.168.1.3/cgi-bin/snapshot.cgi')
        == 'http://admin:@192.168.1.3/cgi-bin/snapshot.cgi'
    )
