"""Regression: legacy ticket_photos.event must not block capture metadata.

Files were written under Photo/YYYY/MM/DD/ but INSERT failed with
IntegrityError: NOT NULL constraint failed: ticket_photos.event — so stubs
and UI slots stayed empty («Нет снимка»).
"""

import json
import sqlite3
from unittest.mock import patch

from config_ini import CONFIG_SECTION, write_ini_section
import sqlite_store
import year_db


FAKE_JPEG = (
    b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
    b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
    b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342'
    b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f'
    b'\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00'
    b'\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01'
    b'\x00\x00?\x00\xaa\xff\xd9'
)


def _seed_legacy_ticket_photos_on_modern_db(connection: sqlite3.Connection) -> None:
    """Full modern schema, then replace ticket_photos with stage-7 legacy shape."""
    sqlite_store.init_schema(connection)
    connection.execute('DROP TABLE IF EXISTS ticket_photos')
    connection.executescript(
        '''
        CREATE TABLE ticket_photos (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            camera_id TEXT,
            camera_role TEXT NOT NULL,
            event TEXT NOT NULL,
            file_path TEXT,
            status TEXT NOT NULL,
            error_code TEXT,
            captured_at TEXT NOT NULL,
            camera_mode TEXT NOT NULL,
            FOREIGN KEY (ticket_id) REFERENCES weighing_tickets(id)
        );
        DELETE FROM cameras;
        DELETE FROM site_runtime;
        DELETE FROM scales;
        DELETE FROM sites;
        DELETE FROM weighing_tickets;
        INSERT INTO sites (id, name, is_default, created_at)
        VALUES ('site-1', 'Площадка', 1, '2026-01-01T00:00:00');
        INSERT INTO cameras (
            id, site_id, role, name, capture_url, capture_kind, enabled,
            sort_order, created_at
        ) VALUES (
            'cam-entry', 'site-1', 'entry', 'Въезд',
            'http://127.0.0.1:9/entry.jpg', 'http_snapshot', 1, 0, '2026-01-01T00:00:00'
        ), (
            'cam-exit', 'site-1', 'exit', 'Выезд',
            'http://127.0.0.1:9/exit.jpg', 'http_snapshot', 1, 1, '2026-01-01T00:00:00'
        );
        INSERT INTO weighing_tickets (
            id, ticket_number, vehicle_number, status, created_at, operator_name, site_id
        ) VALUES (
            'ticket-1', 1, 'A001AA77', 'completed', '2026-08-03T13:23:00', 'Op', 'site-1'
        );
        '''
    )


def test_capture_writes_rows_with_legacy_ticket_photos_event(api_client, temp_app_root):
    year_db.write_active_year(2026)
    write_ini_section(
        str(temp_app_root / 'config.ini'),
        CONFIG_SECTION,
        {'video_enabled': 'true', 'active_year': '2026'},
    )
    with sqlite_store.connect() as connection:
        _seed_legacy_ticket_photos_on_modern_db(connection)

    with patch('cameras.grab_frame', return_value=FAKE_JPEG):
        resp = api_client.post(
            '/api/cameras/capture',
            json={'ticket_id': 'ticket-1', 'phase': 'gross', 'site_id': 'site-1'},
        )
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body['success'] is True
    assert len(body['photos']) == 2
    assert all(p['status'] == 'ok' for p in body['photos'])
    assert body['stubs']['photo_entry_path']
    assert body['stubs']['photo_exit_path']

    with sqlite_store.connect() as connection:
        count = connection.execute('SELECT COUNT(*) AS c FROM ticket_photos').fetchone()['c']
        assert count == 2
        row = connection.execute(
            'SELECT event, phase, file_path, relative_path FROM ticket_photos LIMIT 1'
        ).fetchone()
        assert row['event'] == 'gross'
        assert row['phase'] == 'gross'
        assert row['file_path']
        assert row['relative_path']

    get = api_client.get('/api/database')
    assert get.status_code == 200, get.get_json()
    data = get.get_json()['data']
    photos = json.loads(data['app_ticket_photos'])
    assert len(photos) == 2
    tickets = json.loads(data['app_weighing_tickets'])
    ticket = next(t for t in tickets if t['id'] == 'ticket-1')
    assert ticket['photo_entry_path']
    assert ticket['photo_exit_path']
