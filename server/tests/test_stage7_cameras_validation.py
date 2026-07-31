"""Stage-7 cameras validation and preserve-non-null for etalon / photo stubs."""

from __future__ import annotations

import json

import pytest

import sqlite_store


def _camera_row(**overrides):
    """Minimal valid camera registry row."""
    base = {
        'id': 'cam-1',
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


def _ticket(**overrides):
    """Minimal weighing ticket for photo stub preserve tests."""
    base = {
        'id': 't-photo-1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': '',
        'cargo_name': '',
        'shipper_name': '',
        'receiver_name': '',
        'carrier_name': '',
        'price': 0,
        'vat_rate': 0,
        'gross_weight': 1000,
        'tare_weight': None,
        'net_weight': None,
        'total_amount': None,
        'gross_source': 'instrument',
        'tare_source': '',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-31T10:00:00',
        'tare_datetime': None,
        'scale_device': '',
        'manual_weight_reason': None,
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'open',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'auto_closed': 0,
        'notes': '',
        'created_at': '2026-07-31T10:00:00',
        'completed_at': None,
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': None,
        'site_id': 'site-1',
        'scale_id': None,
        'scale_role': None,
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    base.update(overrides)
    return base


def test_api_cameras_roundtrip_two_cameras(api_client, temp_app_root):
    """TC-E2E-01: POST app_cameras with 2 cameras → GET returns the same fields."""
    cameras = [
        _camera_row(id='cam-entry', role='entry', name='Въезд'),
        _camera_row(
            id='cam-exit',
            role='exit',
            name='Выезд',
            http_snapshot_url=None,
            rtsp_url='rtsp://cam/exit',
            sort_order=1,
        ),
    ]
    post = api_client.post(
        '/api/database',
        json={'data': {'app_cameras': json.dumps(cameras, ensure_ascii=False)}},
    )
    assert post.status_code == 200

    data = api_client.get('/api/database').get_json()['data']
    loaded = json.loads(data['app_cameras'])
    assert len(loaded) == 2
    by_id = {row['id']: row for row in loaded}
    assert by_id['cam-entry']['role'] == 'entry'
    assert by_id['cam-entry']['http_snapshot_url'] == 'http://cam/snap'
    assert by_id['cam-exit']['role'] == 'exit'
    assert by_id['cam-exit']['rtsp_url'] == 'rtsp://cam/exit'
    # Do not assert/log credentials — fixture URLs have no userinfo passwords.


def test_api_five_cameras_same_site_rejected_without_corruption(api_client, temp_app_root):
    """TC-E2E-02: POST 5 cameras for one site_id → 400; table not partially wiped."""
    seed = [_camera_row(id='cam-seed', name='Seed')]
    assert (
        api_client.post(
            '/api/database',
            json={'data': {'app_cameras': json.dumps(seed, ensure_ascii=False)}},
        ).status_code
        == 200
    )

    five = [
        _camera_row(id=f'cam-{index}', name=f'Cam {index}', sort_order=index)
        for index in range(5)
    ]
    response = api_client.post(
        '/api/database',
        json={'data': {'app_cameras': json.dumps(five, ensure_ascii=False)}},
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False
    assert body['code'] == 'invalid_request'

    data = api_client.get('/api/database').get_json()['data']
    loaded = json.loads(data['app_cameras'])
    assert len(loaded) == 1
    assert loaded[0]['id'] == 'cam-seed'


def test_enabled_without_url_rejected(temp_app_root):
    """TC-UNIT-01: enabled without URL → StorageValidationError."""
    row = _camera_row(enabled=1, http_snapshot_url=None, rtsp_url=None)
    with pytest.raises(sqlite_store.StorageValidationError) as exc_info:
        sqlite_store.write_database(
            {'app_cameras': json.dumps([row], ensure_ascii=False)}
        )
    assert exc_info.value.code == 'invalid_request'
    assert sqlite_store.read_database().get('app_cameras')
    loaded = json.loads(sqlite_store.read_database()['app_cameras'])
    assert loaded == []


def test_bad_role_rejected(temp_app_root):
    """Bad camera role is rejected with invalid_request."""
    row = _camera_row(role='anpr')
    with pytest.raises(sqlite_store.StorageValidationError) as exc_info:
        sqlite_store.write_database(
            {'app_cameras': json.dumps([row], ensure_ascii=False)}
        )
    assert exc_info.value.code == 'invalid_request'


def test_pixel_roi_rejected(temp_app_root):
    """Pixel-space ROI values (>1) are rejected."""
    row = _camera_row(role='overview', roi_x=100, roi_y=50, roi_w=200, roi_h=100)
    with pytest.raises(sqlite_store.StorageValidationError) as exc_info:
        sqlite_store.write_database(
            {'app_cameras': json.dumps([row], ensure_ascii=False)}
        )
    assert 'ROI' in exc_info.value.message or 'roi' in exc_info.value.message.lower()


def test_preserve_non_null_etalon_paths(temp_app_root):
    """TC-UNIT-02: client null does not wipe existing etalon_*_path."""
    seed = _camera_row(
        etalon_primary_path='Photo/etalons/cam-1/primary.jpg',
        etalon_spare_path='Photo/etalons/cam-1/spare.jpg',
    )
    sqlite_store.write_database(
        {'app_cameras': json.dumps([seed], ensure_ascii=False)}
    )

    stale = _camera_row(etalon_primary_path=None, etalon_spare_path=None, name='Updated')
    sqlite_store.write_database(
        {'app_cameras': json.dumps([stale], ensure_ascii=False)}
    )
    loaded = json.loads(sqlite_store.read_database()['app_cameras'])
    assert len(loaded) == 1
    assert loaded[0]['name'] == 'Updated'
    assert loaded[0]['etalon_primary_path'] == 'Photo/etalons/cam-1/primary.jpg'
    assert loaded[0]['etalon_spare_path'] == 'Photo/etalons/cam-1/spare.jpg'


def test_preserve_non_null_photo_stubs_without_capture_token(temp_app_root):
    """TC-UNIT-03: photo_* null without capture_token preserves SQLite stubs."""
    seed = _ticket(
        photo_entry_path='Photo/2026/07/31/t-photo-1_gross_cam-1_entry.jpg',
        photo_exit_path='Photo/2026/07/31/t-photo-1_tare_cam-2_exit.jpg',
    )
    sqlite_store.write_database(
        {'app_weighing_tickets': json.dumps([seed], ensure_ascii=False)}
    )

    stale = _ticket(photo_entry_path=None, photo_exit_path=None, notes='stale flush')
    sqlite_store.write_database(
        {'app_weighing_tickets': json.dumps([stale], ensure_ascii=False)}
    )
    loaded = json.loads(sqlite_store.read_database()['app_weighing_tickets'])
    assert len(loaded) == 1
    assert loaded[0]['notes'] == 'stale flush'
    assert loaded[0]['photo_entry_path'] == seed['photo_entry_path']
    assert loaded[0]['photo_exit_path'] == seed['photo_exit_path']


def test_capture_token_allows_photo_null_overwrite(temp_app_root):
    """With capture_token, client null for photo_* is written as null."""
    seed = _ticket(
        photo_entry_path='Photo/2026/07/31/t-photo-1_gross_cam-1_entry.jpg',
        photo_exit_path=None,
    )
    sqlite_store.write_database(
        {'app_weighing_tickets': json.dumps([seed], ensure_ascii=False)}
    )

    merged = _ticket(
        photo_entry_path=None,
        photo_exit_path=None,
        capture_token='capture-abc',
    )
    sqlite_store.write_database(
        {'app_weighing_tickets': json.dumps([merged], ensure_ascii=False)}
    )
    loaded = json.loads(sqlite_store.read_database()['app_weighing_tickets'])
    assert loaded[0]['photo_entry_path'] is None
    assert loaded[0]['photo_exit_path'] is None


def test_partial_post_without_app_cameras_does_not_clear(temp_app_root):
    """TC-UNIT-04: partial POST without app_cameras does not clear cameras."""
    sqlite_store.write_database(
        {'app_cameras': json.dumps([_camera_row()], ensure_ascii=False)}
    )
    sqlite_store.write_database(
        {
            'app_sites': json.dumps(
                [{'id': 'site-1', 'name': 'Площадка', 'created_at': '2026-07-31T00:00:00'}],
                ensure_ascii=False,
            )
        }
    )
    loaded = json.loads(sqlite_store.read_database()['app_cameras'])
    assert len(loaded) == 1
    assert loaded[0]['id'] == 'cam-1'
