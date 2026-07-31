"""Backend integration coverage for stage-6 primary migration (UC-01 / TF-01)."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

import persistence
import sqlite_store
from stage6_fixtures import build_stage6_legacy_db, freeze_stage6_now


def test_tf01_mixed_legacy_migration_via_config_bootstrap(api_client, temp_stage6_root, monkeypatch):
    """TC-E2E-01 / TF-01: mixed legacy migrates into one yearly file with warning."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    build_stage6_legacy_db(
        legacy_path,
        ticket_dates=["2024-02-02T10:00:00", "2026-05-06T12:00:00"],
    )
    freeze_stage6_now(monkeypatch, datetime(2026, 6, 1, 10, 0, 0))

    response = api_client.get("/api/config")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    bootstrap = payload["bootstrap"]
    assert bootstrap["status"] == "migrated"
    assert bootstrap["migration_year"] == 2026
    assert Path(bootstrap["active_db_path"]).name == "weighing-2026.db"
    assert Path(bootstrap["active_db_path"]).is_file()
    assert Path(paths["bd_dir"], "weighing-2024.db").exists() is False
    assert persistence.read_active_year() == 2026

    warning = bootstrap.get("warning")
    assert isinstance(warning, dict)
    assert warning["code"] == "mixed_legacy_year_mismatch"
    assert set(warning["ticket_years"]) == {2024, 2026}

    with sqlite3.connect(bootstrap["active_db_path"]) as connection:
        connection.row_factory = sqlite3.Row
        ticket_count = connection.execute("SELECT COUNT(*) AS c FROM weighing_tickets").fetchone()["c"]
        audit_count = connection.execute("SELECT COUNT(*) AS c FROM ticket_audit").fetchone()["c"]
    assert ticket_count == 2
    assert audit_count == 2

    # Archive UI warning for ticket whose calendar year differs from filename year.
    # Mixed container becomes an archive after advancing active_year.
    active_2027 = Path(paths["bd_dir"]) / "weighing-2027.db"
    with sqlite3.connect(active_2027) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()
    persistence.write_active_year(2027)

    session_payload = json.dumps(
        {
            "user": {"id": "u-mig", "username": "operator"},
            "profile": {
                "username": "operator",
                "display_name": "Оператор",
                "role": "user",
            },
        },
        ensure_ascii=False,
    )
    seeded = api_client.post("/api/database", json={"data": {"app_current_user": session_payload}})
    assert seeded.status_code == 200

    tickets_response = api_client.get("/api/archive/tickets?year=2026")
    assert tickets_response.status_code == 200
    tickets_payload = tickets_response.get_json()
    assert tickets_payload["year"] == 2026
    assert tickets_payload["warning"]["code"] == "mixed_legacy_year_mismatch"


def test_empty_legacy_migration_via_health_bootstrap(api_client, temp_stage6_root, monkeypatch):
    """Empty legacy chooses current Gregorian year through /api/health bootstrap path."""
    paths = temp_stage6_root()
    build_stage6_legacy_db(Path(paths["legacy_db_path"]), ticket_dates=[])
    freeze_stage6_now(monkeypatch, datetime(2031, 1, 2, 8, 0, 0))

    # /api/config is the documented bootstrap entry; health stays lightweight.
    response = api_client.get("/api/config")
    assert response.status_code == 200
    bootstrap = response.get_json()["bootstrap"]
    assert bootstrap["status"] == "migrated"
    assert bootstrap["migration_year"] == 2031
    assert Path(bootstrap["active_db_path"]).name == "weighing-2031.db"
    assert bootstrap.get("warning") is None
    assert persistence.read_active_year() == 2031


def test_migration_target_conflict_via_api(api_client, temp_stage6_root, monkeypatch):
    """Existing target yearly DB blocks migration and keeps legacy untouched."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    build_stage6_legacy_db(legacy_path, ticket_dates=["2026-01-01T00:00:00"])
    conflict = Path(paths["bd_dir"]) / "weighing-2026.db"
    conflict.write_bytes(b"conflict")
    freeze_stage6_now(monkeypatch, datetime(2026, 1, 1, 0, 0, 0))

    response = api_client.get("/api/config")
    assert response.status_code == 500
    payload = response.get_json()
    assert payload["success"] is False
    assert payload["code"] == "migration_target_exists"
    assert persistence.read_active_year() is None
    assert legacy_path.is_file()
