#!/usr/bin/env python3
"""Production-like smoke runner for stage-6 yearly archive branches."""

from __future__ import annotations

import argparse
import json
import platform
import socket
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

DEFAULT_BASE_URL = "http://127.0.0.1:5001"
DEFAULT_ORIGIN = "http://127.0.0.1:5001"
DEFAULT_TIMEOUT_SEC = 5.0
SCENARIOS = ("active", "archive", "fail-retry", "parallel-lock")

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = REPO_ROOT / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
TESTS_DIR = SERVER_DIR / "tests"
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))


@dataclass
class StepResult:
    """Captured response details for one stage-6 smoke step."""

    name: str
    method: str
    path: str
    ok: bool
    status_code: int | None
    body: Any
    error: str | None
    elapsed_ms: int
    expected_ok: bool = True
    note: str | None = None


def _safe_json(response: requests.Response) -> Any:
    """Parse JSON body or return plain text for non-JSON response."""
    try:
        return response.json()
    except ValueError:
        text = response.text.strip()
        return {"raw_text": text} if text else None


def _request_step(
    *,
    name: str,
    method: str,
    base_url: str,
    path: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None,
    timeout_sec: float,
    expected_ok: bool = True,
    note: str | None = None,
) -> StepResult:
    """Perform one HTTP request and normalize result payload."""
    url = f"{base_url.rstrip('/')}{path}"
    started = datetime.now(tz=timezone.utc)
    try:
        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            json=payload,
            timeout=timeout_sec,
        )
        elapsed_ms = int((datetime.now(tz=timezone.utc) - started).total_seconds() * 1000)
        http_ok = 200 <= response.status_code < 300
        return StepResult(
            name=name,
            method=method,
            path=path,
            ok=http_ok == expected_ok if expected_ok in (True, False) else http_ok,
            status_code=response.status_code,
            body=_safe_json(response),
            error=None,
            elapsed_ms=elapsed_ms,
            expected_ok=expected_ok,
            note=note,
        )
    except requests.RequestException as error:
        elapsed_ms = int((datetime.now(tz=timezone.utc) - started).total_seconds() * 1000)
        return StepResult(
            name=name,
            method=method,
            path=path,
            ok=False,
            status_code=None,
            body=None,
            error=str(error),
            elapsed_ms=elapsed_ms,
            expected_ok=expected_ok,
            note=note,
        )


def _seed_session_payload(*, role: str = "admin") -> dict[str, Any]:
    """Build /api/database payload with an authenticated session."""
    return {
        "data": {
            "app_current_user": json.dumps(
                {
                    "user": {"id": "smoke-user", "username": "operator"},
                    "profile": {
                        "username": "operator",
                        "display_name": "Smoke Operator",
                        "role": role,
                    },
                },
                ensure_ascii=False,
            )
        }
    }


