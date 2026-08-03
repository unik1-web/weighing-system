"""Regression: legacy vehicle_drivers without vehicle_number must not break init_schema.

User symptom: photos not saved — POST /api/database and /api/cameras/capture both
failed with OperationalError: no such column: vehicle_number while creating indexes
on an old vehicle_drivers table that lacked that column.
"""

import json
import sqlite3

import sqlite_store


def _create_legacy_vehicle_drivers(connection: sqlite3.Connection) -> None:
    """Pre-migration vehicle_drivers shape (no vehicle_number)."""
    connection.executescript(
        '''
        CREATE TABLE vehicle_drivers (
            id TEXT PRIMARY KEY,
            driver_name TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO vehicle_drivers (id, driver_name, last_used_at, use_count)
        VALUES ('vd-1', 'Иванов', '2026-01-01T00:00:00', 2);
        '''
    )


def test_init_schema_migrates_legacy_vehicle_drivers_without_vehicle_number(temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        _create_legacy_vehicle_drivers(connection)
        connection.commit()
    finally:
        connection.close()

    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
        cols = {
            row['name']
            for row in connection.execute('PRAGMA table_info(vehicle_drivers)').fetchall()
        }
        assert 'vehicle_number' in cols
        assert 'driver_name' in cols
        indexes = {
            row[1]
            for row in connection.execute(
                "SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='vehicle_drivers'"
            ).fetchall()
        }
        assert 'idx_vehicle_drivers_pair' in indexes
        assert 'idx_vehicle_drivers_vehicle' in indexes
        # Legacy rows without vehicle_number are dropped; table must be usable.
        count = connection.execute('SELECT COUNT(*) AS c FROM vehicle_drivers').fetchone()['c']
        assert count == 0


def test_api_database_works_after_legacy_vehicle_drivers_migration(api_client, temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    try:
        _create_legacy_vehicle_drivers(connection)
        connection.commit()
    finally:
        connection.close()

    response = api_client.get('/api/database')
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body.get('success') is True
    links = json.loads(body['data'].get('app_vehicle_drivers') or '[]')
    assert links == []

    write = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_vehicle_drivers': json.dumps(
                    [
                        {
                            'id': 'vd-new',
                            'vehicle_number': 'A123BC77',
                            'driver_name': 'Петров',
                            'last_used_at': '2026-08-03T12:00:00',
                            'use_count': 1,
                            'driver_id': None,
                        }
                    ],
                    ensure_ascii=False,
                )
            }
        },
    )
    assert write.status_code == 200, write.get_json()
    assert write.get_json()['success'] is True
