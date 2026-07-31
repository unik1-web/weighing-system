"""Release-gate anchors for stage-7 photo capture (EC-10…EC-12, UC-07, CI/deploy).

Checks that mandatory test files, pytest anchors, package.json wrappers, smoke
script modes, dual packaging artifacts, deploy runbook and CI workflow exist.
"""

from __future__ import annotations

import json
import pathlib


def _repo_root() -> pathlib.Path:
    """Return repository root for artifact checks."""
    return pathlib.Path(__file__).resolve().parents[2]


PACKAGE_JSON = _repo_root() / 'package.json'
TESTS_DIR = _repo_root() / 'server' / 'tests'
SCRIPTS_DIR = _repo_root() / 'scripts'
WORKFLOW_PATH = _repo_root() / '.github' / 'workflows' / 'photo-capture.yml'
DEPLOY_RUNBOOK = _repo_root() / 'docs' / 'photo-capture-deploy.md'
REQUIREMENTS_FULL = _repo_root() / 'server' / 'requirements-full.txt'
FULL_SPEC = _repo_root() / 'installer' / 'weighing-system-full.spec'
FULL_ISS = _repo_root() / 'installer' / 'weighing-system-full.iss'

# Key backend test modules that must stay in the stage-7 suite.
REQUIRED_TEST_FILES = (
    'test_cameras_capture_api.py',
    'test_cameras_capture_http.py',
    'test_cameras_capture_rtsp_timeout.py',
    'test_ticket_photos_replace.py',
    'test_photo_capture_orchestration.py',
    'test_stage7_database_cameras_roundtrip.py',
    'test_stage7_cameras_validation.py',
    'test_photo_storage.py',
    'test_camera_logging.py',
    'test_stage7_release_gate.py',
    'test_stage7_packaging_tokens.py',
    'test_photo_capture_deploy_docs.py',
)

# Named anchors: (relative test file, substring that must appear).
REQUIRED_TEST_ANCHORS = (
    # TC-E2E-01 metadata success (HTTP fixture, no full Flask mock)
    ('test_cameras_capture_api.py', 'test_capture_two_http_cameras_success'),
    ('test_photo_capture_orchestration.py', 'test_orchestration_single_save_http_fixture'),
    # TC-E2E-02 degrade timeout + weight intact
    ('test_cameras_capture_api.py', 'test_capture_http_timeout_keeps_ticket'),
    ('test_cameras_capture_api.py', 'test_capture_mixed_timeout_keeps_ticket'),
    # TC-E2E-03 sync dump without JPEG/base64 blobs
    (
        'test_stage7_database_cameras_roundtrip.py',
        'test_api_database_ticket_photos_dump_has_no_binary_blobs',
    ),
    # TC-E2E-04 sync isolation A/B
    ('test_photo_capture_orchestration.py', 'test_orchestration_capture_a_flush_preserves_b'),
    # TC-UNIT-01 RTSP hung open → timeout (EC-12)
    ('test_cameras_capture_rtsp_timeout.py', 'test_rtsp_hung_open_returns_timeout'),
    # TC-UNIT-02 failed replace preserves success
    ('test_ticket_photos_replace.py', 'test_replace_success_then_failed_preserves_success'),
    # TC-UNIT-03 _replace_cameras 400 cases
    ('test_stage7_cameras_validation.py', 'test_api_five_cameras_same_site_rejected'),
    # TC-UNIT-04 noop branches
    ('test_ticket_photos_replace.py', 'test_noop_when_video_disabled'),
    ('test_cameras_capture_api.py', 'test_capture_noop_with_zero_enabled_cameras'),
    ('test_stage7_stub_contract.py', 'test_cameras_capability_reflects_cv2_availability'),
    # TC-UNIT-05 rotation_in_progress → 409, no files
    ('test_cameras_capture_api.py', 'test_capture_rotation_in_progress_no_files'),
    # Dual packaging tokens (UC-07)
    ('test_stage7_packaging_tokens.py', 'test_packaging_token_matrix_basic_and_full'),
    ('test_stage7_packaging_tokens.py', 'test_basic_requirements_has_no_opencv'),
    ('test_stage7_packaging_tokens.py', 'test_full_requirements_contains_opencv_headless'),
)