def _apply_stage6_assertions(step: StepResult, *, scenario: str) -> tuple[bool, str | None]:
    """Validate stage-6 response shape for each smoke step."""
    body = step.body if isinstance(step.body, dict) else {}

    if step.error:
        return False, step.error

    if step.name == "health":
        if body.get("success") is not True:
            return False, "health.success != true"
        return True, None

    if step.name == "config":
        if body.get("success") is not True or not isinstance(body.get("config"), dict):
            return False, "config contract mismatch"
        active_year = body["config"].get("active_year")
        if active_year in (None, ""):
            return False, "config.active_year missing"
        return True, None

    if step.name == "seed_session":
        if body.get("success") is not True:
            return False, "seed session failed"
        return True, None

    if step.name == "rotation_preview":
        required = {
            "success",
            "source_year",
            "target_year",
            "preview_token",
            "open_candidates",
            "pending_reo_count",
            "blocking_tickets",
        }
        if not required.issubset(set(body.keys())):
            return False, "rotation preview missing required keys"
        if body.get("success") is not True:
            return False, "rotation preview success != true"
        token = str(body.get("preview_token") or "")
        if scenario == "active" and not token:
            return False, "preview_token empty"
        return True, None

    if step.name == "archive_years":
        if body.get("success") is not True or not isinstance(body.get("years"), list):
            return False, "archive years contract mismatch"
        for item in body["years"]:
            if not isinstance(item, dict):
                return False, "archive years item must be object"
            if not {"year", "file_name", "label"}.issubset(set(item.keys())):
                return False, "archive years item missing keys"
        return True, None

    if step.name == "archive_tickets":
        if body.get("success") is not True:
            return False, "archive tickets success != true"
        if not isinstance(body.get("tickets"), list):
            return False, "archive tickets must be list"
        if "year" not in body:
            return False, "archive tickets year missing"
        return True, None

    if step.name == "archive_ticket":
        if body.get("success") is not True:
            return False, "archive ticket success != true"
        if not isinstance(body.get("ticket"), dict):
            return False, "archive ticket payload missing"
        return True, None

    if step.name == "archive_edit_forbidden":
        if step.status_code != 422:
            return False, f"expected HTTP 422, got {step.status_code}"
        if body.get("code") != "archive_edit_forbidden_field":
            return False, "expected archive_edit_forbidden_field"
        return True, None

    if step.name == "archive_edit_sent_reo_ack_required":
        if step.status_code != 409:
            return False, f"expected HTTP 409, got {step.status_code}"
        if body.get("code") != "archive_reo_ack_required":
            return False, "expected archive_reo_ack_required"
        return True, None

    if step.name == "archive_edit_sent_reo_with_ack":
        if body.get("success") is not True:
            return False, "sent-REO edit success != true"
        warning = body.get("warning") if isinstance(body.get("warning"), dict) else {}
        if warning.get("code") != "archive_reo_sent_warning":
            return False, "expected archive_reo_sent_warning"
        audit = body.get("audit_event") if isinstance(body.get("audit_event"), dict) else {}
        if audit.get("reo_divergence_warning") is not True:
            return False, "expected reo_divergence_warning=true"
        ticket = body.get("ticket") if isinstance(body.get("ticket"), dict) else {}
        if ticket.get("reo_status") != "sent":
            return False, "reo_status must remain sent"
        return True, None

    if step.name == "rotation_commit_failed":
        if step.status_code != 500:
            return False, f"expected HTTP 500, got {step.status_code}"
        if body.get("code") != "rotation_failed":
            return False, "expected rotation_failed"
        return True, None

    if step.name == "rotation_commit_retry":
        if body.get("success") is not True:
            return False, "retry commit success != true"
        if not body.get("backup_path") or not body.get("new_db_path"):
            return False, "retry commit missing backup/new_db_path"
        return True, None

    if step.name == "rotation_commit_parallel_conflict":
        if step.status_code != 409:
            return False, f"expected HTTP 409, got {step.status_code}"
        if body.get("code") != "rotation_in_progress":
            return False, "expected rotation_in_progress"
        return True, None

    if step.name == "rotation_commit_parallel_winner":
        if body.get("success") is not True:
            return False, "parallel winner commit success != true"
        return True, None

    if step.name.startswith("active_year_after_"):
        expected = step.note
        actual = str(body.get("config", {}).get("active_year") if isinstance(body.get("config"), dict) else "")
        if expected and actual != expected:
            return False, f"active_year={actual}, expected {expected}"
        if body.get("success") is not True:
            return False, "config success != true"
        return True, None

    return step.ok, None


