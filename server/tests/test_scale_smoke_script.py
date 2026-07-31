"""Unit tests for `scripts/smoke_scale_api.py` report helpers."""

from __future__ import annotations

import importlib.util
import pathlib
import sys


def _load_smoke_module():
    """Load smoke script module from `scripts/` for direct testing."""

    root = pathlib.Path(__file__).resolve().parents[2]
    module_path = root / "scripts" / "smoke_scale_api.py"
    spec = importlib.util.spec_from_file_location("smoke_scale_api", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Failed to load scripts/smoke_scale_api.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_smoke_script_builds_redacted_report_for_success_and_error_steps():
    """TC-UNIT-01: report keeps smoke summary and redacts sensitive values."""

    smoke = _load_smoke_module()
    steps = [
        smoke.StepResult(
            name="connect",
            method="POST",
            path="/api/scales/connect",
            ok=True,
            status_code=200,
            body={
                "success": True,
                "session_id": "session-1",
                "scale": {
                    "site_id": "default-site",
                    "scale_id": "scale-primary",
                    "scale_role": "primary",
                    "transport": "serial_backend",
                },
                "connection": {"serial": {"port": "/dev/ttyUSB0"}},
            },
            error=None,
            elapsed_ms=10,
        ),
        smoke.StepResult(
            name="read",
            method="POST",
            path="/api/scales/read",
            ok=False,
            status_code=503,
            body={
                "success": False,
                "code": "transport_unavailable",
                "message": "port busy",
                "error_context": {"host": "127.0.0.1", "token": "secret"},
            },
            error=None,
            elapsed_ms=15,
        ),
    ]

    report = smoke.build_report(
        run_label="unit-test",
        base_url="http://127.0.0.1:5001",
        origin="http://localhost:5173",
        expected_site_id="default-site",
        expected_scale_id="scale-primary",
        expected_scale_role="primary",
        steps=steps,
    )

    assert report["session_id"] == "session-1"
    assert report["summary"]["all_steps_passed"] is False
    assert report["summary"]["passed_steps"] == 1
    assert report["summary"]["failed_steps"] == 1

    connect_body = report["steps"][0]["body"]
    assert connect_body["connection"] == "***REDACTED***"

    read_body = report["steps"][1]["body"]
    assert read_body["error_context"]["host"] == "***REDACTED***"
    assert read_body["error_context"]["token"] == "***REDACTED***"

    markdown = smoke._render_markdown(report)
    assert "connect: PASSED" in markdown
    assert "read: FAILED" in markdown
    assert "***REDACTED***" in markdown
