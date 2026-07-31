"""Unit/E2E tests for TicketPhotosService replace policy and F-08 stubs."""

from __future__ import annotations

import json
from pathlib import Path

import persistence
import sqlite_store
from photo_storage import PhotoStorage
from ticket_photos import CapturePersistInput, TicketPhotosService

FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures'
MINIMAL_JPEG = (FIXTURES_DIR / 'minimal.jpg').read_bytes()


def _ticket_row(**overrides):
    """Minimal weighing ticket for active DB."""
    base = {
        'id': 't-photos-1',
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


def _seed_ticket(temp_app_root, ticket=None):
    """Persist a ticket into the isolated active DB."""
    del temp_app_root  # fixture ensures app root isolation
    row = ticket or _ticket_row()
    sqlite_store.write_database(
        {'app_weighing_tickets': json.dumps([row], ensure_ascii=False)}
    )
    return row


def test_recompute_stubs_picks_latest_success_by_captured_at(temp_app_root):
    """TC-UNIT-01: recompute_stubs takes latest success per entry/exit role."""
    _seed_ticket(temp_app_root)
    service = TicketPhotosService()
    storage = PhotoStorage()

    older = storage.write_bytes(
        'Photo/2026/07/31/older_entry.jpg',
        MINIMAL_JPEG,
    )
    newer = storage.write_bytes(
        'Photo/2026/07/31/newer_entry.jpg',
        MINIMAL_JPEG,
    )
    exit_path = storage.write_bytes(
        'Photo/2026/07/31/exit.jpg',
        MINIMAL_JPEG,
    )

    photos = [
        {
            'id': 'ph-old',
            'ticket_id': 't-photos-1',
            'camera_id': 'cam-a',
            'camera_role': 'entry',
            'event': 'gross',
            'file_path': older,
            'status': 'success',
            'error_code': None,
            'captured_at': '2026-07-31T10:00:00',
            'camera_mode': 'primary',
        },
        {
            'id': 'ph-new',
            'ticket_id': 't-photos-1',
            'camera_id': 'cam-b',
            'camera_role': 'entry',
            'event': 'tare',
            'file_path': newer,
            'status': 'success',
            'error_code': None,
            'captured_at': '2026-07-31T11:00:00',
            'camera_mode': 'primary',
        },
        {
            'id': 'ph-exit',
            'ticket_id': 't-photos-1',
            'camera_id': 'cam-c',
            'camera_role': 'exit',
            'event': 'gross',
            'file_path': exit_path,
            'status': 'success',
            'error_code': None,
            'captured_at': '2026-07-31T10:30:00',
            'camera_mode': 'primary',
        },
        {
            'id': 'ph-failed',
            'ticket_id': 't-photos-1',
            'camera_id': 'cam-d',
            'camera_role': 'entry',
            'event': 'gross',
            'file_path': None,
            'status': 'failed',
            'error_code': 'timeout',
            'captured_at': '2026-07-31T12:00:00',
            'camera_mode': 'primary',
        },
    ]
    # UNIQUE is (ticket_id, camera_id, event) — cam-d/gross is fine; cam-a already gross.
    # Failed row uses different camera_id so it does not collide with ph-old.
    sqlite_store.write_database(
        {'app_ticket_photos': json.dumps(photos, ensure_ascii=False)}
    )

    entry, exit_stub = service.recompute_stubs('t-photos-1')
    assert entry == newer
    assert exit_stub == exit_path


def test_replace_success_then_failed_preserves_success(temp_app_root):
    """TC-E2E-05: success then failed re-capture keeps file and stubs."""
    _seed_ticket(temp_app_root)
    service = TicketPhotosService()

    first = service.replace_capture(
        't-photos-1',
        'gross',
        [
            CapturePersistInput(
                camera_id='cam-entry',
                camera_role='entry',
                status='success',
                jpeg_bytes=MINIMAL_JPEG,
                error_code=None,
                captured_at='2026-07-31T10:00:00',
            )
        ],
        camera_mode='primary',
    )
    assert first['photo_entry_path']
    success_path = first['photo_entry_path']
    assert PhotoStorage().file_exists(success_path)

    second = service.replace_capture(
        't-photos-1',
        'gross',
        [
            CapturePersistInput(
                camera_id='cam-entry',
                camera_role='entry',
                status='failed',
                jpeg_bytes=None,
                error_code='timeout',
                captured_at='2026-07-31T10:01:00',
            )
        ],
        camera_mode='primary',
    )
    assert second['photo_entry_path'] == success_path
    assert PhotoStorage().file_exists(success_path)
    rows = second['ticket_photos']
    assert len(rows) == 1
    assert rows[0]['status'] == 'success'
    assert rows[0]['file_path'] == success_path
    assert second['results'][0]['status'] == 'failed'
    assert second['results'][0].get('preserved_success') is True


def test_replace_success_then_success_unique_and_file(temp_app_root):
    """TC-E2E-04: repeated success keeps UNIQUE key; file content refreshed."""
    _seed_ticket(temp_app_root)
    service = TicketPhotosService()

    first = service.replace_capture(
        't-photos-1',
        'gross',
        [
            CapturePersistInput(
                camera_id='cam-entry',
                camera_role='entry',
                status='success',
                jpeg_bytes=MINIMAL_JPEG,
                error_code=None,
                captured_at='2026-07-31T10:00:00',
            )
        ],
    )
    path1 = first['results'][0]['file_path']
    assert path1
    assert PhotoStorage().file_exists(path1)

    second = service.replace_capture(
        't-photos-1',
        'gross',
        [
            CapturePersistInput(
                camera_id='cam-entry',
                camera_role='entry',
                status='success',
                jpeg_bytes=MINIMAL_JPEG,
                error_code=None,
                captured_at='2026-07-31T10:05:00',
            )
        ],
    )
    rows = second['ticket_photos']
    assert len(rows) == 1
    assert rows[0]['status'] == 'success'
    assert rows[0]['captured_at'] == '2026-07-31T10:05:00'
    assert PhotoStorage().file_exists(rows[0]['file_path'])


def test_ticket_photos_response_scoped_to_requested_ticket(temp_app_root):
    """TC-UNIT-03: replace_capture ticket_photos only for requested ticket_id."""
    sqlite_store.write_database(
        {
            'app_weighing_tickets': json.dumps(
                [
                    _ticket_row(id='t-a'),
                    _ticket_row(id='t-b', ticket_number=2),
                ],
                ensure_ascii=False,
            )
        }
    )
    service = TicketPhotosService()
    first = service.replace_capture(
        't-b',
        'gross',
        [
            CapturePersistInput(
                camera_id='cam-x',
                camera_role='overview',
                status='success',
                jpeg_bytes=MINIMAL_JPEG,
                error_code=None,
                captured_at='2026-07-31T10:00:00',
            )
        ],
    )
    # Seed foreign ticket photo via sync without wiping t-b rows
    foreign = {
        'id': 'ph-foreign',
        'ticket_id': 't-a',
        'camera_id': 'cam-y',
        'camera_role': 'entry',
        'event': 'tare',
        'file_path': 'Photo/2026/07/31/foreign.jpg',
        'status': 'success',
        'error_code': None,
        'captured_at': '2026-07-31T09:00:00',
        'camera_mode': 'primary',
    }
    existing = list(first['ticket_photos'])
    existing.append(foreign)
    sqlite_store.write_database(
        {'app_ticket_photos': json.dumps(existing, ensure_ascii=False)}
    )

    result = service.replace_capture(
        't-b',
        'tare',
        [
            CapturePersistInput(
                camera_id='cam-x',
                camera_role='overview',
                status='failed',
                jpeg_bytes=None,
                error_code='unreachable',
                captured_at='2026-07-31T10:10:00',
            )
        ],
    )
    assert all(row['ticket_id'] == 't-b' for row in result['ticket_photos'])
    assert not any(row['ticket_id'] == 't-a' for row in result['ticket_photos'])


def test_noop_when_video_disabled(temp_app_root):
    """TC-UNIT-02: run_phase_capture noops when video_enabled=false."""
    from ticket_photos import run_phase_capture

    _seed_ticket(temp_app_root)
    persistence.write_config(
        {
            **persistence.read_config(),
            'video_enabled': 'false',
        }
    )
    result = run_phase_capture(
        't-photos-1',
        'gross',
        config=persistence.read_config(),
    )
    assert result['success'] is True
    assert result['noop'] is True
    assert result['results'] == []
    assert result.get('capture_token')
