"""Task 2.2 tests: preview/commit rotation, lock guard and whitelist copy."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import persistence
import sqlite_store
import year_context
import year_rotation


def _build_active_year_fixture(db_path: Path) -> None:
    """Create active-year DB with open tickets and whitelist entities."""
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            """
            INSERT INTO users (id, email, username, password_hash)
            VALUES ('u-1', 'op@example.com', 'operator', 'hash')
            """
        )
        connection.execute(
            """
            INSERT INTO profiles (user_id, username, display_name, role)
            VALUES ('u-1', 'operator', 'Оператор', 'user')
            """
        )
        connection.execute(
            """
            INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
            VALUES (?, 'vehicles', ?, '', '2025-01-01T00:00:00', ?)
            """,
            (
                'v-1',
                'А001АА',
                '{"vehicle_number":"А001АА","default_tare_weight":1200}',
            ),
        )
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, gross_weight, price, vat_rate,
                status, reo_status, operator_id, operator_name, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'u-1', 'Оператор', ?)
            """,
            ('t-dictionary', 101, 'А001АА', 5000, 2, 20, 'sent', '2025-12-31T21:00:00'),
        )
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, gross_weight, price, vat_rate,
                status, reo_status, operator_id, operator_name, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'u-1', 'Оператор', ?)
            """,
            ('t-default', 102, 'В002ВВ', 4000, 3, 20, 'pending', '2025-12-31T22:00:00'),
        )
        connection.execute(
            """
            INSERT INTO app_sessions (id, payload)
            VALUES (1, '{"user":{"id":"u-1"}}')
            """
        )
        connection.commit()


def _build_lock_payload(source_year: int, target_year: int, tmp_db_path: str, *, stale: bool) -> dict[str, object]:
    started_at = datetime.now()
    if stale:
        started_at = started_at - timedelta(minutes=20)
    return {
        'source_year': source_year,
        'target_year': target_year,
        'preview_token': 'preview-token',
        'source_db_fingerprint': 'fingerprint',
        'started_at': started_at.isoformat(),
        'phase': 'tmp_ready',
        'recovery_mode': 'none',
        'backup_path': None,
        'tmp_db_path': tmp_db_path,
        'lock_ttl_seconds': 900,
    }


def test_rotation_preview_builds_candidates_without_writes(temp_stage6_root):
    """TC-E2E-01 + TC-UNIT-01: preview returns candidates and keeps DB unchanged."""
    paths = temp_stage6_root(config_overrides={'tara_default': '900'})
    source_year = 2025
    persistence.write_active_year(source_year)
    source_db = Path(paths['bd_dir']) / f'weighing-{source_year}.db'
    _build_active_year_fixture(source_db)

    with sqlite3.connect(source_db) as conn_before:
        conn_before.row_factory = sqlite3.Row
        before_count = conn_before.execute(
            "SELECT COUNT(*) AS count FROM ticket_audit WHERE event_type = 'auto_close'"
        ).fetchone()['count']

    preview = year_rotation.build_rotation_preview(
        datetime(2026, 1, 1, 9, 0, 0),
        actor={'id': 'u-1', 'role': 'user'},
    )
    assert preview['source_year'] == 2025
    assert preview['target_year'] == 2026
    assert preview['pending_reo_count'] == 1
    assert len(preview['open_candidates']) == 2
    tare_sources = {item['ticket_id']: item['tare_source'] for item in preview['open_candidates']}
    assert tare_sources['t-dictionary'] == 'dictionary'
    assert tare_sources['t-default'] == 'default'
    assert preview['blocking_tickets'] == []

    with sqlite3.connect(source_db) as conn_after:
        conn_after.row_factory = sqlite3.Row
        after_count = conn_after.execute(
            "SELECT COUNT(*) AS count FROM ticket_audit WHERE event_type = 'auto_close'"
        ).fetchone()['count']
    assert before_count == after_count == 0


def test_assert_active_db_write_allowed_blocks_fresh_and_stale_lock(temp_stage6_root):
    """TC-UNIT-02: guard blocks writes for fresh/stale lock and allows commit override."""
    paths = temp_stage6_root()
    source_year = 2025
    target_year = 2026
    lock_payload = _build_lock_payload(source_year, target_year, paths['lock_path'], stale=False)
    persistence.write_rotation_lock(lock_payload)

    try:
        year_context.assert_active_db_write_allowed('POST /api/database')
    except year_context.RotationContractError as exc:
        assert exc.code == 'rotation_in_progress'
        assert exc.status == 409
    else:
        raise AssertionError('Expected rotation_in_progress for fresh lock')

    year_context.assert_active_db_write_allowed(
        'POST /api/year/rotation/commit',
        allow_rotation_commit=True,
    )
    persistence.remove_rotation_lock()

    stale_payload = _build_lock_payload(source_year, target_year, paths['lock_path'], stale=True)
    persistence.write_rotation_lock(stale_payload)
    try:
        year_context.assert_active_db_write_allowed('POST /api/storage')
    except year_context.RotationContractError as exc:
        assert exc.code == 'rotation_in_progress'
        assert exc.status == 409
    else:
        raise AssertionError('Expected stale lock to block active writes')


def test_whitelist_copy_excludes_runtime_and_journal_rows(temp_stage6_root):
    """TC-UNIT-03: only whitelist entities are copied to target DB."""
    paths = temp_stage6_root(config_overrides={'tara_default': '0'})
    source_year = 2025
    persistence.write_active_year(source_year)
    source_db = Path(paths['bd_dir']) / f'weighing-{source_year}.db'
    _build_active_year_fixture(source_db)

    target_db = Path(paths['bd_dir']) / 'weighing-2026.db.tmp'
    with sqlite3.connect(source_db) as source_conn, sqlite3.connect(target_db) as target_conn:
        source_conn.row_factory = sqlite3.Row
        target_conn.row_factory = sqlite3.Row
        sqlite_store.init_schema(target_conn)
        copied = sqlite_store.copy_whitelist_data(source_conn, target_conn)
        target_conn.commit()

        assert copied['users'] == 1
        assert copied['profiles'] == 1
        assert copied['dictionary_entries'] == 1
        assert sqlite_store._table_count(target_conn, 'weighing_tickets') == 0
        assert sqlite_store._table_count(target_conn, 'ticket_audit') == 0
        assert sqlite_store._table_count(target_conn, 'scale_switch_journal') == 0
        sqlite_store.assert_no_forbidden_runtime_keys(target_conn)


def test_rotation_commit_creates_backup_switches_year_and_clears_session(temp_stage6_root):
    """TC-E2E-02: commit rotates year with backup, auto-close and target publish."""
    paths = temp_stage6_root(config_overrides={'tara_default': '900'})
    source_year = 2025
    persistence.write_active_year(source_year)
    source_db = Path(paths['bd_dir']) / f'weighing-{source_year}.db'
    _build_active_year_fixture(source_db)

    preview = year_rotation.build_rotation_preview(datetime(2026, 1, 1, 10, 0, 0), actor={})
    result = year_rotation.commit_year_rotation(
        preview_token=preview['preview_token'],
        acknowledge_pending_reo=True,
        actor={'id': 'u-1', 'role': 'user'},
        now=datetime(2026, 1, 1, 10, 1, 0),
    )
    assert result['success'] is True
    assert result['auto_closed_count'] == 2
    assert Path(result['backup_path']).is_file()
    assert persistence.read_active_year() == 2026
    assert Path(result['new_db_path']).is_file()
    assert persistence.read_rotation_lock() is None

    with sqlite3.connect(source_db) as source_conn:
        source_conn.row_factory = sqlite3.Row
        closed_rows = source_conn.execute(
            "SELECT COUNT(*) AS count FROM weighing_tickets WHERE auto_closed = 1"
        ).fetchone()['count']
        audit_rows = source_conn.execute(
            "SELECT COUNT(*) AS count FROM ticket_audit WHERE event_type = 'auto_close'"
        ).fetchone()['count']
        sessions = source_conn.execute("SELECT COUNT(*) AS count FROM app_sessions").fetchone()['count']
    assert closed_rows == 2
    assert audit_rows == 2
    assert sessions == 0

    with sqlite3.connect(result['new_db_path']) as target_conn:
        target_conn.row_factory = sqlite3.Row
        assert sqlite_store._table_count(target_conn, 'weighing_tickets') == 0
        assert sqlite_store._table_count(target_conn, 'ticket_audit') == 0


def test_rotation_commit_returns_in_progress_for_fresh_lock(temp_stage6_root):
    """TC-E2E-04: second commit is blocked by fresh lock."""
    paths = temp_stage6_root()
    source_year = 2025
    target_year = 2026
    persistence.write_rotation_lock(
        _build_lock_payload(
            source_year,
            target_year,
            str(Path(paths['bd_dir']) / 'weighing-2026.db.tmp'),
            stale=False,
        )
    )
    try:
        year_rotation.commit_year_rotation(
            preview_token='any',
            acknowledge_pending_reo=True,
            actor={},
            now=datetime(2026, 1, 1, 10, 0, 0),
        )
    except year_context.RotationContractError as exc:
        assert exc.code == 'rotation_in_progress'
        assert exc.status == 409
    else:
        raise AssertionError('Expected rotation_in_progress for fresh lock')


def test_recover_rotation_if_needed_resumes_valid_tmp(temp_stage6_root):
    """TC-E2E-05: stale lock recovery picks `resume_tmp` when tmp DB is valid."""
    paths = temp_stage6_root()
    source_year = 2025
    target_year = 2026
    tmp_db = Path(paths['bd_dir']) / f'weighing-{target_year}.db.tmp'
    with sqlite3.connect(tmp_db) as target_conn:
        target_conn.row_factory = sqlite3.Row
        sqlite_store.init_schema(target_conn)
        target_conn.commit()

    persistence.write_rotation_lock(
        _build_lock_payload(source_year, target_year, str(tmp_db), stale=True)
    )
    recovery = year_rotation.recover_rotation_if_needed(datetime.now())
    assert recovery['mode'] == 'resume_tmp'
