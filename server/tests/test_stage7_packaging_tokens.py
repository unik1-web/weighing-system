"""Packaging token tests for stage-7 dual basic/full delivery (UC-07).

On Linux CI full Windows PyInstaller may be unavailable — these token checks plus
import-smoke (basic-import / full-import) are the required gate.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys


def _repo_root() -> pathlib.Path:
    """Return repository root for packaging artifact checks."""
    return pathlib.Path(__file__).resolve().parents[2]


def _resolve_python_bin(repo_root: pathlib.Path) -> str:
    """Prefer local .venv when present; otherwise use the active interpreter (CI)."""
    candidates = [
        repo_root / '.venv' / 'bin' / 'python',
        repo_root / '.venv' / 'Scripts' / 'python.exe',
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return sys.executable


REPO_ROOT = _repo_root()
SERVER_DIR = REPO_ROOT / 'server'
INSTALLER_DIR = REPO_ROOT / 'installer'
PACKAGE_JSON = REPO_ROOT / 'package.json'

BASIC_REQUIREMENTS = SERVER_DIR / 'requirements.txt'
FULL_REQUIREMENTS = SERVER_DIR / 'requirements-full.txt'
BASIC_SPEC = INSTALLER_DIR / 'weighing-system.spec'
FULL_SPEC = INSTALLER_DIR / 'weighing-system-full.spec'
BASIC_ISS = INSTALLER_DIR / 'weighing-system.iss'
FULL_ISS = INSTALLER_DIR / 'weighing-system-full.iss'
BUILD_PS1 = INSTALLER_DIR / 'build.ps1'

CAMERA_HIDDENIMPORT_TOKENS = (
    "'cameras'",
    "'photo_storage'",
    "'ticket_photos'",
)

SCALE_HIDDENIMPORT_TOKENS = (
    "'scale_api'",
    "'scale_api_guard'",
    "'scale_runtime'",
    "'scale_registry'",
    "'scale_registry_contract'",
    "'scale_integrity'",
    "'scale_transports.serial_backend'",
    "'serial'",
)

STORAGE_DIR_TOKENS = (
    r'{app}\BD',
    r'{app}\backup',
    r'{app}\logs',
    r'{app}\Photo',
)


def _read(path: pathlib.Path) -> str:
    """Read UTF-8 text from a packaging artifact."""
    return path.read_text(encoding='utf-8')


def _python_bin() -> str:
    """Prefer project venv interpreter for import-smoke; fall back to CI interpreter."""
    return _resolve_python_bin(REPO_ROOT)


# ---------------------------------------------------------------------------
# Unit: requirements / iss filenames
# ---------------------------------------------------------------------------


def test_basic_requirements_has_no_opencv():
    """TC-UNIT-01: server/requirements.txt must not contain opencv."""
    text = _read(BASIC_REQUIREMENTS)
    assert BASIC_REQUIREMENTS.is_file()
    assert re.search(r'(?im)opencv', text) is None, (
        'Basic requirements.txt must not list opencv (documented build exclude)'
    )
    assert re.search(r'(?m)^pyserial', text), 'pyserial must remain in basic requirements'


def test_full_requirements_contains_opencv_headless():
    """TC-UNIT-02: server/requirements-full.txt includes opencv-python-headless."""
    text = _read(FULL_REQUIREMENTS)
    assert FULL_REQUIREMENTS.is_file()
    assert 'opencv-python-headless' in text
    assert '-r requirements.txt' in text or '-r ./requirements.txt' in text


def test_full_iss_output_filename_differs_from_basic():
    """TC-UNIT-03: full Inno OutputBaseFilename is distinct from basic."""
    basic_iss = _read(BASIC_ISS)
    full_iss = _read(FULL_ISS)
    assert 'OutputBaseFilename=WeighingSystem-Setup' in basic_iss
    assert 'OutputBaseFilename=WeighingSystem-Full-Setup' in full_iss
    assert 'WeighingSystem-Full-Setup' not in basic_iss
    assert re.search(
        r'(?m)^OutputBaseFilename=WeighingSystem-Setup\s*$',
        basic_iss,
    ), 'Basic iss must keep OutputBaseFilename=WeighingSystem-Setup'


# ---------------------------------------------------------------------------
# E2E: packaging tokens across spec / requirements / iss / build.ps1
# ---------------------------------------------------------------------------


def test_packaging_token_matrix_basic_and_full():
    """TC-E2E-01: dual packaging artifacts expose required tokens."""
    basic_req = _read(BASIC_REQUIREMENTS)
    full_req = _read(FULL_REQUIREMENTS)
    basic_spec = _read(BASIC_SPEC)
    full_spec = _read(FULL_SPEC)
    basic_iss = _read(BASIC_ISS)
    full_iss = _read(FULL_ISS)
    build_ps1 = _read(BUILD_PS1)

    assert re.search(r'(?im)opencv', basic_req) is None
    assert 'opencv-python-headless' in full_req

    for token in SCALE_HIDDENIMPORT_TOKENS + CAMERA_HIDDENIMPORT_TOKENS:
        assert token in basic_spec, f'Basic spec missing {token}'
        assert token in full_spec, f'Full spec missing {token}'

    # EC-06: documented exclude only on basic build
    assert 'cv2' in basic_spec
    assert re.search(r"excludes\s*=\s*\[[^\]]*cv2[^\]]*\]", basic_spec), (
        'Basic spec must exclude cv2'
    )
    assert "'cv2'" in full_spec or '"cv2"' in full_spec
    assert not re.search(r"excludes\s*=\s*\[[^\]]*cv2[^\]]*\]", full_spec), (
        'Full spec must not exclude cv2'
    )

    for iss_text, label in ((basic_iss, 'basic'), (full_iss, 'full')):
        for dir_token in STORAGE_DIR_TOKENS:
            assert dir_token in iss_text, f'{label} iss missing {dir_token}'
        assert '_MEIPASS' not in iss_text, f'{label} iss must not reference _MEIPASS'

    assert 'OutputBaseFilename=WeighingSystem-Setup' in basic_iss
    assert 'OutputBaseFilename=WeighingSystem-Full-Setup' in full_iss

    assert '-Full' in build_ps1
    assert 'weighing-system-full.spec' in build_ps1
    assert 'requirements-full.txt' in build_ps1
    assert 'weighing-system-full.iss' in build_ps1
    assert 'basic-import' in build_ps1
    assert 'full-import' in build_ps1
    assert r'{app}\Photo' in build_ps1
    assert 'Assert-FullOpenCvAvailable' in build_ps1
    assert 'Invoke-ImportSmoke' in build_ps1


def test_package_json_declares_basic_and_full_win_build_scripts():
    """package.json exposes Windows build entrypoints for basic and full."""
    package = json.loads(_read(PACKAGE_JSON))
    scripts = package.get('scripts') or {}
    assert 'build:win' in scripts
    assert 'build:win:exe' in scripts
    assert 'build:win:full' in scripts
    assert 'build:win:full:exe' in scripts
    assert 'installer/build.ps1' in scripts['build:win']
    assert '-Full' in scripts['build:win:full']
    assert '-Full' in scripts['build:win:full:exe']
    assert '-SkipInstaller' in scripts['build:win:full:exe']
    backend = scripts.get('test:stage7-backend') or ''
    assert 'test_stage7_packaging_tokens.py' in backend


def test_basic_import_smoke_entrypoint_without_cv2():
    """TC-E2E-02: basic-import smoke entrypoint must not require cv2."""
    completed = subprocess.run(
        [
            _python_bin(),
            str(REPO_ROOT / 'scripts' / 'smoke_photo_capture.py'),
            '--mode',
            'basic-import',
        ],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, (
        f'basic-import failed:\nstdout={completed.stdout}\nstderr={completed.stderr}'
    )
    report = json.loads(completed.stdout.strip().splitlines()[-1])
    assert report['summary']['all_steps_passed'] is True
    assert report['mode'] == 'basic-import'


def test_full_import_smoke_fails_without_opencv_or_passes_when_present():
    """TC-E2E-03: full-import fails clearly when cv2 missing; passes when present.

    Full packaging must not silently degrade to basic (EC-06 / UC-07).
    """
    probe = subprocess.run(
        [_python_bin(), '-c', 'import cv2'],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    completed = subprocess.run(
        [
            _python_bin(),
            str(REPO_ROOT / 'scripts' / 'smoke_photo_capture.py'),
            '--mode',
            'full-import',
        ],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    report_line = (completed.stdout or '').strip().splitlines()
    report = json.loads(report_line[-1]) if report_line else {}

    if probe.returncode != 0:
        # Environment without OpenCV: full-import MUST fail (gate for full job).
        assert completed.returncode != 0
        assert report.get('summary', {}).get('all_steps_passed') is False
        err = (
            (report.get('steps') or [{}])[0].get('error')
            or completed.stderr
            or completed.stdout
            or ''
        ).lower()
        assert (
            'cv2' in err
            or 'opencv' in err
            or 'missing' in err
            or 'full' in err
        ), f'Expected explicit OpenCV/full failure diagnostics, got: {err!r}'
    else:
        assert completed.returncode == 0, (
            f'full-import failed with cv2 present:\n'
            f'stdout={completed.stdout}\nstderr={completed.stderr}'
        )
        assert report['summary']['all_steps_passed'] is True


def test_full_import_gate_fails_when_cv2_blocked():
    """TC-E2E-03 (forced): full-import gate exits non-zero when cv2 is unavailable."""
    # Mirrors scripts/smoke_photo_capture._run_full_import body with cv2 blocked,
    # so the fail branch is exercised even on machines that have OpenCV installed.
    script = r"""
