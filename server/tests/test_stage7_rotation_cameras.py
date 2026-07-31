"""Stage-7 year-rotation: cameras copy-forward, ticket_photos forbidden."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

import persistence
import sqlite_store
import year_rotation
from stage6_fixtures import build_stage6_active_year_db, freeze_stage6_now


def _seed_cameras_and_photos(db_path: Path) -> None:
    """Insert camera registry and ticket_photos into an existing year DB."""
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            f'''
            INSERT INTO cameras ({", ".join(sqlite_store.CAMERA_COLUMNS)})
            VALUES ({", ".join(["?"] * len(sqlite_store.CAMERA_COLUMNS))})
            ''',
            (
                'cam-rot-1',
                'site-1',
                'Въезд',
                'entry',
                'http://cam/snap',
                None,
                1,
                None,
                None,
                None,
                None,
                'Photo/etalons/cam-rot-1/primary.jpg',
                None,
                0,
                '2025-12-01T00:00:00',
                '2025-12-01T00:00:00',
            ),
        )
        connection.execute(
            f'''
            INSERT INTO ticket_photos ({", ".join(sqlite_store.TICKET_PHOTO_COLUMNS)})
            VALUES ({", ".join(["?"] * len(sqlite_store.TICKET_PHOTO_COLUMNS))})
            ''',
            (
                'ph-rot-1',
                't-dictionary',
                'cam-rot-1',
                'entry',
                'gross',
                'Photo/2025/12/31/t-dictionary_gross_cam-rot-1_entry.jpg',
                'success',
                None,
                '2025-12-31T21:05:00',
                'primary',
            ),
        )
        connection.commit()


def test_copy_whitelist_copies_cameras_not_ticket_photos(temp_stage6_root):
    """Whitelist copy includes cameras and excludes ticket_photos."""
    paths = temp_stage6_root(config_overrides={'tara_default': '0', 'active_year': 2025})
    source_db = Path(paths['bd_dir']) / 'weighing-2025.db'
    build_stage6_active_year_db(source_db)
    _seed_cameras_and_photos(source_db)

    target_db = Path(paths['bd_dir']) / 'weighing-2026.db.tmp'
    with sqlite3.connect(source_db) as source_conn, sqlite3.connect(target_db) as target_conn:
        source_conn.row_factory = sqlite3.Row
        target_conn.row_factory = sqlite3.Row
        sqlite_store.init_schema(target_conn)
        copied = sqlite_store.copy_whitelist_data(source_conn, target_conn)
        target_conn.commit()

        assert copied.get('cameras') == 1
        assert 'ticket_photos' not in copied
        assert sqlite_store._table_count(target_conn, 'cameras') == 1
        assert sqlite_store._table_count(target_conn, 'ticket_photos') == 0

        validation = sqlite_store.validate_new_year_database(target_conn)
        assert validation['valid'] is True


def test_validate_new_year_rejects_nonzero_ticket_photos(temp_stage6_root):
    """ticket_photos rows in a fresh year DB fail validate_new_year_database."""
    paths = temp_stage6_root()
    target_db = Path(paths['bd_dir']) / 'weighing-2026-bad.db'
    with sqlite3.connect(target_db) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            f'''
            INSERT INTO ticket_photos ({", ".join(sqlite_store.TICKET_PHOTO_COLUMNS)})
            VALUES ({", ".join(["?"] * len(sqlite_store.TICKET_PHOTO_COLUMNS))})
            ''',
            (
                'ph-bad',
                't-x',
                'cam-x',
                'entry',
                'gross',
                None,
                'failed',
                'timeout',
                '2026-01-01T00:00:00',
                None,
            ),
        )
        connection.commit()
        validation = sqlite_store.validate_new_year_database(connection)
    assert validation['valid'] is False
    assert validation['forbidden_nonzero'].get('ticket_photos') == 1


def test_rotation_commit_copies_cameras_forbids_ticket_photos(
    temp_stage6_root, monkeypatch
):
    """TC-E2E-03: after year rotation new DB has cameras and ticket_photos count=0."""
    paths = temp_stage6_root(config_overrides={'tara_default': '900', 'active_year': 2025})
    source_db = Path(paths['bd_dir']) / 'weighing-2025.db'
    build_stage6_active_year_db(source_db)
    _seed_cameras_and_photos(source_db)
    persistence.write_active_year(2025)
    freeze_stage6_now(monkeypatch, datetime(2026, 1, 1, 10, 0, 0))

    preview = year_rotation.build_rotation_preview(
        datetime(2026, 1, 1, 10, 0, 0),
        actor={'id': 'u-1', 'role': 'user'},
    )
    result = year_rotation.commit_year_rotation(
        preview_token=preview['preview_token'],
        acknowledge_pending_reo=True,
        actor={'id': 'u-1', 'role': 'user'},
        now=datetime(2026, 1, 1, 10, 1, 0),
    )
    assert result['success'] is True
    new_db = Path(result['new_db_path'])
    assert new_db.is_file()

    with sqlite3.connect(new_db) as connection:
        connection.row_factory = sqlite3.Row
        cameras = connection.execute(
            'SELECT id, site_id, role, etalon_primary_path FROM cameras'
        ).fetchall()
        photos_count = sqlite_store._table_count(connection, 'ticket_photos')
        tickets_count = sqlite_store._table_count(connection, 'weighing_tickets')

    assert len(cameras) == 1
    assert cameras[0]['id'] == 'cam-rot-1'
    assert cameras[0]['etalon_primary_path'] == 'Photo/etalons/cam-rot-1/primary.jpg'
    assert photos_count == 0
    assert tickets_count == 0

    # Source year still holds ticket_photos journal rows.
    with sqlite3.connect(source_db) as source_conn:
        source_conn.row_factory = sqlite3.Row
        assert sqlite_store._table_count(source_conn, 'ticket_photos') == 1


def test_count_stage6_tables_includes_cameras(temp_app_root):
    """Preview counts include cameras; ticket_photos is not required in the map."""
    db_path = temp_app_root / 'BD' / 'counts.db'
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            f'''
            INSERT INTO cameras ({", ".join(sqlite_store.CAMERA_COLUMNS)})
            VALUES ({", ".join(["?"] * len(sqlite_store.CAMERA_COLUMNS))})
            ''',
            (
                'cam-c',
                'site-1',
                'Cam',
                'overview',
                'http://cam/snap',
                None,
                0,
                None,
                None,
                None,
                None,
                None,
                None,
                0,
                '2026-07-31T00:00:00',
                '2026-07-31T00:00:00',
            ),
        )
        connection.commit()
        counts = sqlite_store.count_stage6_tables(connection)

    assert counts.get('cameras') == 1
    assert 'ticket_photos' not in counts
