#!/usr/bin/env python3
"""Production-like smoke runner for stage-7 photo capture branches.

Modes:
  - capability — GET /api/cameras/capability
  - capture-noop — session seed + POST /api/cameras/capture → noop
  - capture-http — isolated Flask + local JPEG snapshot server → Photo/ + stubs
  - capture-degrade — unreachable camera → ticket/weight OK + failed rows
  - basic-import — entrypoint import must not pull cv2
  - full-import — cv2 must be available (fail if missing; full job gate)
"""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = REPO_ROOT / "server"
FIXTURES_DIR = SERVER_DIR / "tests" / "fixtures"
MINIMAL_JPEG = (FIXTURES_DIR / "minimal.jpg").read_bytes()

DEFAULT_BASE_URL = "http://127.0.0.1:5001"
DEFAULT_ORIGIN = "http://127.0.0.1:5001"
DEFAULT_TIMEOUT_SEC = 5.0

ALL_MODES = (
    "capability",
    "capture-noop",
    "capture-http",
    "capture-degrade",
    "basic-import",
    "full-import",
)
HTTP_MODES = ("capability", "capture-noop")
ISOLATED_CAPTURE_MODES = ("capture-http", "capture-degrade")
IMPORT_MODES = ("basic-import", "full-import")


@dataclass
class StepResult:
    """Captured response details for one photo-capture smoke step."""

    name: str
    method: str
    path: str
    ok: bool
    status_code: int | None
    body: Any
    error: str | None
    elapsed_ms: int
    note: str | None = None


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


def _safe_json(response: requests.Response) -> Any:
    """Parse JSON body or return plain text for non-JSON responses."""
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
    note: str | None = None,
) -> StepResult:
    """Perform one HTTP request and normalize the result."""
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
        return StepResult(
            name=name,
            method=method,
            path=path,
            ok=200 <= response.status_code < 300,
            status_code=response.status_code,
            body=_safe_json(response),
            error=None,
            elapsed_ms=elapsed_ms,
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
            note=note,
        )


def _seed_session_payload(*, role: str = "user") -> dict[str, Any]:
    """Build /api/database payload with an authenticated operator session."""
    return {
        "data": {
            "app_current_user": json.dumps(
                {
                    "user": {"id": "smoke-photo-user", "username": "operator"},
                    "profile": {
                        "username": "operator",
                        "display_name": "Оператор",
                        "role": role,
                    },
                },
                ensure_ascii=False,
            )
        }
    }


def _ticket_row(**overrides: Any) -> dict[str, Any]:
    """Minimal weighing ticket for capture smoke."""
    base: dict[str, Any] = {
        "id": "smoke-photo-ticket",
        "ticket_number": 1,
        "vehicle_number": "А001АА56",
        "vehicle_brand": "",
        "trailer_number": "",
        "driver_name": "Иванов И.И.",
        "cargo_name": "Грунт",
        "shipper_name": "Отправитель",
        "receiver_name": "Получатель",
        "carrier_name": "Перевозчик",
        "price": 100,
        "vat_rate": 0,
        "gross_weight": 20000,
        "tare_weight": 8000,
        "net_weight": 12000,
        "total_amount": 1200,
        "gross_source": "manual",
        "tare_source": "manual",
        "gross_raw": None,
        "tare_raw": None,
        "gross_datetime": "2026-07-31T10:00:00",
        "tare_datetime": "2026-07-31T10:05:00",
        "scale_device": "test",
        "manual_weight_reason": None,
        "operator_id": None,
        "operator_name": "Оператор",
        "status": "completed",
        "reo_status": "pending",
        "reo_sent_at": None,
        "notes": "",
        "created_at": "2026-07-31T10:00:00",
        "completed_at": "2026-07-31T10:05:00",
        "weighing_mode": "single",
        "version": 1,
        "plate_source": "directory",
        "site_id": "site-1",
        "scale_id": "s-primary",
        "scale_role": "primary",
        "photo_entry_path": None,
        "photo_exit_path": None,
    }
    base.update(overrides)
    return base


def _camera_row(**overrides: Any) -> dict[str, Any]:
    """Enabled camera registry row for capture smoke."""
    base: dict[str, Any] = {
        "id": "cam-smoke-entry",
        "site_id": "site-1",
        "name": "Въезд",
        "role": "entry",
        "http_snapshot_url": "http://127.0.0.1:9/missing.jpg",
        "rtsp_url": None,
        "enabled": 1,
        "roi_x": None,
        "roi_y": None,
        "roi_w": None,
        "roi_h": None,
        "etalon_primary_path": None,
        "etalon_spare_path": None,
        "sort_order": 0,
        "created_at": "2026-07-31T00:00:00",
        "updated_at": "2026-07-31T00:00:00",
    }
    base.update(overrides)
    return base


