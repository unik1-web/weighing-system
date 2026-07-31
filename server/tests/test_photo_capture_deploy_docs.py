"""Deploy runbook, API docs and CI workflow checks for stage-7 photo capture."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_RUNBOOK = REPO_ROOT / 'docs' / 'photo-capture-deploy.md'
API_MD = REPO_ROOT / 'docs' / 'api.md'
README_PATH = REPO_ROOT / 'README.md'
PACKAGE_JSON = REPO_ROOT / 'package.json'
WORKFLOW = REPO_ROOT / '.github' / 'workflows' / 'photo-capture.yml'
YEARLY_WORKFLOW = REPO_ROOT / '.github' / 'workflows' / 'yearly-db-archive.yml'
SCALE_WORKFLOW = REPO_ROOT / '.github' / 'workflows' / 'scale-adapters.yml'
ACCEPTANCE = REPO_ROOT / 'docs' / 'reports' / 'photo-capture' / 'photo-capture-acceptance.md'
RELEASE_CHECKLIST = REPO_ROOT / 'docs' / 'reports' / 'photo-capture' / 'release-checklist.md'
REQUIREMENTS_FULL = REPO_ROOT / 'server' / 'requirements-full.txt'
FULL_SPEC = REPO_ROOT / 'installer' / 'weighing-system-full.spec'
FULL_ISS = REPO_ROOT / 'installer' / 'weighing-system-full.iss'


def _read(path: Path) -> str:
    """Read UTF-8 text file from repository root."""
    return path.read_text(encoding='utf-8')


def test_deploy_runbook_contains_required_stage7_sections():
    """TC-UNIT-01 / TC-E2E-03: deploy runbook covers migration v7, degrade, Photo path."""
    text = _read(DEPLOY_RUNBOOK)

    required_headings = [
        '## Подготовка окружения',
        '## Preflight / Backup перед обновлением',
        '## Установка basic / full',
        '## Миграция schema v7',
        '## Включение video и настройка камер (full)',
        '## Проверка capture / degrade',
        '## Rollback',
        '## Секреты и запреты для git / CI',
    ]
    for heading in required_headings:
        assert heading in text, f'Missing runbook section: {heading}'

    required_tokens = [
        'Photo/',
        'рядом с',
        '_MEIPASS',
        'user_version = 7',
        'migrate_schema_stage_7',
        'video_enabled',
        'degrade',
        'WeighingSystem-Setup.exe',
        'WeighingSystem-Full-Setup.exe',
        'requirements-full.txt',
        'smoke:photo-capture-degrade',
        'smoke:photo-basic-import',
        'smoke:photo-full-import',
        'Rollback',
        'RTSP',
        'в коммитах',
        'бинарников',
        'ANPR',
        'вне скоупа',
        'BD/weighing-ГГГГ.db',
        'config.ini',
        'backup/',
    ]
    for token in required_tokens:
        assert token in text, f'Runbook missing required token: {token}'


def test_api_md_documents_cameras_and_photos():
    """TC-UNIT-02: docs/api.md documents cameras capture and photos GET."""
    text = _read(API_MD)

    assert '## Cameras & Photos' in text
    assert '/api/cameras/capture' in text
    assert '/api/photos/' in text
    assert '/api/cameras/capability' in text
    assert '/api/cameras/snapshot' in text
    assert '/api/cameras/test' in text
    assert '/api/cameras/etalon' in text
    assert 'video_enabled' in text
    assert 'camera_capture_timeout_sec' in text
    assert 'camera_jpeg_quality' in text


def test_readme_links_dual_setup_and_photo_deploy():
    """README points operators to dual packaging and photo-capture-deploy runbook."""
    readme = _read(README_PATH)
    package = json.loads(_read(PACKAGE_JSON))
    scripts = package.get('scripts', {})

    assert 'photo-capture-deploy.md' in readme
    assert 'WeighingSystem-Full-Setup.exe' in readme
    assert 'Photo/' in readme
    assert 'smoke:photo-basic-import' in readme or 'smoke:photo-capability' in readme

    for script_name in (
        'test:stage7',
        'test:stage7-backend',
        'test:stage7-frontend',
        'smoke:photo-basic-import',
        'smoke:photo-full-import',
        'build:win:full',
    ):
        assert script_name in scripts, f'Missing package.json script: {script_name}'

    assert 'test_photo_capture_deploy_docs.py' in scripts['test:stage7-backend']


def test_ci_workflow_contains_basic_and_full_smoke_jobs():
    """TC-E2E-01: photo-capture.yml distinguishes basic and full import-smoke jobs."""
    text = _read(WORKFLOW)

    assert 'name: import-smoke-basic' in text or 'import-smoke-basic:' in text
    assert 'name: import-smoke-full' in text or 'import-smoke-full:' in text
    assert 'smoke:photo-basic-import' in text
    assert 'smoke:photo-full-import' in text
    assert 'requirements-full.txt' in text
    assert 'test:stage7-frontend' in text
    assert 'test:stage7-backend' in text
    assert 'evidence-gate' in text
    assert 'windows-package' in text
    assert 'build:win:exe' in text
    assert 'build:win:full:exe' in text


def test_release_gate_artifacts_exist_for_stage7():
    """TC-E2E-02: release-gate artifacts include full packaging and smoke modes."""
    assert REQUIREMENTS_FULL.is_file() and REQUIREMENTS_FULL.stat().st_size > 0
    assert FULL_SPEC.is_file() and FULL_SPEC.stat().st_size > 0
    assert FULL_ISS.is_file() and FULL_ISS.stat().st_size > 0
    assert ACCEPTANCE.is_file() and ACCEPTANCE.stat().st_size > 0
    assert RELEASE_CHECKLIST.is_file() and RELEASE_CHECKLIST.stat().st_size > 0

    checklist = _read(RELEASE_CHECKLIST)
    assert 'requirements-full.txt' in checklist
    assert 'WeighingSystem-Full-Setup' in checklist or 'build:win:full' in checklist
    assert 'basic-import' in checklist
    assert 'full-import' in checklist
    assert 'import-smoke-basic' in checklist
    assert 'import-smoke-full' in checklist

    acceptance = _read(ACCEPTANCE)
    for ec_id in (
        'EC-01',
        'EC-02',
        'EC-03',
        'EC-04',
        'EC-05',
        'EC-06',
        'EC-07',
        'EC-08',
        'EC-09',
        'EC-10',
        'EC-11',
        'EC-12',
    ):
        assert f'| {ec_id} | PASS |' in acceptance, f'Acceptance missing PASS row for {ec_id}'
    assert '| FAIL |' not in acceptance


def test_stage5_and_stage6_workflows_untouched_by_photo_capture_file():
    """Regression: stage5/stage6 workflow files remain present and distinct."""
    assert SCALE_WORKFLOW.is_file()
    assert YEARLY_WORKFLOW.is_file()
    assert WORKFLOW.is_file()

    scale = _read(SCALE_WORKFLOW)
    yearly = _read(YEARLY_WORKFLOW)
    photo = _read(WORKFLOW)

    assert 'Scale Adapters Gate' in scale
    assert 'Yearly DB Archive Gate' in yearly
    assert 'Photo Capture Gate' in photo
    assert 'import-smoke-basic' not in yearly
    assert 'import-smoke-full' not in scale
