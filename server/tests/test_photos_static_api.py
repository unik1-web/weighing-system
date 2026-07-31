"""GET /api/photos static JPEG serving: path guard, origin, content-type (UC-04)."""

from __future__ import annotations

import os

ALLOWED_ORIGIN = 'http://127.0.0.1:5001'
JPEG_BYTES = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9'


def _write_sample_jpeg(temp_app_root) -> str:
    """Write a tiny JPEG under Photo/ and return relative DB path."""
    rel = 'Photo/2026/07/31/preview-sample.jpg'
    absolute = os.path.join(str(temp_app_root), *rel.split('/'))
    os.makedirs(os.path.dirname(absolute), exist_ok=True)
    with open(absolute, 'wb') as handle:
        handle.write(JPEG_BYTES)
    return rel


def test_photos_api_serves_jpeg_without_session(api_client, temp_app_root):
    """TC-E2E-04: GET /api/photos returns image/jpeg; session header not required."""
    rel = _write_sample_jpeg(temp_app_root)

    response = api_client.get(f'/api/photos/{rel}')
    assert response.status_code == 200
    assert response.content_type.startswith('image/jpeg')
    assert response.data[:2] == b'\xff\xd8'


def test_photos_api_allows_missing_origin(api_client, temp_app_root):
    """TC-E2E-04: missing Origin/Referer is allowed (browser <img src>)."""
    rel = _write_sample_jpeg(temp_app_root)
    response = api_client.get(f'/api/photos/{rel}')
    assert response.status_code == 200


def test_photos_api_allows_allowlisted_origin(api_client, temp_app_root):
    """TC-E2E-04: allowlisted Origin is accepted."""
    rel = _write_sample_jpeg(temp_app_root)
    response = api_client.get(
        f'/api/photos/{rel}',
        headers={'Origin': ALLOWED_ORIGIN},
    )
    assert response.status_code == 200
    assert response.content_type.startswith('image/jpeg')


def test_photos_api_rejects_foreign_origin(api_client, temp_app_root):
    """TC-E2E-04: foreign Origin → 403 origin_not_allowed."""
    rel = _write_sample_jpeg(temp_app_root)
    response = api_client.get(
        f'/api/photos/{rel}',
        headers={'Origin': 'http://evil.example'},
    )
    assert response.status_code == 403
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'origin_not_allowed'


def test_photos_api_rejects_path_traversal(api_client, temp_app_root):
    """TC-E2E-04: path traversal is rejected with 400 path_traversal."""
    _write_sample_jpeg(temp_app_root)
    response = api_client.get('/api/photos/Photo/../../etc/passwd')
    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'path_traversal'


def test_photos_api_missing_file_returns_404(api_client, temp_app_root):
    """GET /api/photos returns 404 when file is absent."""
    response = api_client.get('/api/photos/Photo/2026/07/31/does-not-exist.jpg')
    assert response.status_code == 404
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'not_found'
