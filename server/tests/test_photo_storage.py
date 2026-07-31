"""PhotoStorage: atomic writes, path guard, unlink, file_exists."""

from __future__ import annotations

from pathlib import Path

import pytest
from photo_storage import PhotoStorage

MINIMAL_JPEG = (
    Path(__file__).resolve().parent / 'fixtures' / 'minimal.jpg'
).read_bytes()


def test_write_ticket_photo_creates_dated_file(temp_app_root):
    """TC-UNIT-03: write_ticket_photo creates file under Photo/YYYY/MM/DD/..."""
    storage = PhotoStorage()
    rel = storage.write_ticket_photo(
        ticket_id='ticket-1',
        event='gross',
        camera_id='cam-entry',
        role='entry',
        captured_at='2026-07-31T10:15:00',
        jpeg_bytes=MINIMAL_JPEG,
    )
    assert rel == 'Photo/2026/07/31/ticket-1_gross_cam-entry_entry.jpg'
    absolute = Path(storage.resolve(rel))
    assert absolute.is_file()
    assert absolute.read_bytes() == MINIMAL_JPEG
    assert absolute.parent == temp_app_root / 'Photo' / '2026' / '07' / '31'


def test_path_traversal_rejected(temp_app_root):
    """TC-UNIT-04: path traversal outside Photo root is rejected."""
    storage = PhotoStorage()
    for bad in (
        'Photo/../../etc/passwd',
        '../etc/passwd',
        'Photo/foo/../../../x',
        'Photo/../../etc/passwd.jpg',
    ):
        with pytest.raises(ValueError):
            storage.resolve(bad)
        with pytest.raises(ValueError):
            storage.file_exists(bad)
        with pytest.raises(ValueError):
            storage.safe_unlink(bad)


def test_write_etalon_overwrites(temp_app_root):
    """write_etalon creates/overwrites Photo/etalons/{id}/{set}.jpg."""
    storage = PhotoStorage()
    first = storage.write_etalon('cam-1', 'spare', MINIMAL_JPEG)
    assert first == 'Photo/etalons/cam-1/spare.jpg'
    assert storage.file_exists(first)

    replacement = b'\xff\xd8\xff\xe0' + b'\x00' * 20 + b'\xff\xd9'
    second = storage.write_etalon('cam-1', 'spare', replacement)
    assert second == first
    assert Path(storage.resolve(second)).read_bytes() == replacement


def test_safe_unlink_and_file_exists(temp_app_root):
    """safe_unlink removes only files inside Photo/; missing is no-op."""
    storage = PhotoStorage()
    rel = storage.write_bytes('Photo/2026/01/01/sample.jpg', MINIMAL_JPEG)
    assert storage.file_exists(rel)
    storage.safe_unlink(rel)
    assert storage.file_exists(rel) is False
    storage.safe_unlink(rel)  # missing — no error


def test_ensure_photo_dirs_creates_root(temp_app_root):
    """ensure_photo_dirs creates Photo/ lazily."""
    photo_root = temp_app_root / 'Photo'
    # Fixture already creates Photo/; remove and recreate via API.
    if photo_root.exists():
        for child in photo_root.iterdir():
            if child.is_file():
                child.unlink()
    storage = PhotoStorage()
    root = storage.ensure_photo_dirs('Photo/etalons/cam-x/primary.jpg')
    assert Path(root).is_dir()
    assert (temp_app_root / 'Photo' / 'etalons' / 'cam-x').is_dir()
