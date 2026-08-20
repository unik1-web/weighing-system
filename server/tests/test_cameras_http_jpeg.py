import pytest

from cameras import grab_frame_http


def test_grab_frame_http_rejects_html(monkeypatch):
    class _Resp:
        headers = {'Content-Type': 'text/html'}
        content = b'<html><body>login</body></html>'

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr('cameras.requests.get', lambda *a, **k: _Resp())

    with pytest.raises(RuntimeError, match='не изображение'):
        grab_frame_http('http://camera/snapshot.jpg')