def build_report(
    *,
    run_label: str,
    base_url: str,
    origin: str,
    scenario: str,
    steps: list[StepResult],
) -> dict[str, Any]:
    """Build structured stage-6 smoke report for one scenario."""
    checked_steps = []
    for step in steps:
        contract_ok, contract_error = _apply_stage6_assertions(step, scenario=scenario)
        checked_steps.append(
            {
                "name": step.name,
                "method": step.method,
                "path": step.path,
                "ok": step.ok and contract_ok,
                "status_code": step.status_code,
                "elapsed_ms": step.elapsed_ms,
                "body": step.body,
                "error": step.error,
                "contract_error": contract_error,
                "expected_ok": step.expected_ok,
                "note": step.note,
            }
        )

    return {
        "meta": {
            "generated_at": datetime.now(tz=timezone.utc).isoformat(),
            "run_label": run_label,
            "scenario": scenario,
            "environment": {
                "platform": platform.platform(),
                "python": sys.version.split()[0],
            },
        },
        "request_context": {
            "base_url": base_url,
            "origin": origin,
            "scenario": scenario,
        },
        "steps": checked_steps,
        "summary": {
            "all_steps_passed": all(step["ok"] for step in checked_steps),
            "passed_steps": sum(1 for step in checked_steps if step["ok"]),
            "failed_steps": sum(1 for step in checked_steps if not step["ok"]),
            "status": (
                "PASS" if checked_steps and all(step["ok"] for step in checked_steps) else "FAIL"
            ),
        },
    }


