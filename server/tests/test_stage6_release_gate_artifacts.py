"""Unit tests for stage-6 yearly archive CI/release gate artifacts."""

from __future__ import annotations

import json
import pathlib
import re
import shutil


def _repo_root() -> pathlib.Path:
    """Return repository root for artifact checks."""
    return pathlib.Path(__file__).resolve().parents[2]


STAGE6_REPORTS_DIR = _repo_root() / "docs" / "reports" / "yearly-db-archive"
STAGE6_WORKFLOW = _repo_root() / ".github" / "workflows" / "yearly-db-archive.yml"
PACKAGE_JSON = _repo_root() / "package.json"

REQUIRED_EVIDENCE_FILES = (
    "yearly-archive-smoke.md",
    "yearly-archive-archive.md",
    "yearly-archive-fail-retry.md",
    "yearly-archive-parallel-lock.md",
    "yearly-archive-acceptance.md",
    "release-checklist.md",
)

REQUIRED_EC_IDS = tuple(f"EC-{index:02d}" for index in range(1, 15))
REQUIRED_TF_IDS = tuple(f"TF-{index:02d}" for index in range(1, 6))
CONTRACT_ROW_PATTERN = re.compile(
    r"^\|\s*(EC-\d+|TF-\d+)\s*\|\s*(PASS|FAIL)\s*\|",
    re.MULTILINE,
)


def collect_stage6_release_gate_issues(reports_dir: pathlib.Path) -> list[str]:
    """
    Validate stage-6 evidence directory for release gate.

    Returns:
        Empty list when the gate should PASS; otherwise human-readable FAIL reasons.
    """
    issues: list[str] = []

    for name in REQUIRED_EVIDENCE_FILES:
        path = reports_dir / name
        if not path.is_file() or path.stat().st_size == 0:
            issues.append(f"missing evidence file: {name}")

    acceptance_path = reports_dir / "yearly-archive-acceptance.md"
    if not acceptance_path.is_file():
        return issues

    acceptance_text = acceptance_path.read_text(encoding="utf-8")
    rows = CONTRACT_ROW_PATTERN.findall(acceptance_text)
    found_ids = {contract_id for contract_id, _status in rows}

    for contract_id in REQUIRED_EC_IDS + REQUIRED_TF_IDS:
        if contract_id not in found_ids:
            issues.append(f"missing acceptance row: {contract_id}")

    for contract_id, status in rows:
        if contract_id in REQUIRED_EC_IDS + REQUIRED_TF_IDS and status == "FAIL":
            issues.append(f"acceptance row marked FAIL: {contract_id}")

    return issues


def test_stage6_release_gate_passes_with_complete_evidence():
    """TC-UNIT-01: full evidence set produces an empty issue list (PASS)."""
    issues = collect_stage6_release_gate_issues(STAGE6_REPORTS_DIR)
    assert issues == [], f"Unexpected release-gate issues: {issues}"


def test_stage6_release_gate_fails_when_evidence_missing(tmp_path: pathlib.Path):
    """TC-UNIT-01: incomplete evidence set is reported as FAIL."""
    incomplete_dir = tmp_path / "yearly-db-archive"
    incomplete_dir.mkdir()
    # Copy acceptance only — omit other evidence reports on purpose.
    shutil.copy2(
        STAGE6_REPORTS_DIR / "yearly-archive-acceptance.md",
        incomplete_dir / "yearly-archive-acceptance.md",
    )

    issues = collect_stage6_release_gate_issues(incomplete_dir)
    assert issues, "Expected FAIL for incomplete evidence set"
    assert any("missing evidence file: yearly-archive-smoke.md" in item for item in issues)
    assert any("missing evidence file: release-checklist.md" in item for item in issues)


def test_stage6_release_gate_fails_when_acceptance_has_fail(tmp_path: pathlib.Path):
    """TC-UNIT-01: acceptance FAIL status is caught by the gate helper."""
    broken_dir = tmp_path / "yearly-db-archive"
    shutil.copytree(STAGE6_REPORTS_DIR, broken_dir)
    acceptance_path = broken_dir / "yearly-archive-acceptance.md"
    text = acceptance_path.read_text(encoding="utf-8")
    broken = text.replace("| EC-03 | PASS |", "| EC-03 | FAIL |", 1)
    assert broken != text, "Fixture acceptance report must contain EC-03 PASS row"
    acceptance_path.write_text(broken, encoding="utf-8")

    issues = collect_stage6_release_gate_issues(broken_dir)
    assert any("acceptance row marked FAIL: EC-03" in item for item in issues)


def test_stage6_wrapper_commands_are_declared_in_package_json():
    """CI wrappers must cover stage-6 backend/frontend/smoke without inline file lists."""
    package_json = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    scripts = package_json.get("scripts", {})

    for script_name in (
        "test:stage6",
        "test:stage6-backend",
        "test:stage6-frontend",
        "smoke:stage6",
        "smoke:stage6-archive",
        "smoke:stage6-fail-retry",
        "smoke:stage6-parallel-lock",
    ):
        assert script_name in scripts, f"Missing package.json script: {script_name}"

    assert "test_stage6_release_gate_artifacts.py" in scripts["test:stage6-backend"]
    assert "smoke_yearly_archive.py --scenario active" in scripts["smoke:stage6"]
    assert "smoke_yearly_archive.py --scenario archive" in scripts["smoke:stage6-archive"]


def test_yearly_db_archive_workflow_contains_required_jobs_and_smoke():
    """TC-UNIT-02: workflow declares required jobs, smoke scenarios and evidence paths."""
    workflow_text = STAGE6_WORKFLOW.read_text(encoding="utf-8")

    for job_name in (
        "frontend-tests:",
        "backend-tests:",
        "build:",
        "production-smoke:",
        "windows-package:",
        "evidence-gate:",
    ):
        assert job_name in workflow_text, f"Missing workflow job: {job_name}"

    for command in (
        "npm ci",
        "npm test",
        "npm run test:stage6-frontend",
        "npm run test:stage6-backend",
        "npm run build",
        "npm start",
        "npm run smoke:stage6",
        "npm run smoke:stage6-archive",
        "npm run smoke:stage6-fail-retry",
        "npm run smoke:stage6-parallel-lock",
        "npm run build:win:exe",
    ):
        assert command in workflow_text, f"Missing workflow command: {command}"

    for evidence_path in (
        "docs/reports/yearly-db-archive/yearly-archive-smoke.md",
        "docs/reports/yearly-db-archive/yearly-archive-archive.md",
        "docs/reports/yearly-db-archive/yearly-archive-fail-retry.md",
        "docs/reports/yearly-db-archive/yearly-archive-parallel-lock.md",
        "docs/reports/yearly-db-archive/yearly-archive-acceptance.md",
        "docs/reports/yearly-db-archive/release-checklist.md",
    ):
        assert evidence_path in workflow_text, f"Missing evidence path: {evidence_path}"

    assert "BD" in workflow_text
    assert "backup" in workflow_text
    assert "_MEIPASS" in workflow_text