def _free_port() -> int:
    """Reserve and return an ephemeral free TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _pick_closed_port() -> int:
    """Return a port that is not listening (bind then close)."""
    return _free_port()


def _wait_healthy(base_url: str, *, timeout_sec: float = 15.0) -> bool:
    """Poll GET /api/health until success or timeout."""
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


class _JpegHandler(BaseHTTPRequestHandler):
    """Serve fixed minimal JPEG for HTTP snapshot fixture."""

    def do_GET(self):  # noqa: N802
        payload = MINIMAL_JPEG
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A003
        return


def _start_jpeg_server() -> tuple[ThreadingHTTPServer, str]:
    """Bind local JPEG fixture; return (server, snapshot_url)."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _JpegHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f"http://{host}:{port}/snapshot.jpg"


class IsolatedPhotoCaptureServer:
    """
    Ephemeral Flask HTTP server on an isolated app root.

    Exercises real ``server/app.py`` routes over TCP without mutating live BD/.
    """

    def __init__(self, *, video_enabled: bool = True) -> None:
        self.video_enabled = video_enabled
        self.tmp = tempfile.TemporaryDirectory(prefix="photo-smoke-")
        self.root = Path(self.tmp.name) / "app"
        self.bd_dir = self.root / "BD"
        self.photo_dir = self.root / "Photo"
        self.config_path = self.root / "config.ini"
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self._thread: threading.Thread | None = None
        self._server: Any = None

    def __enter__(self) -> "IsolatedPhotoCaptureServer":
        self.root.mkdir(parents=True, exist_ok=True)
        self.bd_dir.mkdir(parents=True, exist_ok=True)
        self.photo_dir.mkdir(parents=True, exist_ok=True)
        video_flag = "true" if self.video_enabled else "false"
        self.config_path.write_text(
            "[settings]\n"
            f"video_enabled = {video_flag}\n"
            "camera_capture_timeout_sec = 2\n"
            "camera_jpeg_quality = 80\n"
            "tara_default = 900\n",
            encoding="utf-8",
        )

        if str(SERVER_DIR) not in sys.path:
            sys.path.insert(0, str(SERVER_DIR))

        import persistence
        import sqlite_store

        self._persistence = persistence
        self._sqlite_store = sqlite_store
        self._orig_sqlite_root = sqlite_store.get_app_root
        self._orig_persistence_root = persistence.get_app_root
        sqlite_store.get_app_root = lambda: str(self.root)  # type: ignore[assignment]
        persistence.get_app_root = lambda: str(self.root)  # type: ignore[assignment]

        import app as flask_app

        flask_app.app.config["TESTING"] = False
        # Keep smoke stdout parseable (single JSON object).
        import logging

        logging.getLogger("weighing-system-api").setLevel(logging.WARNING)
        logging.getLogger("werkzeug").setLevel(logging.WARNING)

        from werkzeug.serving import make_server

        self._server = make_server("127.0.0.1", self.port, flask_app.app, threaded=True)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        if not _wait_healthy(self.base_url):
            raise RuntimeError(f"Isolated photo smoke server failed on {self.base_url}")
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._server is not None:
            self._server.shutdown()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if hasattr(self, "_sqlite_store"):
            self._sqlite_store.get_app_root = self._orig_sqlite_root
        if hasattr(self, "_persistence"):
            self._persistence.get_app_root = self._orig_persistence_root
        self.tmp.cleanup()


def build_report(
    *,
    mode: str,
    run_label: str,
    base_url: str,
    origin: str,
    steps: list[StepResult],
) -> dict[str, Any]:
    """Assemble structured smoke evidence JSON."""
    all_ok = all(step.ok for step in steps) if steps else False
    return {
        "mode": mode,
        "run_label": run_label,
        "base_url": base_url,
        "origin": origin,
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "steps": [
            {
                "name": step.name,
                "method": step.method,
                "path": step.path,
                "ok": step.ok,
                "status_code": step.status_code,
                "body": step.body,
                "error": step.error,
                "elapsed_ms": step.elapsed_ms,
                "note": step.note,
            }
            for step in steps
        ],
        "summary": {
            "steps_total": len(steps),
            "steps_passed": sum(1 for step in steps if step.ok),
            "all_steps_passed": all_ok,
        },
    }


