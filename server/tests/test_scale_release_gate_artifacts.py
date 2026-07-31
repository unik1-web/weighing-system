"""Unit tests for scale release gate configuration artifacts."""

from __future__ import annotations

import json
import pathlib
import re


def _repo_root() -> pathlib.Path:
    """Return repository root for artifact checks."""

    return pathlib.Path(__file__).resolve().parents[2]


def test_acceptance_report_covers_all_execution_contract_rows():
    """Acceptance report must include EC-01..EC-09 rows with PASS/FAIL status."""

    report_path = _repo_root() / "docs" / "reports" / "scale-adapters" / "scale-adapters-acceptance.md"
    report_text = report_path.read_text(encoding="utf-8")
    row_pattern = re.compile(r"^\|\s*(EC-0[1-9])\s*\|\s*(PASS|FAIL)\s*\|", re.MULTILINE)
    rows = row_pattern.findall(report_text)

    assert rows, "Acceptance report has no EC rows."
    found_ec_ids = {ec_id for ec_id, _status in rows}
    expected_ec_ids = {f"EC-0{index}" for index in range(1, 10)}
    assert found_ec_ids == expected_ec_ids


def test_scale_wrapper_commands_are_declared_in_package_json_and_makefile():
    """CI helper wrappers must cover runtime/parity/server tests and release checks."""

    root = _repo_root()
    package_json = json.loads((root / "package.json").read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})

    assert "test:scale-runtime" in scripts
    assert "test:scale-parity" in scripts
    assert "test:scale-server" in scripts

    makefile_text = (root / "Makefile").read_text(encoding="utf-8")
    assert "\ntest-scale:" in makefile_text
    assert "\nsmoke-scale:" in makefile_text
    assert "\nrelease-check-scale:" in makefile_text


def test_scale_adapters_workflow_contains_required_jobs_and_evidence_checks():
    """Workflow file must include gate jobs and mandatory evidence checks."""

    workflow_path = _repo_root() / ".github" / "workflows" / "scale-adapters.yml"
    workflow_text = workflow_path.read_text(encoding="utf-8")

    for job_name in (
        "docs-api-gate:",
        "frontend-tests:",
        "backend-tests:",
        "build:",
        "windows-package:",
        "evidence-gate:",
    ):
        assert job_name in workflow_text

    assert "docs/reports/scale-adapters/scale-adapters-smoke.md" in workflow_text
    assert "docs/reports/scale-adapters/scale-adapters-exe-checklist.md" in workflow_text
    assert "docs/reports/scale-adapters/scale-adapters-acceptance.md" in workflow_text
