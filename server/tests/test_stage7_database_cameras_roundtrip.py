"""Roundtrip of empty app_cameras / app_ticket_photos via /api/database."""

from __future__ import annotations

import json


def _camera_row(**overrides):
    """Minimal camera registry row for sync roundtrip."""
    base = {
        'id': 'cam-roundtrip-1',
        'site_id': 'site-1',
        'name': 'Въезд',
        'role': 'entry',
        'http_snapshot_url': 'http://cam/snap',
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


def _photo_row(**overrides):
    """Minimal ticket photo metadata row for sync roundtrip."""
    base = {
        'id': 'ph-roundtrip-1',
        'ticket_id': 't-1',
        'camera_id': 'cam-roundtrip-1',
        'camera_role': 'entry',
        'event': 'gross',
        'file_path': 'Photo/2026/07/31/t-1_gross_cam-roundtrip-1_entry.jpg',
        'status': 'success',
        'error_code': None,
        'captured_at': '2026-07-31T10:00:00',
        'camera_mode': 'primary',
    }
    base.update(overrides)
    return base


def test_api_database_empty_cameras_and_photos_roundtrip(api_client, temp_app_root):
    """TC-E2E-03: POST empty app_cameras / app_ticket_photos roundtrips."""
    post = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_cameras': json.dumps([], ensure_ascii=False),
                'app_ticket_photos': json.dumps([], ensure_ascii=False),
            }
        },
    )
    assert post.status_code == 200

    data = api_client.get('/api/database').get_json()['data']
    assert json.loads(data['app_cameras']) == []
    assert json.loads(data['app_ticket_photos']) == []


def test_api_database_partial_post_does_not_clear_cameras(api_client, temp_app_root):
    """TC-E2E-03: second POST without camera keys leaves tables untouched."""
    seed = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_cameras': json.dumps([_camera_row()], ensure_ascii=False),
                'app_ticket_photos': json.dumps([_photo_row()], ensure_ascii=False),
            }
        },
    )
    assert seed.status_code == 200

    partial = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_sites': json.dumps(
                    [
                        {
                            'id': 'site-1',
                            'name': 'Площадка',
                            'created_at': '2026-07-31T00:00:00',
                        }
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    assert partial.status_code == 200

    data = api_client.get('/api/database').get_json()['data']
    cameras = json.loads(data['app_cameras'])
    photos = json.loads(data['app_ticket_photos'])
    assert len(cameras) == 1
    assert cameras[0]['id'] == 'cam-roundtrip-1'
    assert len(photos) == 1
    assert photos[0]['id'] == 'ph-roundtrip-1'


def test_api_database_empty_arrays_clear_seeded_rows(api_client, temp_app_root):
    """Explicit empty arrays replace previous camera/photo rows."""
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_cameras': json.dumps([_camera_row()], ensure_ascii=False),
                'app_ticket_photos': json.dumps([_photo_row()], ensure_ascii=False),
            }
        },
    )
    clear = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_cameras': json.dumps([], ensure_ascii=False),
                'app_ticket_photos': json.dumps([], ensure_ascii=False),
            }
        },
    )
    assert clear.status_code == 200
    data = api_client.get('/api/database').get_json()['data']
    assert json.loads(data['app_cameras']) == []
    assert json.loads(data['app_ticket_photos']) == []


def test_api_database_ticket_photos_dump_has_no_binary_blobs(api_client, temp_app_root):
    """TC-E2E-03 / EC-02: GET/POST /api/database dump has metadata paths only — no JPEG/base64."""
    import base64
    from pathlib import Path

    fixtures = Path(__file__).resolve().parent / 'fixtures'
    jpeg_bytes = (fixtures / 'minimal.jpg').read_bytes()
    # Seed metadata that points at a real on-disk JPEG (binary stays on disk).
    photo_rel = 'Photo/2026/07/31/blob-check.jpg'
    abs_path = temp_app_root / photo_rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(jpeg_bytes)

    seed = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_cameras': json.dumps([_camera_row()], ensure_ascii=False),
                'app_ticket_photos': json.dumps(
                    [_photo_row(file_path=photo_rel)],
                    ensure_ascii=False,
                ),
            }
        },
    )
    assert seed.status_code == 200, seed.get_json()

    dump = api_client.get('/api/database')
    assert dump.status_code == 200
    raw_payload = dump.get_data(as_text=True)
    data = dump.get_json()['data']
    photos_json = data['app_ticket_photos']
    photos = json.loads(photos_json)

    assert len(photos) == 1
    row = photos[0]
    assert row['file_path'] == photo_rel
    assert isinstance(row['file_path'], str)
    assert row['file_path'].startswith('Photo/')

    # No JPEG magic / base64 of the fixture in sync JSON payload.
    assert '\xff\xd8\xff' not in raw_payload
    encoded = base64.b64encode(jpeg_bytes).decode('ascii')
    assert encoded not in raw_payload
    assert encoded not in photos_json
    for key in row:
        assert 'base64' not in key.lower()
        assert 'blob' not in key.lower()
        assert 'jpeg_bytes' not in key.lower()
    for value in row.values():
        if isinstance(value, str):
            assert not value.startswith('/9j/')  # typical JPEG base64 prefix
            assert '\xff\xd8' not in value

    # Round-trip POST of the dump must still be metadata-only.
    re_post = api_client.post(
        '/api/database',
        json={'data': {'app_ticket_photos': photos_json}},
    )
    assert re_post.status_code == 200, re_post.get_json()
    again = api_client.get('/api/database').get_json()['data']['app_ticket_photos']
    assert encoded not in again
    assert json.loads(again)[0]['file_path'] == photo_rel
    assert abs_path.read_bytes() == jpeg_bytes