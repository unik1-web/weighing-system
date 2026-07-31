"""Stage-7 schema migration: user_version, tables, indexes, idempotency."""

from __future__ import annotations

import sqlite3

import sqlite_store


STAGE7_INDEXES = (
    'idx_cameras_site',
    'idx_cameras_site_enabled',
    'uq_ticket_photos_key',
    'idx_ticket_photos_ticket',
    'idx_ticket_photos_ticket_event',
    'idx_ticket_photos_stub',
)


def test_migrate_schema_stage_7_sets_version_tables_and_indexes(temp_app_root):
    """Migration creates cameras/ticket_photos, indexes, and user_version=7."""
    db_path = temp_app_root / 'BD' / 'stage7-migration.db'
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        indexes = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }
        connection.commit()

    assert version == sqlite_store.SCHEMA_VERSION_STAGE_7
    assert 'cameras' in tables
    assert 'ticket_photos' in tables
    for index_name in STAGE7_INDEXES:
        assert index_name in indexes


def test_migrate_schema_stage_7_idempotent_repeat(temp_app_root):
    """Calling migrate_schema_stage_7 repeatedly stays at user_version=7."""
    db_path = temp_app_root / 'BD' / 'stage7-idempotent.db'
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        sqlite_store.migrate_schema_stage_7(connection)
        sqlite_store.migrate_schema_stage_7(connection)
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        camera_columns = {
            row['name'] for row in connection.execute('PRAGMA table_info(cameras)').fetchall()
        }
        photo_columns = {
            row['name']
            for row in connection.execute('PRAGMA table_info(ticket_photos)').fetchall()
        }
        connection.commit()

    assert version >= sqlite_store.SCHEMA_VERSION_STAGE_7
    assert {'id', 'site_id', 'role', 'http_snapshot_url', 'rtsp_url', 'enabled'}.issubset(
        camera_columns
    )
    assert {
        'id',
        'ticket_id',
        'camera_id',
        'event',
        'file_path',
        'status',
    }.issubset(photo_columns)


def test_init_schema_includes_stage7_after_stage6(temp_app_root):
    """init_schema chain reaches stage 7 after stage 5/6."""
    db_path = temp_app_root / 'BD' / 'stage7-chain.db'
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        connection.commit()
    assert version >= 7