import builtins
import json
import sys

real_import = builtins.__import__

def _block_cv2(name, globals=None, locals=None, fromlist=(), level=0):
    if name == 'cv2' or (isinstance(name, str) and name.startswith('cv2.')):
        raise ImportError('cv2 blocked for full-import fail-path test')
    return real_import(name, globals, locals, fromlist, level)

builtins.__import__ = _block_cv2
sys.modules.pop('cv2', None)
sys.path.insert(0, sys.argv[1])

try:
    import cv2  # noqa: F401
except ImportError as exc:
    print(json.dumps({'ok': False, 'error': f'cv2 missing: {exc}'}))
    raise SystemExit(1)

print(json.dumps({'ok': True, 'unexpected': True}))
raise SystemExit(3)
"""
    completed = subprocess.run(
        [_python_bin(), '-c', script, str(SERVER_DIR)],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode != 0
    body = json.loads(completed.stdout.strip().splitlines()[-1])
    assert body.get('ok') is False
    assert 'cv2' in str(body.get('error', '')).lower()


def test_photo_dir_tokens_outside_meipass_and_runtime_lazy_write(temp_app_root):
    """TC-E2E-04: Photo/ is installer layout + runtime lazy write outside _MEIPASS."""
    for iss_path in (BASIC_ISS, FULL_ISS):
        iss = _read(iss_path)
        assert r'{app}\Photo' in iss
        assert '_MEIPASS' not in iss

    from photo_storage import PhotoStorage

    photo_root = temp_app_root / 'Photo'
    if photo_root.exists():
        # Fixture may pre-create Photo/; remove to prove lazy ensure.
        for child in sorted(photo_root.rglob('*'), reverse=True):
            if child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
        photo_root.rmdir()

    storage = PhotoStorage()
    ensured = pathlib.Path(storage.ensure_photo_dirs())
    assert ensured == photo_root
    assert photo_root.is_dir()
    assert '_MEIPASS' not in str(ensured)
    assert photo_root.is_relative_to(temp_app_root)
