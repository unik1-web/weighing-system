"""Task 2.1 tests: primary legacy->yearly stage-6 migration."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

import persistence
import sqlite_store
import year_context
import year_rotation


def _build_legacy_db(path: Path, ticket_dates: list[str]) -> None:
    """Create deterministic legacy DB fixture with optional ticket dates."""
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for index, created_at in enumerate(ticket_dates, start=1):
            ticket_id = f"t-{index}"
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, created_at, gross_datetime, completed_at, status, reo_status
                )
                VALUES (?, ?, ?, ?, ?, 'completed', 'pending')
                """,
                (ticket_id, index, created_at, created_at, created_at),
            )
            connection.execute(
                """
                INSERT INTO ticket_audit (id, ticket_id, action, at, operator_name, event_type, source_year)
                VALUES (?, ?, ?, ?, ?, '', NULL)
                """,
                (f"a-{index}", ticket_id, "created", created_at, "system"),
            )
        connection.commit()


def test_resolve_migration_year_uses_max_ticket_year_or_now(temp_stage6_root):
    """TC-UNIT-01: migration year comes from ticket dates or current year."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    _build_legacy_db(legacy_path, ["2024-01-02T10:00:00", "2026-08-03T11:30:00"])

    migration_year = year_context.resolve_migration_year(datetime(2030, 1, 1, 0, 0, 0))
    assert migration_year == 2026

    legacy_path.unlink()
    _build_legacy_db(legacy_path, [])
    fallback_year = year_context.resolve_migration_year(datetime(2030, 1, 1, 0, 0, 0))
    assert fallback_year == 2030


def test_copy_on_write_backup_tmp_publish_flow(temp_stage6_root):
    """TC-UNIT-02: backup, tmp copy and atomic publish work."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    target_path = Path(paths["bd_dir"]) / "weighing-2026.db"
    tmp_path = Path(f"{target_path}.tmp")
    _build_legacy_db(legacy_path, ["2026-01-01T00:00:00"])

    backup_path = Path(persistence.create_database_backup(str(legacy_path), "legacy-before-stage6"))
    assert backup_path.is_file()
    assert "legacy-before-stage6" in backup_path.name

    created_tmp_path = persistence.create_tmp_copy_from_legacy(str(legacy_path), str(tmp_path))
    assert Path(created_tmp_path).is_file()
    assert tmp_path.read_bytes() == legacy_path.read_bytes()

    persistence.publish_tmp_database(str(tmp_path), str(target_path))
    assert target_path.is_file()
    assert not tmp_path.exists()


def test_backfill_stage6_audit_columns_sets_required_defaults(temp_stage6_root):
    """TC-UNIT-03: legacy ticket_audit rows receive stage-6 defaults."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    _build_legacy_db(legacy_path, ["2026-01-01T00:00:00"])

    with sqlite3.connect(legacy_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.backfill_stage6_audit_columns(connection, 2026)
        row = connection.execute(
            """
            SELECT action, event_type, source_year, changed_fields_json, old_values_json, new_values_json, reo_divergence_warning
            FROM ticket_audit
            WHERE id = 'a-1'
            """
        ).fetchone()

    assert row is not None
    assert row["event_type"] == row["action"] == "created"
    assert row["source_year"] == 2026
    assert row["changed_fields_json"] is None
    assert row["old_values_json"] is None
    assert row["new_values_json"] is None
    assert row["reo_divergence_warning"] == 0


def test_mixed_legacy_primary_migration(temp_stage6_root):
    """TC-E2E-01: mixed legacy migrates into one yearly container with warning."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    _build_legacy_db(
        legacy_path,
        ["2024-02-02T10:00:00", "2026-05-06T12:00:00"],
    )

    result = year_rotation.ensure_stage6_storage_bootstrap(datetime(2026, 6, 1, 10, 0, 0))

    assert result["status"] == "migrated"
    assert result["migration_year"] == 2026
    assert result["backup_path"] is not None
    assert Path(result["active_db_path"]).is_file()
    assert persistence.read_active_year() == 2026
    warning = result["warning"]
    assert isinstance(warning, dict)
    assert warning["code"] == "mixed_legacy_year_mismatch"
    assert set(warning["ticket_years"]) == {2024, 2026}


def test_empty_legacy_migration_uses_current_year(temp_stage6_root):
    """TC-E2E-02: empty legacy chooses current Gregorian year."""
    paths = temp_stage6_root()
    _build_legacy_db(Path(paths["legacy_db_path"]), [])

    result = year_rotation.ensure_stage6_storage_bootstrap(datetime(2031, 1, 2, 8, 0, 0))

    assert result["status"] == "migrated"
    assert result["migration_year"] == 2031
    assert Path(result["active_db_path"]).name == "weighing-2031.db"
    assert persistence.read_active_year() == 2031
    assert result["warning"] is None


def test_migration_target_conflict_keeps_legacy_and_config(temp_stage6_root):
    """TC-E2E-03: existing target DB blocks migration safely."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    _build_legacy_db(legacy_path, ["2026-01-01T00:00:00"])
    conflict_target = Path(paths["bd_dir"]) / "weighing-2026.db"
    conflict_target.write_bytes(b"conflict")

    result = year_rotation.ensure_stage6_storage_bootstrap(datetime(2026, 1, 1, 0, 0, 0))

    assert result["status"] == "error"
    assert result["code"] == "migration_target_exists"
    assert persistence.read_active_year() is None
    assert legacy_path.is_file()


def test_resume_after_publish_failure_before_active_year_write(temp_stage6_root, monkeypatch):
    """TC-E2E-04: restart resumes after publish and writes active_year."""
    paths = temp_stage6_root()
    _build_legacy_db(Path(paths["legacy_db_path"]), ["2027-01-01T00:00:00"])
    target_path = Path(paths["bd_dir"]) / "weighing-2027.db"

    original_write_active_year = year_rotation.write_active_year

    def _raise_after_publish(year: int) -> None:
        raise RuntimeError(f"injected write_active_year failure for {year}")

    monkeypatch.setattr(year_rotation, "write_active_year", _raise_after_publish)
    first_result = year_rotation.ensure_stage6_storage_bootstrap(datetime(2027, 1, 1, 0, 0, 0))
    assert first_result["status"] == "error"
    assert first_result["code"] == "migration_failed"
    assert persistence.read_active_year() is None
    assert target_path.is_file()

    monkeypatch.setattr(year_rotation, "write_active_year", original_write_active_year)
    second_result = year_rotation.ensure_stage6_storage_bootstrap(datetime(2027, 1, 1, 0, 0, 0))
    assert second_result["status"] == "resumed_after_publish"
    assert persistence.read_active_year() == 2027