REQUIRED_PACKAGE_SCRIPTS = (
    'test:stage7-backend',
    'test:stage7-frontend',
    'test:stage7',
    'smoke:photo',
    'smoke:photo-capability',
    'smoke:photo-capture-noop',
    'smoke:photo-capture-http',
    'smoke:photo-capture-degrade',
    'smoke:photo-basic-import',
    'smoke:photo-full-import',
    'build:win:full',
    'build:win:full:exe',
)

# Modules that must be listed in test:stage7-backend (EC-10/EC-12 coverage).
REQUIRED_BACKEND_SCRIPT_MODULES = (
    'test_stage7_release_gate.py',
    'test_cameras_capture_rtsp_timeout.py',
    'test_ticket_photos_replace.py',
    'test_photo_capture_orchestration.py',
    'test_cameras_capture_api.py',
    'test_photo_storage.py',
    'test_stage7_packaging_tokens.py',
    'test_photo_capture_deploy_docs.py',
)

SMOKE_SCRIPT = SCRIPTS_DIR / 'smoke_photo_capture.py'
REQUIRED_SMOKE_MODE_MARKERS = (
    'capability',
    'capture-noop',
    'capture-http',
    'capture-degrade',
    'basic-import',
    'full-import',
)


def collect_stage7_release_gate_issues(
    *,
    tests_dir: pathlib.Path | None = None,
    package_json_path: pathlib.Path | None = None,
    smoke_script: pathlib.Path | None = None,
    workflow_path: pathlib.Path | None = None,
    deploy_runbook: pathlib.Path | None = None,
    requirements_full: pathlib.Path | None = None,
    full_spec: pathlib.Path | None = None,
    full_iss: pathlib.Path | None = None,
) -> list[str]:
    """
    Validate stage-7 test/script anchors for the release gate.

    Returns:
        Empty list when the gate should PASS; otherwise human-readable FAIL reasons.
    """
    issues: list[str] = []
    tests = tests_dir or TESTS_DIR
    package_path = package_json_path or PACKAGE_JSON
    smoke_path = smoke_script or SMOKE_SCRIPT
    workflow = workflow_path or WORKFLOW_PATH
    deploy = deploy_runbook or DEPLOY_RUNBOOK
    req_full = requirements_full or REQUIREMENTS_FULL
    spec = full_spec or FULL_SPEC
    iss = full_iss or FULL_ISS

    for name in REQUIRED_TEST_FILES:
        path = tests / name
        if not path.is_file() or path.stat().st_size == 0:
            issues.append(f'missing test file: {name}')

    for rel_name, marker in REQUIRED_TEST_ANCHORS:
        path = tests / rel_name
        if not path.is_file():
            issues.append(f'missing anchor file for {marker}: {rel_name}')
            continue
        text = path.read_text(encoding='utf-8')
        if marker not in text:
            issues.append(f'missing test anchor {marker} in {rel_name}')

    if not package_path.is_file():
        issues.append('missing package.json')
        return issues

    package_json = json.loads(package_path.read_text(encoding='utf-8'))
    scripts = package_json.get('scripts') or {}
    for script_name in REQUIRED_PACKAGE_SCRIPTS:
        if script_name not in scripts:
            issues.append(f'missing package.json script: {script_name}')

    backend_script = scripts.get('test:stage7-backend') or ''
    for module_name in REQUIRED_BACKEND_SCRIPT_MODULES:
        if module_name not in backend_script:
            issues.append(
                f'test:stage7-backend must include {module_name}'
            )

    if not smoke_path.is_file() or smoke_path.stat().st_size == 0:
        issues.append('missing scripts/smoke_photo_capture.py')
    else:
        smoke_text = smoke_path.read_text(encoding='utf-8')
        for mode in REQUIRED_SMOKE_MODE_MARKERS:
            if mode not in smoke_text:
                issues.append(f'smoke_photo_capture.py missing mode marker: {mode}')

    # Packaging + CI/deploy artifacts (UC-07 / task 4.2).
    for label, path in (
        ('requirements-full.txt', req_full),
        ('weighing-system-full.spec', spec),
        ('weighing-system-full.iss', iss),
        ('photo-capture-deploy.md', deploy),
        ('photo-capture.yml', workflow),
    ):
        if not path.is_file() or path.stat().st_size == 0:
            issues.append(f'missing packaging/CI artifact: {label}')

    if workflow.is_file() and workflow.stat().st_size > 0:
        workflow_text = workflow.read_text(encoding='utf-8')
        for marker in (
            'import-smoke-basic',
            'import-smoke-full',
            'smoke:photo-basic-import',
            'smoke:photo-full-import',
            'evidence-gate',
        ):
            if marker not in workflow_text:
                issues.append(f'photo-capture.yml missing marker: {marker}')

    return issues


