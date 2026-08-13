"""Legacy weighing.db → weighing-YYYY.db migration and path helpers."""

import os
import sqlite3

import year_db
from config_ini import CONFIG_SECTION, read_ini_section


def _create_legacy_db(path: str, *, created_at: str = '2025-06-01T10:00:00', completed_at: str = '2025-06-01T11:00:00'):
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            '''
            CREATE TABLE weighing_tickets (
                id TEXT PRIMARY KEY,
                ticket_number INTEGER,
                vehicle_number TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                completed_at TEXT
            )
            '''
        )
        connection.execute(
            '''
            INSERT INTO weighing_tickets (id, ticket_number, vehicle_number, status, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            ('t1', 1, 'A001', 'completed', created_at, completed_at),
        )
        connection.commit()
    finally:
        connection.close()


def test_migrate_legacy_weighing_db_copies_and_renames(temp_app_root):
    legacy = year_db.legacy_db_path()
    _create_legacy_db(legacy)

    result = year_db.migrate_legacy_weighing_db()
    assert result is not None
    assert result['year'] == 2025
    assert os.path.isfile(year_db.year_db_path(2025))
    assert not os.path.isfile(legacy)
    assert os.path.isfile(result['migrated_legacy'])
    assert year_db.read_active_year() == 2025


def test_migrate_skipped_when_yearly_already_active(temp_app_root):
    yearly = year_db.year_db_path(2026)
    _create_legacy_db(yearly, created_at='2026-01-01T00:00:00', completed_at='2026-01-01T01:00:00')
    year_db.write_active_year(2026)

    legacy = year_db.legacy_db_path()
    _create_legacy_db(legacy, created_at='2024-01-01T00:00:00', completed_at='2024-01-01T01:00:00')

    assert year_db.migrate_legacy_weighing_db() is None
    assert os.path.isfile(legacy)
    assert year_db.read_active_year() == 2026


def test_resolve_active_path_greenfield(temp_app_root):
    path = year_db.resolve_active_sqlite_path()
    year = year_db.calendar_year()
    assert path.endswith(f'weighing-{year}.db')
    assert year_db.read_active_year() == year
    config = read_ini_section(year_db.get_config_path(), CONFIG_SECTION)
    assert config.get('active_year') == str(year)


def test_list_years_and_paths_api_fields(temp_app_root, api_client):
    year_db.write_active_year(2026)
    open(year_db.year_db_path(2026), 'a').close()
    open(year_db.year_db_path(2025), 'a').close()

    response = api_client.get('/api/database/years')
    assert response.status_code == 200
    body = response.get_json()
    assert body['active_year'] == 2026
    assert 2025 in body['years']
    assert 2026 in body['years']

    paths = api_client.get('/api/storage/paths').get_json()
    assert paths['active_year'] == '2026'
    assert paths['database_file'].endswith('weighing-2026.db')
    assert paths['backups_dir'].endswith(os.path.join('BD', 'backups')) or 'backups' in paths['backups_dir']