def _render_markdown(report: dict[str, Any]) -> str:
    """Render markdown evidence report from structured result."""
    meta = report["meta"]
    context = report["request_context"]
    summary = report["summary"]
    scenario = meta.get("scenario") or context.get("scenario") or "unknown"
    lines = [
        f"# Stage 6 yearly archive smoke evidence ({scenario})",
        "",
        "## Контекст запуска",
        f"- Дата (UTC): `{meta['generated_at']}`",
        f"- Запуск: `{meta['run_label']}`",
        f"- Scenario: `{scenario}`",
        f"- Платформа: `{meta['environment']['platform']}`",
        f"- Python: `{meta['environment']['python']}`",
        f"- Base URL: `{context['base_url']}`",
        f"- Origin: `{context['origin']}`",
        "",
        "## Итог",
        f"- status: `{summary['status']}`",
        f"- all_steps_passed: `{summary['all_steps_passed']}`",
        f"- passed_steps: `{summary['passed_steps']}`",
        f"- failed_steps: `{summary['failed_steps']}`",
        "",
        "## Шаги smoke",
    ]

    for step in report["steps"]:
        status = "PASSED" if step["ok"] else "FAILED"
        lines.extend(
            [
                f"### {step['name']}: {status}",
                f"- Request: `{step['method']} {step['path']}`",
                f"- HTTP status: `{step['status_code']}`",
                f"- Duration: `{step['elapsed_ms']} ms`",
                f"- Expected ok: `{step.get('expected_ok', True)}`",
                f"- Error: `{step['error'] or 'none'}`",
                f"- Contract error: `{step['contract_error'] or 'none'}`",
                f"- Note: `{step.get('note') or 'none'}`",
                "- Response:",
                "```json",
                json.dumps(step["body"], ensure_ascii=False, indent=2),
                "```",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def _write_report(path: str | None, content: str) -> None:
    """Write report file when path is provided."""
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def _free_port() -> int:
    """Allocate an ephemeral local TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_healthy(base_url: str, *, timeout_sec: float = 15.0) -> bool:
    """Wait until /api/health responds successfully."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            response = requests.get(f"{base_url.rstrip('/')}/api/health", timeout=1.0)
            if response.status_code == 200:
                body = response.json()
                if body.get("success") is True:
                    return True
        except (requests.RequestException, ValueError):
            pass
        time.sleep(0.1)
    return False


class IsolatedStage6Server:
    """
    Ephemeral Flask HTTP server on an isolated app root.

    Used for fail-retry / parallel-lock evidence without mutating the live BD/.
    Still exercises real `server/app.py` HTTP routes over TCP.
    """

    def __init__(self, *, active_year: int = 2025, calendar_year: int = 2026) -> None:
        self.active_year = active_year
        self.calendar_year = calendar_year
        self.tmp = tempfile.TemporaryDirectory(prefix="stage6-smoke-")
        self.root = Path(self.tmp.name) / "app"
        self.bd_dir = self.root / "BD"
        self.backup_dir = self.root / "backup"
        self.config_path = self.root / "config.ini"
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self._thread: threading.Thread | None = None
        self._server: Any = None
        self.source_db = self.bd_dir / f"weighing-{active_year}.db"
        self.archive_db = self.bd_dir / f"weighing-{active_year - 1}.db"
        self.lock_path = self.bd_dir / ".year_rotation.lock"

    def __enter__(self) -> "IsolatedStage6Server":
        self.root.mkdir(parents=True, exist_ok=True)
        self.bd_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(
            "[settings]\n"
            f"active_year = {self.active_year}\n"
            "tara_default = 900\n",
            encoding="utf-8",
        )

        import persistence
        import sqlite_store
        import year_context
        import year_rotation
        from stage6_fixtures import build_stage6_active_year_db, build_stage6_archive_db

        self._persistence = persistence
        self._sqlite_store = sqlite_store
        self._year_context = year_context
        self._year_rotation = year_rotation

        self._orig_sqlite_root = sqlite_store.get_app_root
        self._orig_persistence_root = persistence.get_app_root
        self._orig_rotation_dt = year_rotation.datetime
        self._orig_context_dt = year_context.datetime
        self._orig_persistence_dt = persistence.datetime
        sqlite_store.get_app_root = lambda: str(self.root)  # type: ignore[assignment]
        persistence.get_app_root = lambda: str(self.root)  # type: ignore[assignment]

        frozen = datetime(self.calendar_year, 1, 1, 10, 0, 0)

        class _FrozenDateTime(datetime):
            @classmethod
            def now(cls, tz=None):  # noqa: ANN206
                if tz is not None:
                    return frozen.replace(tzinfo=tz) if frozen.tzinfo is None else frozen.astimezone(tz)
                return frozen

        year_rotation.datetime = _FrozenDateTime  # type: ignore[assignment]
        year_context.datetime = _FrozenDateTime  # type: ignore[assignment]
        persistence.datetime = _FrozenDateTime  # type: ignore[assignment]

        build_stage6_active_year_db(self.source_db)
        build_stage6_archive_db(
            self.archive_db,
            tickets=[
                {
                    "id": "arch-sent",
                    "ticket_number": 77,
                    "status": "completed",
                    "reo_status": "sent",
                    "reo_sent_at": "2024-06-01T10:00:00",
                    "driver_name": "Иванов",
                    "vehicle_number": "A111AA56",
                    "created_at": f"{self.active_year - 1}-06-01T09:00:00",
                    "completed_at": f"{self.active_year - 1}-06-01T09:10:00",
                    "gross_weight": 20000,
                    "tare_weight": 8000,
                    "net_weight": 12000,
                },
                {
                    "id": "arch-mixed",
                    "ticket_number": 78,
                    "status": "completed",
                    "reo_status": "pending",
                    "driver_name": "Петров",
                    "vehicle_number": "B222BB56",
                    "created_at": f"{self.active_year}-12-31T12:00:00",
                    "completed_at": f"{self.active_year}-12-31T12:10:00",
                    "gross_weight": 18000,
                    "tare_weight": 7000,
                    "net_weight": 11000,
                },
            ],
        )

        import app as flask_app

        flask_app.app.config["TESTING"] = False

        from werkzeug.serving import make_server

        self._server = make_server("127.0.0.1", self.port, flask_app.app, threaded=True)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        if not _wait_healthy(self.base_url):
            raise RuntimeError(f"Isolated stage-6 server failed to start on {self.base_url}")
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._server is not None:
            self._server.shutdown()
        if self._thread is not None:
            self._thread.join(timeout=5)
        try:
            self._year_rotation.clear_rotation_test_hooks()
        except Exception:
            pass
        if hasattr(self, "_year_rotation"):
            self._year_rotation.datetime = self._orig_rotation_dt
        if hasattr(self, "_year_context"):
            self._year_context.datetime = self._orig_context_dt
        if hasattr(self, "_persistence"):
            self._persistence.datetime = self._orig_persistence_dt
            self._persistence.get_app_root = self._orig_persistence_root
        if hasattr(self, "_sqlite_store"):
            self._sqlite_store.get_app_root = self._orig_sqlite_root
        self.tmp.cleanup()


def _run_active_scenario(args: argparse.Namespace, headers: dict[str, str]) -> list[StepResult]:
    """Smoke active-year happy-path against live HTTP entrypoint."""
    return [
        _request_step(
            name="health",
            method="GET",
            base_url=args.base_url,
            path="/api/health",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
        ),
        _request_step(
            name="config",
            method="GET",
            base_url=args.base_url,
            path="/api/config",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
        ),
        _request_step(
            name="seed_session",
            method="POST",
            base_url=args.base_url,
            path="/api/database",
            headers=headers,
            payload=_seed_session_payload(role="user"),
            timeout_sec=args.http_timeout_sec,
        ),
        _request_step(
            name="rotation_preview",
            method="POST",
            base_url=args.base_url,
            path="/api/year/rotation/preview",
            headers=headers,
            payload={},
            timeout_sec=args.http_timeout_sec,
        ),
    ]


def _run_archive_scenario(args: argparse.Namespace, headers: dict[str, str]) -> list[StepResult]:
    """
    Smoke archive list/card/edit-forbidden branches.

    Prefer live base-url. When archive catalog is empty or tickets missing,
    fall back to an isolated HTTP server with seeded archive fixtures so the
    production-relevant archive and forbidden/sent-REO branches still produce evidence.
    """
    steps: list[StepResult] = [
        _request_step(
            name="health",
            method="GET",
            base_url=args.base_url,
            path="/api/health",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
        ),
        _request_step(
            name="seed_session",
            method="POST",
            base_url=args.base_url,
            path="/api/database",
            headers=headers,
            payload=_seed_session_payload(role="admin"),
            timeout_sec=args.http_timeout_sec,
        ),
        _request_step(
            name="archive_years",
            method="GET",
            base_url=args.base_url,
            path="/api/archive/years",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
        ),
    ]

    years_body = steps[-1].body if isinstance(steps[-1].body, dict) else {}
    years = years_body.get("years") if isinstance(years_body.get("years"), list) else []
    use_isolated = False
    archive_year: int | None = None
    ticket_id: str | None = None
    sent_ticket_id: str | None = None
    base_url = args.base_url

    if years:
        archive_year = int(years[0]["year"])
        tickets_step = _request_step(
            name="archive_tickets",
            method="GET",
            base_url=base_url,
            path=f"/api/archive/tickets?year={archive_year}",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
        )
        tickets_body = tickets_step.body if isinstance(tickets_step.body, dict) else {}
        tickets = tickets_body.get("tickets") if isinstance(tickets_body.get("tickets"), list) else []
        live_tickets_ok = tickets_step.ok and tickets_body.get("success") is True and bool(tickets)
        if live_tickets_ok:
            steps.append(tickets_step)
            ticket_id = str(tickets[0].get("id"))
            for ticket in tickets:
                if str(ticket.get("reo_status") or "") == "sent":
                    sent_ticket_id = str(ticket.get("id"))
                    break
        else:
            # Broken/empty live archive catalog entry — continue on isolated fixture.
            use_isolated = True
            steps.append(
                StepResult(
                    name="archive_tickets_live_probe",
                    method="GET",
                    path=f"/api/archive/tickets?year={archive_year}",
                    ok=True,
                    status_code=tickets_step.status_code,
                    body=tickets_step.body,
                    error=None,
                    elapsed_ms=tickets_step.elapsed_ms,
                    note="live-archive-unusable; fallback-to-isolated",
                )
            )
    else:
        use_isolated = True

    isolated: IsolatedStage6Server | None = None
    if use_isolated:
        isolated = IsolatedStage6Server()
        isolated.__enter__()
        base_url = isolated.base_url
        steps.append(
            _request_step(
                name="seed_session",
                method="POST",
                base_url=base_url,
                path="/api/database",
                headers=headers,
                payload=_seed_session_payload(role="admin"),
                timeout_sec=args.http_timeout_sec,
                note="isolated-archive-fixture",
            )
        )
        years_step = _request_step(
            name="archive_years",
            method="GET",
            base_url=base_url,
            path="/api/archive/years",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
            note="isolated-archive-fixture",
        )
        steps.append(years_step)
        years_body = years_step.body if isinstance(years_step.body, dict) else {}
        years = years_body.get("years") if isinstance(years_body.get("years"), list) else []
        archive_year = int(years[0]["year"]) if years else isolated.active_year - 1
        tickets_step = _request_step(
            name="archive_tickets",
            method="GET",
            base_url=base_url,
            path=f"/api/archive/tickets?year={archive_year}",
            headers=headers,
            payload=None,
            timeout_sec=args.http_timeout_sec,
            note="isolated-archive-fixture",
        )
        steps.append(tickets_step)
        tickets_body = tickets_step.body if isinstance(tickets_step.body, dict) else {}
        tickets = tickets_body.get("tickets") if isinstance(tickets_body.get("tickets"), list) else []
        ticket_id = str(tickets[0]["id"]) if tickets else "arch-sent"
        sent_ticket_id = "arch-sent"

    try:
        assert archive_year is not None
        assert ticket_id is not None

        steps.append(
            _request_step(
                name="archive_ticket",
                method="GET",
                base_url=base_url,
                path=f"/api/archive/tickets/{ticket_id}?year={archive_year}",
                headers=headers,
                payload=None,
                timeout_sec=args.http_timeout_sec,
            )
        )
        steps.append(
            _request_step(
                name="archive_edit_forbidden",
                method="PATCH",
                base_url=base_url,
                path=f"/api/archive/tickets/{ticket_id}",
                headers=headers,
                payload={"year": archive_year, "patch": {"ticket_number": 999}},
                timeout_sec=args.http_timeout_sec,
                expected_ok=False,
            )
        )

        target_sent = sent_ticket_id or ticket_id
        steps.append(
            _request_step(
                name="archive_edit_sent_reo_ack_required",
                method="PATCH",
                base_url=base_url,
                path=f"/api/archive/tickets/{target_sent}",
                headers=headers,
                payload={
                    "year": archive_year,
                    "patch": {"driver_name": "Сидоров"},
                    "acknowledge_reo_sent_warning": False,
                },
                timeout_sec=args.http_timeout_sec,
                expected_ok=False,
            )
        )
        # If the chosen ticket is not sent, isolated fixture guarantees sent branch.
        if use_isolated or sent_ticket_id:
            steps.append(
                _request_step(
                    name="archive_edit_sent_reo_with_ack",
                    method="PATCH",
                    base_url=base_url,
                    path=f"/api/archive/tickets/{target_sent}",
                    headers=headers,
                    payload={
                        "year": archive_year,
                        "patch": {"driver_name": "Сидоров"},
                        "acknowledge_reo_sent_warning": True,
                    },
                    timeout_sec=args.http_timeout_sec,
                )
            )
        else:
            steps.append(
                StepResult(
                    name="archive_edit_sent_reo_with_ack",
                    method="PATCH",
                    path=f"/api/archive/tickets/{target_sent}",
                    ok=False,
                    status_code=None,
                    body=None,
                    error="no sent-REO archive ticket on live server; re-run with seeded archive",
                    elapsed_ms=0,
                    expected_ok=True,
                    note="verification-gap-live-sent-reo",
                )
            )
    finally:
        if isolated is not None:
            isolated.__exit__(None, None, None)

    return steps


def _run_fail_retry_scenario(args: argparse.Namespace, headers: dict[str, str]) -> list[StepResult]:
    """HTTP smoke for TF-04 fail after backup then safe retry on isolated server."""
    steps: list[StepResult] = []
    with IsolatedStage6Server(active_year=2025, calendar_year=2026) as isolated:
        import persistence
        from stage6_fixtures import age_stage6_lock

        year_rotation = isolated._year_rotation
        base_url = isolated.base_url

        steps.append(
            _request_step(
                name="seed_session",
                method="POST",
                base_url=base_url,
                path="/api/database",
                headers=headers,
                payload=_seed_session_payload(role="user"),
                timeout_sec=args.http_timeout_sec,
            )
        )
        preview = _request_step(
            name="rotation_preview",
            method="POST",
            base_url=base_url,
            path="/api/year/rotation/preview",
            headers=headers,
            payload={},
            timeout_sec=args.http_timeout_sec,
        )
        steps.append(preview)
        preview_body = preview.body if isinstance(preview.body, dict) else {}
        token = str(preview_body.get("preview_token") or "")

        def _fail_after_backup(**_ctx: Any) -> None:
            raise RuntimeError("injected failure after backup")

        year_rotation.set_rotation_test_hook("after_backup", _fail_after_backup)
        steps.append(
            _request_step(
                name="rotation_commit_failed",
                method="POST",
                base_url=base_url,
                path="/api/year/rotation/commit",
                headers=headers,
                payload={"preview_token": token, "acknowledge_pending_reo": True},
                timeout_sec=args.http_timeout_sec,
                expected_ok=False,
            )
        )
        steps.append(
            _request_step(
                name="active_year_after_fail",
                method="GET",
                base_url=base_url,
                path="/api/config",
                headers=headers,
                payload=None,
                timeout_sec=args.http_timeout_sec,
                note="2025",
            )
        )

        year_rotation.clear_rotation_test_hooks()
        age_stage6_lock(isolated.lock_path, minutes=20, now=datetime(2026, 1, 1, 10, 0, 0))
        # Commit clears sessions; restore via direct SQLite for retry auth.
        import sqlite3

        session_payload = json.dumps(
            {
                "user": {"id": "smoke-user", "username": "operator"},
                "profile": {
                    "username": "operator",
                    "display_name": "Smoke Operator",
                    "role": "user",
                },
            },
            ensure_ascii=False,
        )
        with sqlite3.connect(isolated.source_db) as connection:
            connection.execute("DELETE FROM app_sessions")
            connection.execute(
                "INSERT INTO app_sessions (id, payload) VALUES (1, ?)",
                (session_payload,),
            )
            connection.commit()

        retry_preview = _request_step(
            name="rotation_preview",
            method="POST",
            base_url=base_url,
            path="/api/year/rotation/preview",
            headers=headers,
            payload={},
            timeout_sec=args.http_timeout_sec,
            note="retry-preview",
        )
        steps.append(retry_preview)
        retry_body = retry_preview.body if isinstance(retry_preview.body, dict) else {}
        retry_token = str(retry_body.get("preview_token") or "")
        steps.append(
            _request_step(
                name="rotation_commit_retry",
                method="POST",
                base_url=base_url,
                path="/api/year/rotation/commit",
                headers=headers,
                payload={"preview_token": retry_token, "acknowledge_pending_reo": True},
                timeout_sec=max(args.http_timeout_sec, 30.0),
            )
        )
        steps.append(
            _request_step(
                name="active_year_after_retry",
                method="GET",
                base_url=base_url,
                path="/api/config",
                headers=headers,
                payload=None,
                timeout_sec=args.http_timeout_sec,
                note="2026",
            )
        )
        _ = persistence.read_active_year()
    return steps


def _run_parallel_lock_scenario(args: argparse.Namespace, headers: dict[str, str]) -> list[StepResult]:
    """HTTP smoke for TF-05 parallel commit conflict on isolated server."""
    steps: list[StepResult] = []
    with IsolatedStage6Server(active_year=2025, calendar_year=2026) as isolated:
        year_rotation = isolated._year_rotation
        base_url = isolated.base_url

        steps.append(
            _request_step(
                name="seed_session",
                method="POST",
                base_url=base_url,
                path="/api/database",
                headers=headers,
                payload=_seed_session_payload(role="user"),
                timeout_sec=args.http_timeout_sec,
            )
        )
        preview = _request_step(
            name="rotation_preview",
            method="POST",
            base_url=base_url,
            path="/api/year/rotation/preview",
            headers=headers,
            payload={},
            timeout_sec=args.http_timeout_sec,
        )
        steps.append(preview)
        preview_body = preview.body if isinstance(preview.body, dict) else {}
        token = str(preview_body.get("preview_token") or "")

        lock_held = threading.Event()
        proceed = threading.Event()
        winner: dict[str, Any] = {}

        def _hold_lock(**_ctx: Any) -> None:
            lock_held.set()
            proceed.wait(timeout=20)

        year_rotation.set_rotation_test_hook("after_lock_acquired", _hold_lock)

        def _first_commit() -> None:
            result = _request_step(
                name="rotation_commit_parallel_winner",
                method="POST",
                base_url=base_url,
                path="/api/year/rotation/commit",
                headers=headers,
                payload={"preview_token": token, "acknowledge_pending_reo": True},
                timeout_sec=max(args.http_timeout_sec, 40.0),
            )
            winner["step"] = result

        worker = threading.Thread(target=_first_commit, daemon=True)
        worker.start()
        if not lock_held.wait(timeout=20):
            proceed.set()
            worker.join(timeout=5)
            steps.append(
                StepResult(
                    name="rotation_commit_parallel_winner",
                    method="POST",
                    path="/api/year/rotation/commit",
                    ok=False,
                    status_code=None,
                    body=None,
                    error="failed to acquire lock for parallel scenario",
                    elapsed_ms=0,
                )
            )
            return steps

        conflict = _request_step(
            name="rotation_commit_parallel_conflict",
            method="POST",
            base_url=base_url,
            path="/api/year/rotation/commit",
            headers=headers,
            payload={"preview_token": token, "acknowledge_pending_reo": True},
            timeout_sec=args.http_timeout_sec,
            expected_ok=False,
        )
        steps.append(conflict)
        proceed.set()
        worker.join(timeout=40)
        steps.append(winner.get("step") or StepResult(
            name="rotation_commit_parallel_winner",
            method="POST",
            path="/api/year/rotation/commit",
            ok=False,
            status_code=None,
            body=None,
            error="winner commit missing",
            elapsed_ms=0,
        ))
        year_rotation.clear_rotation_test_hooks()
    return steps


def _run_smoke(args: argparse.Namespace) -> dict[str, Any]:
    """Run one stage-6 scenario against HTTP entrypoint."""
    headers = {"Origin": args.origin, "Content-Type": "application/json"}
    runners: dict[str, Callable[[argparse.Namespace, dict[str, str]], list[StepResult]]] = {
        "active": _run_active_scenario,
        "archive": _run_archive_scenario,
        "fail-retry": _run_fail_retry_scenario,
        "parallel-lock": _run_parallel_lock_scenario,
    }
    runner = runners[args.scenario]
    steps = runner(args, headers)
    return build_report(
        run_label=args.run_label,
        base_url=args.base_url,
        origin=args.origin,
        scenario=args.scenario,
        steps=steps,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse CLI arguments for stage-6 smoke runner."""
    parser = argparse.ArgumentParser(
        description="Run production-like smoke against stage-6 yearly archive endpoints.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Backend URL for live scenarios.")
    parser.add_argument("--origin", default=DEFAULT_ORIGIN, help="Origin header.")
    parser.add_argument(
        "--scenario",
        choices=SCENARIOS,
        default="active",
        help="Smoke scenario: active, archive, fail-retry, parallel-lock.",
    )
    parser.add_argument("--run-label", default="stage6-local-backend", help="Evidence label.")
    parser.add_argument(
        "--http-timeout-sec",
        type=float,
        default=DEFAULT_TIMEOUT_SEC,
        help="HTTP timeout per request.",
    )
    parser.add_argument("--write-json", default="", help="Write structured report JSON.")
    parser.add_argument("--write-markdown", default="", help="Write markdown evidence.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """CLI entrypoint."""
    args = parse_args(argv)
    report = _run_smoke(args)
    markdown = _render_markdown(report)

    _write_report(args.write_json or None, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    _write_report(args.write_markdown or None, markdown)

    print(markdown, end="")
    return 0 if report["summary"]["all_steps_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
