"""Deploy runbook and operational rollout checks for stage-6 yearly archive."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

import persistence
import sqlite_store
import year_rotation
from stage6_fixtures import (
    build_stage6_active_year_db,
    build_stage6_legacy_db,
    freeze_stage6_now,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_RUNBOOK = REPO_ROOT / "docs" / "yearly-db-archive-deploy.md"
README_PATH = REPO_ROOT / "README.md"
BUILD_PS1 = REPO_ROOT / "installer" / "build.ps1"
ISS_PATH = REPO_ROOT / "installer" / "weighing-system.iss"
PACKAGE_JSON = REPO_ROOT / "package.json"


def _read(path: Path) -> str:
    """Read UTF-8 text file from repository root."""
    return path.read_text(encoding="utf-8")


def test_deploy_runbook_contains_required_stage6_sections():
    """TC-UNIT-01: deploy runbook covers environment, migration, rollback, rotation, smoke."""
    text = _read(DEPLOY_RUNBOOK)

    required_headings = [
        "## Подготовка окружения",
        "## Миграция данных",
        "## Годовая ротация",
        "## Smoke после выката",
    ]
    for heading in required_headings:
        assert heading in text, f"Missing runbook section: {heading}"

    required_tokens = [
        "BD/weighing-ГГГГ.db",
        "active_year",
        "backup/",
        "BD/.year_rotation.lock",
        "_MEIPASS",
        "config.ini",
        "legacy-before-stage6",
        "migration_target_exists",
        "mixed_legacy_year_mismatch",
        "Rollback",
        "stale",
        "15 минут",
        "npm run build",
        "npm start",
        "smoke_yearly_archive.py --scenario active",
        "smoke_yearly_archive.py --scenario archive",
        "повторный вход",
        "Retention",
    ]
    for token in required_tokens:
        assert token in text, f"Runbook missing required token: {token}"


def test_readme_stage6_quick_check_and_storage():
    """TC-UNIT-02: README storage and quick-check match real project scripts."""
    readme = _read(README_PATH)
    package = json.loads(_read(PACKAGE_JSON))
    scripts = package.get("scripts", {})

    assert "npm run build" in readme
    assert "npm start" in readme
    assert scripts.get("build") == "vite build"
    assert scripts.get("start") == "python server/app.py"
    assert "smoke:stage6" in scripts
    assert "smoke_yearly_archive.py" in scripts["smoke:stage6"]

    storage_tokens = [
        "BD/weighing-ГГГГ.db",
        "active_year",
        "backup/",
        "BD/.year_rotation.lock",
        "_MEIPASS",
    ]
    for token in storage_tokens:
        assert token in readme, f"README storage missing: {token}"

    quick_check_tokens = [
        "Backup legacy",
        "Первый запуск после релиза",
        "Проверка результата миграции",
        "Smoke активного года",
        "Smoke архива",
        "smoke_yearly_archive.py --scenario active",
        "smoke_yearly_archive.py --scenario archive",
        "yearly-db-archive-deploy.md",
    ]
    for token in quick_check_tokens:
        assert token in readme, f"README quick-check missing: {token}"


def test_installer_layout_keeps_bd_backup_logs_outside_meipass():
    """Installer package layout continues to create/use BD/, backup/, logs/, Photo/ next to app."""
    iss = _read(ISS_PATH)
    build_ps1 = _read(BUILD_PS1)

    assert r'{app}\BD' in iss
    assert r'{app}\backup' in iss
    assert r'{app}\logs' in iss
    assert r'{app}\Photo' in iss
    assert "_MEIPASS" not in iss

    assert "Assert-StorageLayoutDirectories" in build_ps1
    assert r'{app}\BD' in build_ps1
    assert r'{app}\backup' in build_ps1
    assert r'{app}\logs' in build_ps1
    assert r'{app}\Photo' in build_ps1
    assert "smoke_yearly_archive.py --scenario active" in build_ps1
    assert "smoke_yearly_archive.py --scenario archive" in build_ps1


def test_e2e_rollout_legacy_copy_follows_runbook(api_client, temp_stage6_root, monkeypatch):
    """
    TC-E2E-01: Rollout on legacy environment copy.

    Preflight-style external pair is simulated by keeping untouched originals under
    temp root; bootstrap performs app-side backup then primary migration; active-year
    smoke contract is checked via /api/config bootstrap payload.
    """
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    build_stage6_legacy_db(
        legacy_path,
        ticket_dates=["2025-03-01T09:00:00", "2025-11-02T11:00:00"],
    )
    freeze_stage6_now(monkeypatch, datetime(2026, 1, 5, 10, 0, 0))

    # Operator preflight copies (outside app BD/) — runbook step.
    preflight_dir = Path(paths["root"]) / "preflight-external"
    preflight_dir.mkdir()
    preflight_config = preflight_dir / "config.pre-stage6.ini"
    preflight_db = preflight_dir / "weighing.pre-stage6.db"
    preflight_config.write_text(Path(paths["config_path"]).read_text(encoding="utf-8"), encoding="utf-8")
    preflight_db.write_bytes(legacy_path.read_bytes())

    response = api_client.get("/api/config")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    bootstrap = payload["bootstrap"]
    assert bootstrap["status"] == "migrated"
    assert bootstrap["migration_year"] == 2025
    assert Path(bootstrap["active_db_path"]).name == "weighing-2025.db"
    assert Path(bootstrap["active_db_path"]).is_file()
    assert Path(bootstrap["backup_path"]).is_file()
    assert "legacy-before-stage6" in Path(bootstrap["backup_path"]).name
    assert persistence.read_active_year() == 2025

    # Preflight external copies remain intact (rollback source).
    assert preflight_db.is_file()
    assert preflight_config.is_file()
    assert legacy_path.is_file()

    # Active-year smoke contract: config exposes active_year and yearly DB path.
    assert str(payload["config"].get("active_year")) == "2025"
    runbook = _read(DEPLOY_RUNBOOK)
    assert "smoke_yearly_archive.py --scenario active" in runbook
    assert "Первый запуск stage 6" in runbook


def test_e2e_post_rotation_operational_smoke(api_client, temp_stage6_root, monkeypatch):
    """
    TC-E2E-02: After successful rotation — new active_year, backup, re-login, ticket #1.
    """
    paths = temp_stage6_root(config_overrides={"tara_default": "900", "active_year": 2025})
    source_db = Path(paths["bd_dir"]) / "weighing-2025.db"
    build_stage6_active_year_db(source_db)
    persistence.write_active_year(2025)
    freeze_stage6_now(monkeypatch, datetime(2026, 1, 2, 9, 0, 0))

    session_payload = json.dumps(
        {
            "user": {"id": "u-rot", "username": "operator"},
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

    preview = api_client.post("/api/year/rotation/preview", json={})
    assert preview.status_code == 200
    preview_body = preview.get_json()
    assert preview_body["success"] is True
    assert preview_body["source_year"] == 2025
    assert preview_body["target_year"] == 2026

    commit = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": preview_body["preview_token"],
            "source_year": 2025,
            "target_year": 2026,
            "acknowledge_pending_reo": True,
        },
    )
    assert commit.status_code == 200
    commit_body = commit.get_json()
    assert commit_body["success"] is True
    assert Path(commit_body["backup_path"]).is_file()
    assert "before-rotation-2026" in Path(commit_body["backup_path"]).name
    assert Path(commit_body["new_db_path"]).name == "weighing-2026.db"
    assert persistence.read_active_year() == 2026

    # Session cleared in closed-year DB — operator must sign in again.
    with sqlite3.connect(source_db) as connection:
        sessions = connection.execute("SELECT COUNT(*) AS c FROM app_sessions").fetchone()[0]
    assert sessions == 0

    # First ticket number in the new year is 1.
    with sqlite3.connect(commit_body["new_db_path"]) as connection:
        connection.row_factory = sqlite3.Row
        next_number = sqlite_store.next_ticket_number(connection)
    assert next_number == 1

    runbook = _read(DEPLOY_RUNBOOK)
    assert "повторный вход" in runbook.lower()
    assert "номер `1`" in runbook


def test_e2e_mixed_legacy_operational_check(api_client, temp_stage6_root, monkeypatch):
    """
    TC-E2E-03: Mixed legacy — operator sees warning and knows how to verify archive.
    """
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    build_stage6_legacy_db(
        legacy_path,
        ticket_dates=["2024-02-02T10:00:00", "2026-05-06T12:00:00"],
    )
    freeze_stage6_now(monkeypatch, datetime(2026, 6, 1, 10, 0, 0))

    response = api_client.get("/api/config")
    assert response.status_code == 200
    bootstrap = response.get_json()["bootstrap"]
    assert bootstrap["status"] == "migrated"
    warning = bootstrap["warning"]
    assert warning["code"] == "mixed_legacy_year_mismatch"
    assert set(warning["ticket_years"]) == {2024, 2026}

    # Archive check after advancing active year (container year = filename).
    active_2027 = Path(paths["bd_dir"]) / "weighing-2027.db"
    with sqlite3.connect(active_2027) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()
    persistence.write_active_year(2027)

    session_payload = json.dumps(
        {
            "user": {"id": "u-mix", "username": "operator"},
            "profile": {
                "username": "operator",
                "display_name": "Оператор",
                "role": "user",
            },
        },
        ensure_ascii=False,
    )
    assert api_client.post("/api/database", json={"data": {"app_current_user": session_payload}}).status_code == 200

    tickets_response = api_client.get("/api/archive/tickets?year=2026")
    assert tickets_response.status_code == 200
    tickets_payload = tickets_response.get_json()
    assert tickets_payload["warning"]["code"] == "mixed_legacy_year_mismatch"

    runbook = _read(DEPLOY_RUNBOOK)
    assert "mixed_legacy_year_mismatch" in runbook
    assert "**один** файл" in runbook
    assert "**не** режет" in runbook
    assert "Архив" in runbook


def test_runbook_documents_migration_target_exists_handling(temp_stage6_root, monkeypatch):
    """Runbook order for migration_target_exists matches runtime error code."""
    paths = temp_stage6_root()
    legacy_path = Path(paths["legacy_db_path"])
    build_stage6_legacy_db(legacy_path, ticket_dates=["2026-01-01T10:00:00"])
    target = Path(paths["bd_dir"]) / "weighing-2026.db"
    target.write_bytes(b"conflict")
    freeze_stage6_now(monkeypatch, datetime(2026, 2, 1, 12, 0, 0))

    result = year_rotation.migrate_legacy_database(now=datetime(2026, 2, 1, 12, 0, 0))
    assert result["status"] == "error"
    assert result["code"] == "migration_target_exists"
    assert legacy_path.is_file()

    runbook = _read(DEPLOY_RUNBOOK)
    assert "migration_target_exists" in runbook
    assert "не тронут" in runbook.lower()