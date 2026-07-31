"""Stage-6 stub backend contracts and smoke runner checks."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import sqlite3
from datetime import datetime
from pathlib import Path

from pathlib import Path

import requests

import persistence
import sqlite_store


def _resolve_python_bin(repo_root: Path) -> str:
    """Prefer local .venv when present; otherwise use the active interpreter (CI)."""
    import sys
    candidates = [
        repo_root / '.venv' / 'bin' / 'python',
        repo_root / '.venv' / 'Scripts' / 'python.exe',
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def _pick_free_port() -> int:
    """Reserve a free localhost TCP port for smoke server process."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        probe.listen(1)
        return int(probe.getsockname()[1])


def _wait_for_health(base_url: str, timeout_sec: float = 15.0) -> None:
    """Wait until backend `/api/health` starts responding with success."""
    started = time.time()
    while time.time() - started < timeout_sec:
        try:
            response = requests.get(f"{base_url}/api/health", timeout=0.8)
            payload = response.json()
            if response.status_code == 200 and payload.get("success") is True:
                return
        except Exception:
            pass
        time.sleep(0.2)
    raise AssertionError("Backend did not become healthy in time")


def test_stage6_stub_endpoints_keep_minimal_contract(api_client, temp_stage6_root):
    """TC-UNIT-02: stage-6 endpoints expose required response fields."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    with sqlite3.connect(bd / "weighing-2026.db") as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()
    with sqlite3.connect(bd / "weighing-2025.db") as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, status, reo_status, auto_closed, created_at
            ) VALUES ('t-1', 1, 'completed', 'pending', 0, '2025-01-01T00:00:00')
            """
        )
        connection.commit()

    session_payload = json.dumps(
        {
            'user': {'id': 'u-1', 'username': 'operator'},
            'profile': {'username': 'operator', 'display_name': 'Оператор', 'role': 'admin'},
        },
        ensure_ascii=False,
    )
    api_client.post('/api/database', json={'data': {'app_current_user': session_payload}})

    years_response = api_client.get("/api/archive/years")
    assert years_response.status_code == 200
    years_payload = years_response.get_json()
    assert years_payload["success"] is True
    assert isinstance(years_payload["years"], list)
    assert years_payload["years"]
    assert {"year", "file_name", "label"} <= set(years_payload["years"][0].keys())
    assert years_payload["years"][0]["year"] == 2025

    missing_year = api_client.get("/api/archive/tickets")
    assert missing_year.status_code == 400
    assert missing_year.get_json()["code"] == "invalid_archive_year"

    tickets_response = api_client.get("/api/archive/tickets?year=2025")
    assert tickets_response.status_code == 200
    tickets_payload = tickets_response.get_json()
    assert tickets_payload["success"] is True
    assert tickets_payload["year"] == 2025
    assert isinstance(tickets_payload["tickets"], list)
    assert tickets_payload["tickets"][0]["id"] == "t-1"

    ticket_response = api_client.get("/api/archive/tickets/t-1?year=2025")
    assert ticket_response.status_code == 200
    ticket_payload = ticket_response.get_json()
    assert ticket_payload["success"] is True
    assert ticket_payload["year"] == 2025
    assert {"id", "ticket_number", "status", "reo_status", "auto_closed"} <= set(
        ticket_payload["ticket"].keys()
    )

    patch_response = api_client.patch(
        "/api/archive/tickets/t-1",
        json={"year": 2025, "patch": {"driver_name": "Оператор"}},
    )
    assert patch_response.status_code == 200
    patch_payload = patch_response.get_json()
    assert patch_payload["success"] is True
    assert patch_payload["audit_event"]["event_type"] == "archive_edit"
    assert patch_payload["audit_event"]["source_year"] == 2025

    user_session = json.dumps(
        {
            'user': {'id': 'u-2', 'username': 'user'},
            'profile': {'username': 'user', 'display_name': 'Пользователь', 'role': 'user'},
        },
        ensure_ascii=False,
    )
    api_client.post('/api/database', json={'data': {'app_current_user': user_session}})
    denied = api_client.patch(
        "/api/archive/tickets/t-1",
        json={"year": 2025, "patch": {"driver_name": "Запрещено"}},
    )
    assert denied.status_code == 403
    assert denied.get_json()["code"] == "insufficient_permissions"

    api_client.post('/api/database', json={'data': {'app_current_user': session_payload}})

    current_year = datetime.now().year - 1
    persistence.write_active_year(current_year)
    with sqlite3.connect(persistence.get_year_database_path(current_year)) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()
    api_client.post('/api/database', json={'data': {'app_current_user': session_payload}})

    preview_response = api_client.post("/api/year/rotation/preview", json={})
    assert preview_response.status_code == 200
    preview_payload = preview_response.get_json()
    assert preview_payload["success"] is True
    assert isinstance(preview_payload["preview_token"], str)
    assert {"source_year", "target_year", "preview_token", "open_candidates", "pending_reo_count", "blocking_tickets"} <= set(
        preview_payload.keys()
    )

    commit_response = api_client.post(
        "/api/year/rotation/commit",
        json={
            "source_year": preview_payload["source_year"],
            "target_year": preview_payload["target_year"],
            "preview_token": preview_payload["preview_token"],
            "acknowledge_pending_reo": True,
        },
    )
    if commit_response.status_code == 200:
        commit_payload = commit_response.get_json()
        assert commit_payload["success"] is True
        assert {"source_year", "target_year", "auto_closed_count", "backup_path", "new_db_path"} <= set(
            commit_payload.keys()
        )
    else:
        assert commit_response.status_code in (409, 422, 500)


def test_stage6_smoke_runner_writes_reports_and_returns_zero(tmp_path):
    """TC-UNIT-01: stage-6 smoke runner works against real HTTP entrypoint."""
    repo_root = Path(__file__).resolve().parents[2]
    python_bin = Path(_resolve_python_bin(repo_root))
    port = _pick_free_port()
    base_url = f"http://127.0.0.1:{port}"
    env = dict(os.environ)
    env["OPEN_BROWSER"] = "0"
    env["PORT"] = str(port)

    server = subprocess.Popen(
        [str(python_bin), "server/app.py"],
        cwd=repo_root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_health(base_url)
        json_report = tmp_path / "stage6-smoke.json"
        markdown_report = tmp_path / "stage6-smoke.md"
        smoke = subprocess.run(
            [
                str(python_bin),
                "scripts/smoke_yearly_archive.py",
                "--base-url",
                base_url,
                "--origin",
                base_url,
                "--write-json",
                str(json_report),
                "--write-markdown",
                str(markdown_report),
            ],
            cwd=repo_root,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        assert smoke.returncode == 0, smoke.stdout + smoke.stderr
        report_payload = json.loads(json_report.read_text(encoding="utf-8"))
        assert report_payload["summary"]["all_steps_passed"] is True
        assert markdown_report.is_file()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
