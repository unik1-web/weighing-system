"""Active-year storage service tests for yearly DB isolation."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

import active_year_service
import persistence
import sqlite_store
import year_context


def _build_lock_payload(source_year: int, target_year: int, tmp_db_path: str) -> dict[str, object]:
    return {
        'source_year': source_year,
        'target_year': target_year,
        'preview_token': 'preview-token',
        'source_db_fingerprint': 'fingerprint',
        'started_at': datetime.now().isoformat(),
        'phase': 'tmp_ready',
        'recovery_mode': 'none',
        'backup_path': None,
        'tmp_db_path': tmp_db_path,
        'lock_ttl_seconds': 900,
    }


def test_next_ticket_number_starts_from_one_per_year_db(temp_stage6_root):
    """TC-UNIT-01: ticket numbering is isolated inside current DB file."""
    paths = temp_stage6_root()
    source_db = Path(paths['bd_dir']) / 'weighing-2026.db'
    with sqlite3.connect(source_db) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        assert sqlite_store.next_ticket_number(connection) == 1

        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, operator_name, created_at, status, reo_status
            ) VALUES ('t-1', 1, 'А001АА56', 'Оператор', '2026-01-01T10:00:00', 'completed', 'pending')
            """
        )
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, operator_name, created_at, status, reo_status
            ) VALUES ('t-2', 2, 'А002АА56', 'Оператор', '2026-01-01T11:00:00', 'completed', 'pending')
            """
        )
        assert sqlite_store.next_ticket_number(connection) == 3


def test_write_active_storage_respects_rotation_write_gate(temp_stage6_root):
    """TC-UNIT-02: write_active_storage writes normally and blocks under lock."""
    paths = temp_stage6_root()
    persistence.write_active_year(2026)
    active_db = Path(paths['bd_dir']) / 'weighing-2026.db'
    with sqlite3.connect(active_db) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()

    active_year_service.write_active_storage(
        {'app_current_user': '{"user":{"id":"u-1"}}'},
        operation='unit-test-write',
    )

    with sqlite3.connect(active_db) as connection:
        connection.row_factory = sqlite3.Row
        session_count = connection.execute(
            "SELECT COUNT(*) AS count FROM app_sessions WHERE id = 1"
        ).fetchone()['count']
    assert session_count == 1

    persistence.write_rotation_lock(
        _build_lock_payload(2026, 2027, str(active_db.with_suffix('.db.tmp')))
    )
    try:
        active_year_service.write_active_storage(
            {'app_current_user': '{"user":{"id":"u-2"}}'},
            operation='unit-test-write-locked',
        )
    except year_context.RotationContractError as exc:
        assert exc.code == 'rotation_in_progress'
        assert exc.status == 409
    else:
        raise AssertionError('Expected rotation_in_progress while lock is active')


def test_get_active_ticket_numbering_state_returns_year_and_max(temp_stage6_root):
    """TC-E2E-01: diagnostics expose active year and max ticket number."""
    paths = temp_stage6_root()
    persistence.write_active_year(2028)
    active_db = Path(paths['bd_dir']) / 'weighing-2028.db'
    with sqlite3.connect(active_db) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, operator_name, created_at, status, reo_status
            ) VALUES ('t-1', 7, 'А007АА56', 'Оператор', '2028-01-01T11:00:00', 'completed', 'pending')
            """
        )
        connection.commit()

    state = active_year_service.get_active_ticket_numbering_state()
    assert state['active_year'] == 2028
    assert state['max_ticket_number'] == 7