def _run_capability(args: argparse.Namespace) -> list[StepResult]:
    """Smoke GET /api/cameras/capability."""
    headers = {"Origin": args.origin}
    step = _request_step(
        name="capability",
        method="GET",
        base_url=args.base_url,
        path="/api/cameras/capability",
        headers=headers,
        payload=None,
        timeout_sec=args.http_timeout_sec,
    )
    if step.ok and isinstance(step.body, dict):
        body = step.body
        contract_ok = (
            body.get("success") is True
            and "available" in body
            and body.get("build") in ("basic", "full")
            and body.get("opencv") is body.get("available")
        )
        if not contract_ok:
            step.ok = False
            step.note = "capability contract mismatch"
    return [step]


def _run_capture_noop(args: argparse.Namespace) -> list[StepResult]:
    """Smoke session seed + POST /api/cameras/capture expecting noop stub."""
    headers = {"Origin": args.origin}
    steps: list[StepResult] = []

    seed = _request_step(
        name="seed_session",
        method="POST",
        base_url=args.base_url,
        path="/api/database",
        headers=headers,
        payload=_seed_session_payload(role="user"),
        timeout_sec=args.http_timeout_sec,
    )
    steps.append(seed)

    capture = _request_step(
        name="capture_noop",
        method="POST",
        base_url=args.base_url,
        path="/api/cameras/capture",
        headers=headers,
        payload={"ticket_id": "smoke-photo-ticket", "event": "gross"},
        timeout_sec=args.http_timeout_sec,
        note="video_enabled default false or no cameras → noop=true",
    )
    if capture.ok and isinstance(capture.body, dict):
        body = capture.body
        token = body.get("capture_token")
        contract_ok = (
            body.get("success") is True
            and body.get("noop") is True
            and body.get("results") == []
            and isinstance(token, str)
            and bool(token)
        )
        if not contract_ok:
            capture.ok = False
            capture.note = "capture noop contract mismatch"
    steps.append(capture)
    return steps


def _seed_ticket_and_camera(
    *,
    base_url: str,
    origin: str,
    timeout_sec: float,
    snapshot_url: str,
    ticket_id: str = "smoke-photo-ticket",
) -> list[StepResult]:
    """Seed operator session, ticket and one enabled HTTP camera."""
    headers = {"Origin": origin}
    steps: list[StepResult] = []

    seed_session = _request_step(
        name="seed_session",
        method="POST",
        base_url=base_url,
        path="/api/database",
        headers=headers,
        payload=_seed_session_payload(role="user"),
        timeout_sec=timeout_sec,
    )
    steps.append(seed_session)

    seed_data = _request_step(
        name="seed_ticket_camera",
        method="POST",
        base_url=base_url,
        path="/api/database",
        headers=headers,
        payload={
            "data": {
                "app_weighing_tickets": json.dumps(
                    [_ticket_row(id=ticket_id)],
                    ensure_ascii=False,
                ),
                "app_cameras": json.dumps(
                    [
                        _camera_row(
                            id="cam-smoke-entry",
                            role="entry",
                            http_snapshot_url=snapshot_url,
                        )
                    ],
                    ensure_ascii=False,
                ),
            }
        },
        timeout_sec=timeout_sec,
    )
    steps.append(seed_data)
    return steps


