"""Stage-7 stub skeleton: capability, capture noop, photos 404, video defaults."""

from __future__ import annotations

import json
import socket
import subprocess
import time
from pathlib import Path

import cameras
import persistence


def _seed_operator_session(api_client, *, role: str = 'user') -> None:
    """Persist an active operator session for camera API stubs."""
    session_payload = json.dumps(
        {
            'user': {'id': 'stage7-skel-op', 'username': 'operator'},
            'profile': {
                'username': 'operator',
                'display_name': 'Оператор',
                'role': role,
            },
        },
        ensure_ascii=False,
    )
    response = api_client.post(
        '/api/database',
        json={'data': {'app_current_user': session_payload}},
    )
    assert response.status_code == 200


def _ticket_row(**overrides):
    """Minimal completed weighing ticket with weight fields."""
    base = {
        'id': 't-stage7-anchor',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Иванов И.И.',
        'cargo_name': 'Грунт',
        'shipper_name': 'Отправитель',
        'receiver_name': 'Получатель',
        'carrier_name': 'Перевозчик',
        'price': 100,
        'vat_rate': 0,
        'gross_weight': 20000,
        'tare_weight': 8000,
        'net_weight': 12000,
        'total_amount': 1200,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-31T10:00:00',
        'tare_datetime': '2026-07-31T10:05:00',
        'scale_device': 'test',
        'manual_weight_reason': None,
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-07-31T10:00:00',
        'completed_at': '2026-07-31T10:05:00',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': 'directory',
        'site_id': 'default-site',
        'scale_id': 's-primary',
        'scale_role': 'primary',
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    base.update(overrides)
    return base


def test_cameras_capability_live(api_client, temp_app_root):
    """TC-E2E-01: live GET /api/cameras/capability without mocking Flask internals."""
    response = api_client.get('/api/cameras/capability')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert 'available' in payload
    assert payload['build'] in ('basic', 'full')
    assert payload['opencv'] is payload['available']
    assert payload['available'] is cameras.is_camera_module_available()


def test_cameras_capture_noop_when_video_disabled(api_client, temp_app_root):
    """TC-E2E-02: POST /api/cameras/capture returns noop on stub / no enabled cameras."""
    _seed_operator_session(api_client)
    response = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': 't-noop', 'event': 'gross'},
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['noop'] is True
    assert payload['results'] == []
    assert payload['ticket_photos'] == []
    assert payload['capture_token']
    assert isinstance(payload['capture_token'], str)


def test_photos_missing_file_returns_404(api_client, temp_app_root):
    """GET /api/photos/<path> returns 404 when JPEG is absent (stub stage)."""
    response = api_client.get(
        '/api/photos/Photo/2026/07/31/missing.jpg',
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert response.status_code == 404
    payload = response.get_json()
    assert payload['success'] is False
    assert payload['code'] == 'not_found'


def test_weight_plus_capture_stub_keeps_ticket(api_client, temp_app_root):
    """TC-E2E-04 no-mock: ticket via /api/database + capture stub keeps weight."""
    ticket = _ticket_row()
    session_payload = json.dumps(
        {
            'user': {'id': 'stage7-anchor', 'username': 'operator'},
            'profile': {
                'username': 'operator',
                'display_name': 'Оператор',
                'role': 'user',
            },
        },
        ensure_ascii=False,
    )
    save = api_client.post(
        '/api/database',
        json={
            'data': {
                'app_current_user': session_payload,
                'app_weighing_tickets': json.dumps([ticket], ensure_ascii=False),
            }
        },
    )
    assert save.status_code == 200

    capture = api_client.post(
        '/api/cameras/capture',
        json={'ticket_id': ticket['id'], 'event': 'gross'},
        headers={'Origin': 'http://127.0.0.1:5001'},
    )
    assert capture.status_code == 200
    capture_body = capture.get_json()
    assert capture_body['noop'] is True
    assert capture_body['capture_token']
    assert isinstance(capture_body['capture_token'], str)

    loaded = api_client.get('/api/database').get_json()['data']
    tickets = json.loads(loaded['app_weighing_tickets'])
    assert len(tickets) == 1
    assert tickets[0]['id'] == ticket['id']
    assert tickets[0]['gross_weight'] == 20000
    assert tickets[0]['tare_weight'] == 8000
    assert tickets[0]['net_weight'] == 12000
    assert tickets[0]['status'] == 'completed'


def test_config_video_defaults_unit(temp_app_root):
    """TC-UNIT-01: read_config fills video_enabled / timeout / quality defaults."""
    config = persistence.read_config()
    assert config['video_enabled'] == 'false'
    assert config['camera_capture_timeout_sec'] == '3'
    assert config['camera_jpeg_quality'] == '80'


def _pick_free_port() -> int:
    """Bind ephemeral port and return it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def _wait_for_health(base_url: str, *, timeout_sec: float = 20.0) -> None:
    """Poll capability endpoint until Flask answers."""
    import urllib.error
    import urllib.request

    deadline = time.time() + timeout_sec
    url = f'{base_url.rstrip("/")}/api/cameras/capability'
    last_error = ''
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = str(exc)
            time.sleep(0.25)
    raise AssertionError(f'Flask did not become ready: {last_error}')


def test_smoke_photo_capture_cli_help_and_mode_validation():
    """TC-UNIT-02: smoke_photo_capture.py --help and invalid mode exit non-zero."""
    repo_root = Path(__file__).resolve().parents[2]
    python_bin = repo_root / '.venv' / 'bin' / 'python'
    if not python_bin.is_file():
        python_bin = Path('python3')

    help_run = subprocess.run(
        [str(python_bin), 'scripts/smoke_photo_capture.py', '--help'],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    assert help_run.returncode == 0
    help_text = help_run.stdout + help_run.stderr
    for mode in (
        'capability',
        'capture-noop',
        'basic-import',
        'capture-http',
        'capture-degrade',
        'full-import',
    ):
        assert mode in help_text

    bad_mode = subprocess.run(
        [str(python_bin), 'scripts/smoke_photo_capture.py', '--mode', 'not-a-mode'],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    assert bad_mode.returncode != 0


def test_smoke_photo_capability_against_live_flask(tmp_path):
    """Production-like smoke: capability mode against real server/app.py entrypoint."""
    repo_root = Path(__file__).resolve().parents[2]
    python_bin = repo_root / '.venv' / 'bin' / 'python'
    if not python_bin.is_file():
        python_bin = Path('python3')

    import os

    port = _pick_free_port()
    base_url = f'http://127.0.0.1:{port}'
    env = os.environ.copy()
    env['OPEN_BROWSER'] = '0'
    env['PORT'] = str(port)

    server = subprocess.Popen(
        [str(python_bin), 'server/app.py'],
        cwd=repo_root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_health(base_url)
        smoke = subprocess.run(
            [
                str(python_bin),
                'scripts/smoke_photo_capture.py',
                '--mode',
                'capability',
                '--base-url',
                base_url,
                '--origin',
                'http://127.0.0.1:5001',
            ],
            cwd=repo_root,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        assert smoke.returncode == 0, smoke.stdout + smoke.stderr
        report = json.loads(smoke.stdout.strip().splitlines()[-1])
        assert report['summary']['all_steps_passed'] is True
        assert report['mode'] == 'capability'
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


def test_smoke_photo_capture_noop_against_live_flask():
    """Production-like smoke: capture-noop against real server/app.py entrypoint."""
    import os

    repo_root = Path(__file__).resolve().parents[2]
    python_bin = repo_root / '.venv' / 'bin' / 'python'
    if not python_bin.is_file():
        python_bin = Path('python3')

    port = _pick_free_port()
    base_url = f'http://127.0.0.1:{port}'
    env = os.environ.copy()
    env['OPEN_BROWSER'] = '0'
    env['PORT'] = str(port)

    server = subprocess.Popen(
        [str(python_bin), 'server/app.py'],
        cwd=repo_root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_health(base_url)
        smoke = subprocess.run(
            [
                str(python_bin),
                'scripts/smoke_photo_capture.py',
                '--mode',
                'capture-noop',
                '--base-url',
                base_url,
                '--origin',
                'http://127.0.0.1:5001',
            ],
            cwd=repo_root,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        assert smoke.returncode == 0, smoke.stdout + smoke.stderr
        report = json.loads(smoke.stdout.strip().splitlines()[-1])
        assert report['summary']['all_steps_passed'] is True
        assert report['mode'] == 'capture-noop'
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


def _run_smoke_mode(mode: str, *, extra_args: list[str] | None = None) -> tuple[int, dict]:
    """Invoke smoke_photo_capture.py for a mode; return (exit_code, report)."""
    repo_root = Path(__file__).resolve().parents[2]
    python_bin = repo_root / '.venv' / 'bin' / 'python'
    if not python_bin.is_file():
        python_bin = Path('python3')
    cmd = [
        str(python_bin),
        'scripts/smoke_photo_capture.py',
        '--mode',
        mode,
        '--origin',
        'http://127.0.0.1:5001',
    ]
    if extra_args:
        cmd.extend(extra_args)
    completed = subprocess.run(
        cmd,
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    lines = [line for line in completed.stdout.strip().splitlines() if line.strip()]
    assert lines, f'no stdout from smoke mode={mode}: stderr={completed.stderr}'
    report = json.loads(lines[-1])
    return completed.returncode, report


def test_smoke_photo_capture_http_isolated():
    """TC-E2E-01: capture-http against isolated live Flask + local JPEG fixture."""
    code, report = _run_smoke_mode('capture-http')
    assert code == 0, report
    assert report['mode'] == 'capture-http'
    assert report['summary']['all_steps_passed'] is True
    capture_step = next(s for s in report['steps'] if s['name'] == 'capture_http')
    body = capture_step['body']
    assert body['noop'] is False
    assert body['photo_entry_path']
    assert all(p['status'] == 'success' for p in body['ticket_photos'])


def test_smoke_photo_capture_degrade_keeps_weight():
    """TC-E2E-02: capture-degrade → ticket/weight OK + failed photos."""
    code, report = _run_smoke_mode('capture-degrade')
    assert code == 0, report
    assert report['mode'] == 'capture-degrade'
    assert report['summary']['all_steps_passed'] is True
    capture_step = next(s for s in report['steps'] if s['name'] == 'capture_degrade')
    body = capture_step['body']
    assert body['success'] is True
    assert body['noop'] is False
    assert any(r.get('status') == 'failed' for r in body.get('results') or [])


def test_smoke_photo_basic_import_no_cv2():
    """TC-E2E-03: basic-import entrypoint does not require cv2."""
    code, report = _run_smoke_mode('basic-import')
    assert code == 0, report
    assert report['summary']['all_steps_passed'] is True
    assert report['steps'][0]['ok'] is True


def test_smoke_photo_full_import_gate():
    """TC-E2E-04: full-import requires cv2; fails clearly when missing."""
    code, report = _run_smoke_mode('full-import')
    repo_root = Path(__file__).resolve().parents[2]
    python_bin = repo_root / '.venv' / 'bin' / 'python'
    if not python_bin.is_file():
        python_bin = Path('python3')
    probe = subprocess.run(
        [str(python_bin), '-c', 'import cv2'],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    cv2_present = probe.returncode == 0

    if cv2_present:
        assert code == 0, report
        assert report['summary']['all_steps_passed'] is True
    else:
        assert code != 0
        assert report['summary']['all_steps_passed'] is False
        err = report['steps'][0].get('error') or ''
        assert 'cv2' in err.lower() or 'opencv' in err.lower() or 'missing' in err.lower()
