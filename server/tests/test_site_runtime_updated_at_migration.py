"""Regression: legacy site_runtime.updated_at must not block database writes.

User symptom: after sites/cameras column migration, POST /api/database failed with
IntegrityError: NOT NULL constraint failed: site_runtime.updated_at. Cameras never
reached SQLite («Камера не найдена»), capture returned 200 with zero photos.
"""

import json
import sqlite3

import sqlite_store


def _seed_legacy_site_runtime_with_updated_at(connection: sqlite3.Connection) -> None:
    connection.executescript(
        '''
        CREATE TABLE sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE site_runtime (
            site_id TEXT PRIMARY KEY,
            active_scale_set TEXT NOT NULL,
            camera_mode TEXT NOT NULL,
            anpr_mode TEXT NOT NULL,
            switch_reason TEXT,
            switch_by_operator_id TEXT,
            switch_by_operator_name TEXT,
            switch_at TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        );
        CREATE TABLE cameras (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            capture_url TEXT NOT NULL DEFAULT '',
            capture_kind TEXT NOT NULL DEFAULT 'auto',
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            roi_json TEXT,
            reference_normal_path TEXT,
            reference_spare_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        );
        INSERT INTO sites (id, name, is_default, created_at)
        VALUES ('site-1', 'Площадка', 1, '2026-01-01T00:00:00');
        INSERT INTO site_runtime (
            site_id, active_scale_set, camera_mode, anpr_mode, updated_at
        ) VALUES ('site-1', 'primary', 'normal', 'enabled', '2026-01-01T00:00:00');
        '''
    )


def test_api_database_write_with_legacy_site_runtime_updated_at(api_client, temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    try:
        _seed_legacy_site_runtime_with_updated_at(connection)
        connection.commit()
    finally:
        connection.close()

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
                'app_site_runtime': json.dumps(
                    [
                        {
                            'site_id': 'site-1',
                            'active_scale_set': 'primary',
                            'camera_mode': 'normal',
                            'anpr_mode': 'enabled',
                            'switch_reason': None,
                            'switch_by_operator_id': None,
                            'switch_by_operator_name': None,
                            'switch_at': None,
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
                        },
                        {
                            'id': 'cam-overview',
                            'site_id': 'site-1',
                            'role': 'overview',
                            'name': 'Обзор',
                            'capture_url': 'http://127.0.0.1:9/overview.jpg',
                            'capture_kind': 'http_snapshot',
                            'enabled': True,
                            'sort_order': 1,
                            'roi_json': None,
                            'reference_normal_path': None,
                            'reference_spare_path': None,
                            'created_at': '2026-01-01T00:00:00',
                        },
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    assert write.status_code == 200, write.get_json()
    assert write.get_json()['success'] is True

    get = api_client.get('/api/database')
    assert get.status_code == 200
    cams = json.loads(get.get_json()['data']['app_cameras'])
    assert len(cams) == 2
    assert {c['id'] for c in cams} == {'cam-exit', 'cam-overview'}


def test_migrate_legacy_http_snapshot_url_into_capture_url(temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(
            '''
            CREATE TABLE cameras (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                http_snapshot_url TEXT NOT NULL DEFAULT '',
                rtsp_url TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO cameras (
                id, site_id, role, name, http_snapshot_url, rtsp_url, enabled, created_at, updated_at
            ) VALUES (
                'cam-1', 'site-1', 'exit', 'Выезд',
                'http://cam/snap.jpg', '', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00'
            );
            '''
        )
        connection.commit()
    finally:
        connection.close()

    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
        row = connection.execute(
            'SELECT capture_url, capture_kind FROM cameras WHERE id = ?',
            ('cam-1',),
        ).fetchone()
        assert row['capture_url'] == 'http://cam/snap.jpg'
        assert row['capture_kind'] in ('http_snapshot', 'auto')