def test_stage7_release_gate_passes_with_complete_anchors():
    """Full anchor set produces an empty issue list (PASS)."""
    issues = collect_stage7_release_gate_issues()
    assert issues == [], f'Unexpected release-gate issues: {issues}'


def test_stage7_release_gate_fails_when_anchor_missing(tmp_path: pathlib.Path):
    """Incomplete anchor set is reported as FAIL."""
    incomplete = tmp_path / 'tests'
    incomplete.mkdir()
    # Copy one file only — omit the rest on purpose.
    sample = TESTS_DIR / 'test_cameras_capture_rtsp_timeout.py'
    (incomplete / sample.name).write_text(sample.read_text(encoding='utf-8'), encoding='utf-8')

    fake_package = tmp_path / 'package.json'
    fake_package.write_text(
        json.dumps({'scripts': {'test:stage7-backend': 'pytest'}}, ensure_ascii=False),
        encoding='utf-8',
    )
    fake_smoke = tmp_path / 'smoke_photo_capture.py'
    fake_smoke.write_text('# empty stub\n', encoding='utf-8')

    issues = collect_stage7_release_gate_issues(
        tests_dir=incomplete,
        package_json_path=fake_package,
        smoke_script=fake_smoke,
    )
    assert issues, 'Expected FAIL for incomplete stage-7 anchors'
    assert any('missing test file:' in item for item in issues)
    assert any('missing package.json script:' in item for item in issues)


def test_stage7_wrapper_commands_are_declared_in_package_json():
    """CI wrappers must cover stage-7 backend/frontend/smoke without empty lists."""
    package_json = json.loads(PACKAGE_JSON.read_text(encoding='utf-8'))
    scripts = package_json.get('scripts', {})

    for script_name in REQUIRED_PACKAGE_SCRIPTS:
        assert script_name in scripts, f'Missing package.json script: {script_name}'

    backend = scripts['test:stage7-backend']
    for module_name in REQUIRED_BACKEND_SCRIPT_MODULES:
        assert module_name in backend, f'test:stage7-backend missing {module_name}'

    assert 'smoke_photo_capture.py' in scripts['smoke:photo']
    assert '--mode capability' in scripts['smoke:photo-capability']
    assert '--mode capture-noop' in scripts['smoke:photo-capture-noop']
    assert '--mode capture-http' in scripts['smoke:photo-capture-http']
    assert '--mode capture-degrade' in scripts['smoke:photo-capture-degrade']
    assert '--mode basic-import' in scripts['smoke:photo-basic-import']
    assert '--mode full-import' in scripts['smoke:photo-full-import']
    assert '-Full' in scripts['build:win:full']
    assert '-Full' in scripts['build:win:full:exe']
    assert 'test:stage7-backend' in scripts['test:stage7']
    assert 'test:stage7-frontend' in scripts['test:stage7']
    assert 'photo-capture-e2e-flow.test.ts' in scripts['test:stage7-frontend']
    assert 'video-enabled-toggle.test.ts' in scripts['test:stage7-frontend']
    assert 'test_stage7_packaging_tokens.py' in scripts['test:stage7-backend']
    assert 'test_photo_capture_deploy_docs.py' in scripts['test:stage7-backend']


def test_stage7_release_gate_requires_ci_and_full_packaging_artifacts():
    """TC-E2E-02: gate fails when requirements-full / workflow / deploy doc missing."""
    issues = collect_stage7_release_gate_issues(
        requirements_full=pathlib.Path('/tmp/missing-requirements-full.txt'),
        workflow_path=pathlib.Path('/tmp/missing-photo-capture.yml'),
        deploy_runbook=pathlib.Path('/tmp/missing-photo-capture-deploy.md'),
    )
    assert any('requirements-full.txt' in item for item in issues)
    assert any('photo-capture.yml' in item for item in issues)
    assert any('photo-capture-deploy.md' in item for item in issues)
