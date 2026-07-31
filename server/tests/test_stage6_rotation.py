"""Backend integration coverage for stage-6 year rotation (UC-02 / TF-02..TF-05)."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

import persistence
import sqlite_store
import year_rotation
from stage6_fixtures import (
    age_stage6_lock,
    build_stage6_active_year_db,
    corrupt_tmp_database,
    freeze_stage6_now,
)


def _seed_session(api_client, *, role: str = "user") -> None:
    """Persist operator session used by rotation auth checks."""
    session_payload = json.dumps(
        {
            "user": {"id": "u-rot", "username": "operator"},
            "profile": {
                "username": "operator",
                "display_name": "Оператор",
                "role": role,
            },
        },
        ensure_ascii=False,
    )
    response = api_client.post("/api/database", json={"data": {"app_current_user": session_payload}})
    assert response.status_code == 200


def _restore_session_direct(source_db: Path, *, role: str = "user") -> None:
    """
    Restore app_sessions directly when rotation lock blocks /api/database writes.

    Commit clears sessions before backup; fail/retry must re-auth without write-gate.
    """
    session_payload = json.dumps(
        {
            "user": {"id": "u-rot", "username": "operator"},
            "profile": {
                "username": "operator",
                "display_name": "Оператор",
                "role": role,
            },
        },
        ensure_ascii=False,
    )
    with sqlite3.connect(source_db) as connection:
        connection.execute("DELETE FROM app_sessions")
        connection.execute(
            "INSERT INTO app_sessions (id, payload) VALUES (1, ?)",
            (session_payload,),
        )
        connection.commit()


def _prepare_rotation_source(temp_stage6_root, monkeypatch, *, source_year: int = 2025):
    """Build rotation-source fixture and freeze calendar into the next year."""
    paths = temp_stage6_root(config_overrides={"tara_default": "900", "active_year": source_year})
    bd = Path(paths["bd_dir"])
    source_db = bd / f"weighing-{source_year}.db"
    build_stage6_active_year_db(source_db)
    persistence.write_active_year(source_year)
    freeze_stage6_now(monkeypatch, datetime(source_year + 1, 1, 1, 10, 0, 0))
    return paths, source_db


def _count_auto_close_audit(source_db: Path) -> int:
    with sqlite3.connect(source_db) as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS c FROM ticket_audit WHERE event_type = 'auto_close'"
        ).fetchone()
    return int(row[0])


def test_tf02_rotation_preview_commit_via_api(api_client, temp_stage6_root, monkeypatch):
    """TC-E2E-02 / TF-02: preview candidates then commit with backup and empty journal."""
    paths, source_db = _prepare_rotation_source(temp_stage6_root, monkeypatch)
    _seed_session(api_client)

    preview_response = api_client.post("/api/year/rotation/preview", json={})
    assert preview_response.status_code == 200
    preview = preview_response.get_json()
    assert preview["source_year"] == 2025
    assert preview["target_year"] == 2026
    assert preview["pending_reo_count"] == 1
    assert len(preview["open_candidates"]) == 2
    tare_sources = {item["ticket_id"]: item["tare_source"] for item in preview["open_candidates"]}
    assert tare_sources["t-dictionary"] == "dictionary"
    assert tare_sources["t-default"] == "default"
    assert preview["blocking_tickets"] == []
    assert _count_auto_close_audit(source_db) == 0

    commit_response = api_client.post(
        "/api/year/rotation/commit",
        json={
            "source_year": preview["source_year"],
            "target_year": preview["target_year"],
            "preview_token": preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert commit_response.status_code == 200
    commit = commit_response.get_json()
    assert commit["success"] is True
    assert commit["auto_closed_count"] == 2
    assert Path(commit["backup_path"]).is_file()
    assert Path(commit["new_db_path"]).is_file()
    assert persistence.read_active_year() == 2026
    assert persistence.read_rotation_lock() is None

    with sqlite3.connect(source_db) as connection:
        connection.row_factory = sqlite3.Row
        closed = connection.execute(
            "SELECT COUNT(*) AS c FROM weighing_tickets WHERE auto_closed = 1"
        ).fetchone()["c"]
        sessions = connection.execute("SELECT COUNT(*) AS c FROM app_sessions").fetchone()["c"]
    assert closed == 2
    assert _count_auto_close_audit(source_db) == 2
    assert sessions == 0

    with sqlite3.connect(commit["new_db_path"]) as connection:
        connection.row_factory = sqlite3.Row
        assert sqlite_store._table_count(connection, "weighing_tickets") == 0
        assert sqlite_store._table_count(connection, "ticket_audit") == 0
        assert sqlite_store._table_count(connection, "scale_switch_journal") == 0
        sqlite_store.assert_no_forbidden_runtime_keys(connection)


def test_tf04_rotation_fail_retry_after_backup(api_client, temp_stage6_root, monkeypatch):
    """TC-E2E-04 / TF-04: fail after backup, then retry without double auto-close."""
    paths, source_db = _prepare_rotation_source(temp_stage6_root, monkeypatch)
    _seed_session(api_client)

    preview = api_client.post("/api/year/rotation/preview", json={}).get_json()

    def _fail_after_backup(**_ctx):
        raise RuntimeError("injected failure after backup")

    year_rotation.set_rotation_test_hook("after_backup", _fail_after_backup)
    failed = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert failed.status_code == 500
    assert failed.get_json()["code"] == "rotation_failed"
    assert persistence.read_active_year() == 2025
    assert _count_auto_close_audit(source_db) == 2
    assert persistence.read_rotation_lock() is not None

    year_rotation.clear_rotation_test_hooks()
    age_stage6_lock(paths["lock_path"], minutes=20, now=datetime(2026, 1, 1, 10, 0, 0))
    _restore_session_direct(source_db)

    retry_preview_response = api_client.post("/api/year/rotation/preview", json={})
    assert retry_preview_response.status_code == 200
    retry_preview = retry_preview_response.get_json()
    assert retry_preview["open_candidates"] == []
    retry = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": retry_preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert retry.status_code == 200
    assert retry.get_json()["success"] is True
    assert persistence.read_active_year() == 2026
    assert _count_auto_close_audit(source_db) == 2
    assert Path(retry.get_json()["new_db_path"]).is_file()


def test_tf04_rotation_fail_retry_after_tmp(api_client, temp_stage6_root, monkeypatch):
    """TF-04 variant: fail after .tmp ready, corrupt tmp, rebuild on retry."""
    paths, source_db = _prepare_rotation_source(temp_stage6_root, monkeypatch)
    _seed_session(api_client)
    preview = api_client.post("/api/year/rotation/preview", json={}).get_json()
    tmp_path = Path(paths["bd_dir"]) / "weighing-2026.db.tmp"

    def _fail_after_tmp(**ctx):
        corrupt_tmp_database(ctx["tmp_db_path"])
        raise RuntimeError("injected failure after tmp")

    year_rotation.set_rotation_test_hook("after_tmp_ready", _fail_after_tmp)
    failed = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert failed.status_code == 500
    assert persistence.read_active_year() == 2025
    assert tmp_path.exists()
    assert _count_auto_close_audit(source_db) == 2

    year_rotation.clear_rotation_test_hooks()
    age_stage6_lock(paths["lock_path"], minutes=20, now=datetime(2026, 1, 1, 10, 0, 0))
    _restore_session_direct(source_db)
    retry_preview = api_client.post("/api/year/rotation/preview", json={}).get_json()
    retry = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": retry_preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert retry.status_code == 200
    assert persistence.read_active_year() == 2026
    assert _count_auto_close_audit(source_db) == 2
    assert not tmp_path.exists()


def test_tf05_parallel_rotation_second_session_conflict(api_client, temp_stage6_root, monkeypatch):
    """TC-E2E-05 / TF-05: second parallel commit receives 409 rotation_in_progress."""
    _prepare_rotation_source(temp_stage6_root, monkeypatch)
    _seed_session(api_client)
    preview = api_client.post("/api/year/rotation/preview", json={}).get_json()

    lock_held = threading.Event()
    proceed = threading.Event()
    first_result: dict[str, object] = {}

    def _hold_lock(**_ctx):
        lock_held.set()
        proceed.wait(timeout=15)

    year_rotation.set_rotation_test_hook("after_lock_acquired", _hold_lock)

    def _first_commit():
        response = api_client.post(
            "/api/year/rotation/commit",
            json={
                "preview_token": preview["preview_token"],
                "acknowledge_pending_reo": True,
            },
        )
        first_result["status"] = response.status_code
        first_result["body"] = response.get_json()

    worker = threading.Thread(target=_first_commit, daemon=True)
    worker.start()
    assert lock_held.wait(timeout=15)

    second = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert second.status_code == 409
    assert second.get_json()["code"] == "rotation_in_progress"

    proceed.set()
    worker.join(timeout=30)
    assert first_result.get("status") == 200
    assert first_result["body"]["success"] is True
    assert persistence.read_active_year() == 2026


def test_deny_by_default_runtime_keys_block_publish(api_client, temp_stage6_root, monkeypatch):
    """TC-E2E-06: extra app_* runtime/session rows make target invalid and block publish."""
    paths = temp_stage6_root(config_overrides={"tara_default": "900", "active_year": 2025})
    source_db = Path(paths["bd_dir"]) / "weighing-2025.db"
    build_stage6_active_year_db(
        source_db,
        extra_app_tables={
            "app_ephemeral_cache": [("cache-1", '{"token":"x"}')],
        },
    )
    persistence.write_active_year(2025)
    freeze_stage6_now(monkeypatch, datetime(2026, 1, 1, 10, 0, 0))
    _seed_session(api_client)

    preview = api_client.post("/api/year/rotation/preview", json={}).get_json()

    def _inject_forbidden(**ctx):
        target_conn = ctx["target_conn"]
        target_conn.execute(
            "CREATE TABLE IF NOT EXISTS app_ephemeral_cache (id TEXT PRIMARY KEY, payload TEXT)"
        )
        target_conn.execute(
            "INSERT INTO app_ephemeral_cache (id, payload) VALUES (?, ?)",
            ("cache-1", '{"token":"x"}'),
        )

    year_rotation.set_rotation_test_hook("after_whitelist_copy", _inject_forbidden)
    failed = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert failed.status_code == 500
    assert failed.get_json()["code"] == "rotation_failed"
    assert persistence.read_active_year() == 2025
    assert not (Path(paths["bd_dir"]) / "weighing-2026.db").exists()


def test_rotation_preview_token_stale(api_client, temp_stage6_root, monkeypatch):
    """TC-UNIT-02: stale preview_token returns 409 without switching active_year."""
    _prepare_rotation_source(temp_stage6_root, monkeypatch)
    _seed_session(api_client)

    preview = api_client.post("/api/year/rotation/preview", json={}).get_json()
    stale = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": "rotprev_stale_token",
            "acknowledge_pending_reo": True,
        },
    )
    assert stale.status_code == 409
    assert stale.get_json()["code"] == "rotation_preview_stale"
    assert persistence.read_active_year() == 2025

    # Valid token from the same preview still works afterwards.
    ok = api_client.post(
        "/api/year/rotation/commit",
        json={
            "preview_token": preview["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    assert ok.status_code == 200
    assert persistence.read_active_year() == 2026
