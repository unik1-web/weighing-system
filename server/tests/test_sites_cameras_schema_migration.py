"""Regression: legacy sites/cameras schemas must gain missing columns on init_schema.

User symptom after vehicle_drivers fix: photos still missing because
GET/POST /api/database failed with ``no such column: is_default`` and
POST /api/cameras/capture failed with ``no such column: capture_url``.
CREATE TABLE IF NOT EXISTS does not alter already-created tables.
"""

import json
import sqlite3

import sqlite_store


def _seed_legacy_site_camera_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        '''
        CREATE TABLE sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE cameras (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        INSERT INTO sites (id, name, created_at)
        VALUES ('site-1', 'Площадка', '2026-01-01T00:00:00');
        INSERT INTO cameras (id, site_id, role, name, enabled, created_at)
        VALUES ('cam-exit', 'site-1', 'exit', 'Выезд', 1, '2026-01-01T00:00:00');
        '''
    )


def test_init_schema_adds_sites_is_default_and_cameras_capture_url(temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        _seed_legacy_site_camera_tables(connection)
        connection.commit()
    finally:
        connection.close()

    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
        site_cols = {
            row['name']
            for row in connection.execute('PRAGMA table_info(sites)').fetchall()
        }
        cam_cols = {
            row['name']
            for row in connection.execute('PRAGMA table_info(cameras)').fetchall()
        }
        assert 'is_default' in site_cols
        assert 'capture_url' in cam_cols
        assert 'capture_kind' in cam_cols


def test_api_database_and_capture_list_after_legacy_sites_cameras(api_client, temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    try:
        _seed_legacy_site_camera_tables(connection)
        connection.commit()
    finally:
        connection.close()

    get = api_client.get('/api/database')
    assert get.status_code == 200, get.get_json()
    body = get.get_json()
    assert body['success'] is True
    sites = json.loads(body['data']['app_sites'])
    assert sites[0]['id'] == 'site-1'
    assert sites[0]['is_default'] in (0, False)

    write = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_sites': json.dumps(
                    [
                        {
                            'id': 'site-1',
                            'name': 'Площадка',
                            'is_default': True,
                            'created_at': '2026-01-01T00:00:00',
                        }
                    ],
                    ensure_ascii=False,
                ),
                'app_cameras': json.dumps(
                    [
                        {
                            'id': 'cam-exit',
                            'site_id': 'site-1',
                            'role': 'exit',
                            'name': 'Выезд',
                            'capture_url': 'http://127.0.0.1:9/exit.jpg',
                            'capture_kind': 'http_snapshot',
                            'enabled': True,
                            'sort_order': 0,
                            'roi_json': None,
                            'reference_normal_path': None,
                            'reference_spare_path': None,
                            'created_at': '2026-01-01T00:00:00',
                        }
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    assert write.status_code == 200, write.get_json()

    # Capture endpoint must be able to SELECT capture_url (may fail later on grab).
    capture = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': 'missing-ticket', 'phase': 'exit'},
    )
    # Ticket missing → 400 ValueError, not schema OperationalError.
    assert capture.status_code == 400
    message = capture.get_json().get('message', '')
    assert 'capture_url' not in message
    assert 'is_default' not in message
