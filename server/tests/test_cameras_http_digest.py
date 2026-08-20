"""HTTP snapshot grab with Digest/Basic auth retries."""

from cameras import grab_frame_http


def test_grab_frame_http_digest_then_jpeg(monkeypatch):
    calls: list[tuple[str, str]] = []

    class _Resp:
        headers = {'Content-Type': 'image/jpeg'}
        content = b'\xff\xd8\xff\xd9'

        @staticmethod
        def raise_for_status():
            return None

    def fake_get(url, timeout=None, stream=False, auth=None):
        calls.append((url, type(auth).__name__ if auth else 'None'))
        return _Resp()

    monkeypatch.setattr('cameras.requests.get', fake_get)
    monkeypatch.setattr('cameras._encode_jpeg', lambda data: data)

    data = grab_frame_http('http://admin:pass@192.168.1.3/webcapture.jpg?command=snap')
    assert data[:2] == b'\xff\xd8'
    assert any(auth == 'HTTPDigestAuth' for _, auth in calls)
    assert all('admin:pass@' not in url for url, auth in calls if auth == 'HTTPDigestAuth')
