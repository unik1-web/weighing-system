"""Unit tests for stage-6 yearly archive smoke evidence renderer."""

from __future__ import annotations

import importlib.util
import pathlib
import sys


def _load_smoke_module():
    """Load smoke script module from `scripts/` for direct testing."""
    root = pathlib.Path(__file__).resolve().parents[2]
    module_path = root / "scripts" / "smoke_yearly_archive.py"
    spec = importlib.util.spec_from_file_location("smoke_yearly_archive", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Failed to load scripts/smoke_yearly_archive.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_smoke_yearly_archive_evidence_renderer_status_pass_fail():
    """TC-UNIT-03: markdown/json evidence содержит PASS/FAIL по шагам сценария."""
    smoke = _load_smoke_module()
    steps = [
        smoke.StepResult(
            name="health",
            method="GET",
            path="/api/health",
            ok=True,
            status_code=200,
            body={"success": True, "service": "weighing-system-api"},
            error=None,
            elapsed_ms=3,
        ),
        smoke.StepResult(
            name="archive_edit_forbidden",
            method="PATCH",
            path="/api/archive/tickets/t-1",
            ok=True,
            status_code=422,
            body={
                "success": False,
                "code": "archive_edit_forbidden_field",
                "message": "forbidden",
            },
            error=None,
            elapsed_ms=5,
            expected_ok=False,
        ),
        smoke.StepResult(
            name="rotation_preview",
            method="POST",
            path="/api/year/rotation/preview",
            ok=False,
            status_code=500,
            body={"success": False},
            error=None,
            elapsed_ms=4,
        ),
    ]

    report = smoke.build_report(
        run_label="unit-evidence",
        base_url="http://127.0.0.1:5001",
        origin="http://127.0.0.1:5001",
        scenario="archive",
        steps=steps,
    )

    assert report["summary"]["status"] == "FAIL"
    assert report["summary"]["passed_steps"] == 2
    assert report["summary"]["failed_steps"] == 1
    assert report["meta"]["scenario"] == "archive"

    markdown = smoke._render_markdown(report)
    assert "Scenario: `archive`" in markdown
    assert "health: PASSED" in markdown
    assert "archive_edit_forbidden: PASSED" in markdown
    assert "rotation_preview: FAILED" in markdown
    assert "status: `FAIL`" in markdown


def test_smoke_yearly_archive_cli_scenarios_are_registered():
    """Smoke CLI exposes required production-relevant scenarios."""
    smoke = _load_smoke_module()
    assert set(smoke.SCENARIOS) == {"active", "archive", "fail-retry", "parallel-lock"}