def _run_capture_http(args: argparse.Namespace) -> tuple[list[StepResult], str]:
    """
    No-mock capture-http: isolated Flask + local JPEG fixture → Photo/ + stubs.

    Returns:
        (steps, base_url used)
    """
    jpeg_server, snapshot_url = _start_jpeg_server()
    steps: list[StepResult] = []
    base_url = args.base_url
    try:
        with IsolatedPhotoCaptureServer(video_enabled=True) as isolated:
            base_url = isolated.base_url
            steps.extend(
                _seed_ticket_and_camera(
                    base_url=base_url,
                    origin=args.origin,
                    timeout_sec=args.http_timeout_sec,
                    snapshot_url=snapshot_url,
                )
            )

            capture = _request_step(
                name="capture_http",
                method="POST",
                base_url=base_url,
                path="/api/cameras/capture",
                headers={"Origin": args.origin},
                payload={"ticket_id": "smoke-photo-ticket", "event": "gross"},
                timeout_sec=max(args.http_timeout_sec, 10.0),
                note=f"HTTP fixture {snapshot_url}",
            )

            entry_stub: str | None = None
            if capture.ok and isinstance(capture.body, dict):
                body = capture.body
                photos = body.get("ticket_photos") or []
                results = body.get("results") or []
                stub_val = body.get("photo_entry_path")
                entry_stub = stub_val if isinstance(stub_val, str) else None
                token = body.get("capture_token")
                contract_ok = (
                    body.get("success") is True
                    and body.get("noop") is False
                    and isinstance(token, str)
                    and bool(token)
                    and len(results) >= 1
                    and all(r.get("status") == "success" for r in results)
                    and len(photos) >= 1
                    and all(p.get("status") == "success" for p in photos)
                    and bool(entry_stub)
                )
                files_ok = True
                missing: list[str] = []
                for row in photos:
                    rel = row.get("file_path")
                    if not isinstance(rel, str) or not rel:
                        files_ok = False
                        missing.append(str(rel))
                        continue
                    abs_path = isolated.root / rel
                    if not abs_path.is_file() or abs_path.stat().st_size <= 0:
                        files_ok = False
                        missing.append(rel)

                if not contract_ok or not files_ok:
                    capture.ok = False
                    capture.note = (
                        "capture-http contract mismatch"
                        + (f"; missing files: {missing}" if missing else "")
                    )
                else:
                    capture.note = f"Photo files ok under {isolated.photo_dir}"
            steps.append(capture)

            db = _request_step(
                name="verify_ticket_weight",
                method="GET",
                base_url=base_url,
                path="/api/database",
                headers={"Origin": args.origin},
                payload=None,
                timeout_sec=args.http_timeout_sec,
            )
            weight_ok = False
            stubs_ok = False
            if db.ok and isinstance(db.body, dict):
                data = db.body.get("data") or {}
                tickets_raw = data.get("app_weighing_tickets") or "[]"
                try:
                    tickets = (
                        json.loads(tickets_raw) if isinstance(tickets_raw, str) else tickets_raw
                    )
                except ValueError:
                    tickets = []
                ticket = next(
                    (t for t in tickets if t.get("id") == "smoke-photo-ticket"),
                    None,
                )
                if ticket is not None:
                    weight_ok = ticket.get("gross_weight") == 20000
                    stubs_ok = entry_stub is not None and ticket.get("photo_entry_path") == entry_stub
            db.ok = weight_ok and stubs_ok
            if not db.ok:
                db.note = "ticket weight/stubs mismatch after capture-http"
                # Keep capture step visible as failed when post-check fails.
                if capture.ok:
                    capture.ok = False
                    capture.note = (capture.note or "") + "; ticket verify failed"
            steps.append(db)
    finally:
        jpeg_server.shutdown()
        jpeg_server.server_close()
    return steps, base_url


def _run_capture_degrade(args: argparse.Namespace) -> tuple[list[StepResult], str]:
    """Unreachable camera: weight/ticket OK + failed ticket_photos (preserve policy)."""
    closed = _pick_closed_port()
    snapshot_url = f"http://127.0.0.1:{closed}/missing.jpg"
    steps: list[StepResult] = []
    base_url = args.base_url

    with IsolatedPhotoCaptureServer(video_enabled=True) as isolated:
        base_url = isolated.base_url
        steps.extend(
            _seed_ticket_and_camera(
                base_url=base_url,
                origin=args.origin,
                timeout_sec=args.http_timeout_sec,
                snapshot_url=snapshot_url,
            )
        )

        capture = _request_step(
            name="capture_degrade",
            method="POST",
            base_url=base_url,
            path="/api/cameras/capture",
            headers={"Origin": args.origin},
            payload={"ticket_id": "smoke-photo-ticket", "event": "gross"},
            timeout_sec=max(args.http_timeout_sec, 10.0),
            note=f"closed port {closed}",
        )

        db = _request_step(
            name="verify_ticket_after_degrade",
            method="GET",
            base_url=base_url,
            path="/api/database",
            headers={"Origin": args.origin},
            payload=None,
            timeout_sec=args.http_timeout_sec,
        )

        weight_ok = False
        if db.ok and isinstance(db.body, dict):
            data = db.body.get("data") or {}
            tickets_raw = data.get("app_weighing_tickets") or "[]"
            try:
                tickets = json.loads(tickets_raw) if isinstance(tickets_raw, str) else tickets_raw
            except ValueError:
                tickets = []
            ticket = next((t for t in tickets if t.get("id") == "smoke-photo-ticket"), None)
            if ticket is not None:
                weight_ok = (
                    ticket.get("gross_weight") == 20000
                    and ticket.get("tare_weight") == 8000
                    and ticket.get("net_weight") == 12000
                )
        db.ok = weight_ok
        if not weight_ok:
            db.note = "ticket weight missing/changed after degrade capture"
        steps.append(db)

        if capture.ok and isinstance(capture.body, dict):
            body = capture.body
            photos = body.get("ticket_photos") or []
            results = body.get("results") or []
            # Degrade: HTTP 200, success true, per-camera failed, weight path intact
            has_failed = any(r.get("status") == "failed" for r in results) or any(
                p.get("status") == "failed" for p in photos
            )
            contract_ok = (
                body.get("success") is True
                and body.get("noop") is False
                and has_failed
                and weight_ok
            )
            if not contract_ok:
                capture.ok = False
                capture.note = "capture-degrade contract mismatch (expected failed + weight OK)"
            else:
                capture.note = "degrade: failed photos, ticket/weight preserved"
        elif capture.ok:
            capture.ok = False
            capture.note = "capture-degrade returned non-JSON body"
        steps.append(capture)

    return steps, base_url


def _python_bin() -> str:
    """Prefer project venv interpreter; fall back to the active interpreter (CI)."""
    return _resolve_python_bin(REPO_ROOT)


def _run_basic_import(_args: argparse.Namespace) -> list[StepResult]:
    """
    Assert basic entrypoint import does not pull cv2.

    Blocks cv2 and imports ``cameras`` + ``app``; fails if import requires OpenCV
    or if cv2 was loaded as a side-effect before the block would matter.
    """
    script = r"""
import builtins
import sys

real_import = builtins.__import__
cv2_hits = []

def _track_and_block(name, globals=None, locals=None, fromlist=(), level=0):
    if name == 'cv2' or (isinstance(name, str) and name.startswith('cv2.')):
        cv2_hits.append(name)
        raise ImportError('cv2 blocked for basic-import smoke')
    return real_import(name, globals, locals, fromlist, level)

builtins.__import__ = _track_and_block
sys.path.insert(0, sys.argv[1])

import cameras
assert cameras.is_camera_module_available() is False
assert cameras.get_camera_build_label() == 'basic'

# Entrypoint modules must load without OpenCV.
import app
assert app.app is not None

# launcher imports app lazily in main(); importing the module must still be safe.
import launcher
assert callable(launcher.main)

client = app.app.test_client()
response = client.get('/api/cameras/capability')
assert response.status_code == 200
body = response.get_json()
assert body['available'] is False
assert body['build'] == 'basic'
assert body['opencv'] is False

# cv2 must not have been successfully imported; blocked attempts are OK.
print(json.dumps({'ok': True, 'cv2_blocked_attempts': cv2_hits, 'build': body['build']}))
"""
    # Inject json import into the script header.
    script = "import json\n" + script
    started = datetime.now(tz=timezone.utc)
    completed = subprocess.run(
        [_python_bin(), "-c", script, str(SERVER_DIR)],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    elapsed_ms = int((datetime.now(tz=timezone.utc) - started).total_seconds() * 1000)
    body: Any = None
    ok = completed.returncode == 0
    error = None
    note = "entrypoint cameras+app+launcher without cv2"
    if completed.stdout.strip():
        try:
            # Last JSON line
            body = json.loads(completed.stdout.strip().splitlines()[-1])
        except ValueError:
            body = {"raw_stdout": completed.stdout.strip()}
    if not ok:
        error = (completed.stderr or completed.stdout or "basic-import failed").strip()
        note = "basic-import failed: entrypoint required cv2 or crashed"
    return [
        StepResult(
            name="basic_import",
            method="N/A",
            path="server/app.py+launcher.py",
            ok=ok,
            status_code=completed.returncode,
            body=body,
            error=error,
            elapsed_ms=elapsed_ms,
            note=note,
        )
    ]


def _run_full_import(_args: argparse.Namespace) -> list[StepResult]:
    """
    Assert OpenCV is available for the full build lane.

    Fails (non-zero) when cv2 cannot be imported — intentional full-job gate.
    """
    script = r"""
import json
import sys
sys.path.insert(0, sys.argv[1])

try:
    import cv2  # noqa: F401
except ImportError as exc:
    print(json.dumps({'ok': False, 'error': f'cv2 missing: {exc}'}))
    raise SystemExit(1)

import cameras
available = cameras.is_camera_module_available()
label = cameras.get_camera_build_label()
if not available or label != 'full':
    print(json.dumps({
        'ok': False,
        'available': available,
        'build': label,
        'error': 'full-import requires opencv available and build=full',
    }))
    raise SystemExit(1)

print(json.dumps({
    'ok': True,
    'available': True,
    'build': 'full',
    'opencv_version': getattr(cv2, '__version__', None),
}))
"""
    started = datetime.now(tz=timezone.utc)
    completed = subprocess.run(
        [_python_bin(), "-c", script, str(SERVER_DIR)],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    elapsed_ms = int((datetime.now(tz=timezone.utc) - started).total_seconds() * 1000)
    body: Any = None
    ok = completed.returncode == 0
    error = None
    note = "cv2 required for full lane"
    if completed.stdout.strip():
        try:
            body = json.loads(completed.stdout.strip().splitlines()[-1])
        except ValueError:
            body = {"raw_stdout": completed.stdout.strip()}
    if not ok:
        error = None
        if isinstance(body, dict) and body.get("error"):
            error = str(body["error"])
        else:
            error = (completed.stderr or completed.stdout or "full-import failed").strip()
        note = "full-import FAIL: opencv missing or build!=full"
    return [
        StepResult(
            name="full_import",
            method="N/A",
            path="import cv2 + cameras",
            ok=ok,
            status_code=completed.returncode,
            body=body,
            error=error,
            elapsed_ms=elapsed_ms,
            note=note,
        )
    ]


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse CLI arguments for photo-capture smoke."""
    parser = argparse.ArgumentParser(
        description=(
            "Run production-like smoke against stage-7 camera/photo paths. "
            f"Modes: {', '.join(ALL_MODES)}."
        ),
    )
    parser.add_argument(
        "mode_positional",
        nargs="?",
        default=None,
        choices=ALL_MODES,
        help="Smoke mode (positional; same as --mode). Supports: npm run smoke:photo -- capture-http",
    )
    parser.add_argument(
        "--mode",
        default=None,
        choices=ALL_MODES,
        help="Smoke mode (overrides positional when both set).",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Backend URL for HTTP modes.")
    parser.add_argument(
        "--origin",
        default=DEFAULT_ORIGIN,
        help=(
            "Origin header (must be allowlisted: "
            "http://127.0.0.1:5001 or localhost:5173). "
            "Keep default even when --base-url uses another port."
        ),
    )
    parser.add_argument("--run-label", default="local-backend", help="Evidence label.")
    parser.add_argument(
        "--http-timeout-sec",
        type=float,
        default=DEFAULT_TIMEOUT_SEC,
        help="HTTP timeout per request.",
    )
    parser.add_argument(
        "--evidence-dir",
        default=None,
        help="Optional directory to write JSON evidence (also printed to stdout).",
    )
    args = parser.parse_args(argv)
    mode = args.mode or args.mode_positional or "capability"
    args.mode = mode
    return args


def _maybe_write_evidence(report: dict[str, Any], evidence_dir: str | None) -> None:
    """Write report JSON under evidence_dir when requested."""
    if not evidence_dir:
        return
    out_dir = Path(evidence_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = report.get("mode", "unknown")
    stamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"smoke_photo_{mode}_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    """CLI entrypoint: run selected mode and print JSON report to stdout."""
    args = parse_args(argv)
    base_url = args.base_url

    if args.mode == "capability":
        steps = _run_capability(args)
    elif args.mode == "capture-noop":
        steps = _run_capture_noop(args)
    elif args.mode == "capture-http":
        steps, base_url = _run_capture_http(args)
    elif args.mode == "capture-degrade":
        steps, base_url = _run_capture_degrade(args)
    elif args.mode == "basic-import":
        steps = _run_basic_import(args)
        base_url = "n/a"
    elif args.mode == "full-import":
        steps = _run_full_import(args)
        base_url = "n/a"
    else:
        print(json.dumps({"error": f"unknown mode: {args.mode}"}), file=sys.stderr)
        return 1

    report = build_report(
        mode=args.mode,
        run_label=args.run_label,
        base_url=base_url,
        origin=args.origin,
        steps=steps,
    )
    _maybe_write_evidence(report, args.evidence_dir)
    # Single JSON object on stdout for CI parsers / pytest assertions.
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["summary"]["all_steps_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
