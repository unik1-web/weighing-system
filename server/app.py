import logging
import json
import os
import re
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any

import requests
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS

try:
    import fdb
except ImportError:  # pragma: no cover - optional until Vescom is used
    fdb = None

from browse import browse_path
from dictionary_import import format_import_message, merge_dictionaries
from metra import (
    fetch_metra_dictionary_names,
    fetch_metra_items,
    metra_dictionary_warning,
    resolve_metra_db_dir,
    resolve_metra_db_path,
    test_metra_connection,
)
from persistence import (
    backup_to_ini,
    build_backup,
    get_app_root,
    get_storage_paths,
    import_backup,
    import_backup_file,
    read_active_year,
    read_config,
    read_database,
    register_runtime_invalidator,
    write_config,
)
from vescom import connect_vescom, fetch_vescom_dictionaries, fetch_vescom_weighings
from wa import (
    fetch_wa_dictionary_names,
    fetch_wa_items,
    resolve_wa_db_path,
    test_wa_connection,
)
from reo_client import (
    build_reo_test_payload,
    format_reo_error,
    is_reo_test_successful,
    post_reo_import,
)
from scale_api import invalidate_for_database_payload, register_scale_api
from scale_registry_contract import validate_portable_regex
from archive_edit_service import apply_archive_edit
from archive_service import get_archive_ticket, get_archive_tickets, list_archive_years
from active_year_service import read_active_storage, write_active_storage
from stage6_logging import log_stage6_event
from year_rotation import commit_rotation, preview_rotation
from year_rotation import ensure_stage6_storage_bootstrap
from year_context import (
    ArchiveContractError,
    RotationContractError,
    assert_active_db_write_allowed,
    validate_archive_year,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, 'frozen', False):
    DIST_DIR = os.path.join(sys._MEIPASS, 'dist')
    LOG_DIR = os.path.join(get_app_root(), 'logs')
else:
    DIST_DIR = os.path.abspath(os.path.join(BASE_DIR, '..', 'dist'))
    LOG_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

LOG_FORMAT = '%(asctime)s - %(levelname)s - %(name)s - %(message)s'
logger = logging.getLogger('weighing-system-api')
logger.setLevel(logging.INFO)

_IP_RE = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
_TTY_RE = re.compile(r'/dev/tty[^\s"\'`]+', re.IGNORECASE)
_COM_RE = re.compile(r'\bCOM\d+\b', re.IGNORECASE)

console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter(LOG_FORMAT))

file_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, 'app.log'),
    maxBytes=2_000_000,
    backupCount=5,
    encoding='utf-8',
)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT))

if not logger.handlers:
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)


def _redact_scale_runtime_value(value):
    if isinstance(value, str):
        value = _COM_RE.sub('COM***', value)
        value = _TTY_RE.sub('/dev/tty***', value)
        return _IP_RE.sub('***.***.***.***', value)
    if isinstance(value, list):
        return [_redact_scale_runtime_value(item) for item in value]
    if isinstance(value, dict):
        return {k: _redact_scale_runtime_value(v) for k, v in value.items()}
    return value


def log_scale_runtime_event(event: str, *, level: int = logging.INFO, **context):
    payload = {'event': event, **_redact_scale_runtime_value(context)}
    logger.log(level, 'scale_runtime %s', json.dumps(payload, ensure_ascii=False))

app = Flask(__name__)
CORS(app, resources={r'/api/(?!scales).*': {'origins': '*'}})


@app.before_request
def log_request_start():
    g.request_started_at = time.time()
    logger.info('HTTP %s %s', request.method, request.path)
    if request.path.startswith('/api/scales'):
        log_scale_runtime_event('api_request_start', path=request.path, method=request.method)


@app.after_request
def log_request_end(response):
    started_at = getattr(g, 'request_started_at', None)
    duration_ms = round((time.time() - started_at) * 1000, 1) if started_at else '-'
    logger.info('HTTP %s %s -> %s (%s ms)', request.method, request.path, response.status_code, duration_ms)
    if request.path.startswith('/api/scales'):
        log_scale_runtime_event(
            'api_request_end',
            path=request.path,
            method=request.method,
            status=response.status_code,
            duration_ms=duration_ms,
        )
    return response


def error_response(message: str, status: int = 400):
    logger.warning('API error (%s): %s', status, message)
    return jsonify({'success': False, 'message': message}), status


def scale_error_response(code: str, message: str, status: int):
    logger.warning('Scale API error (%s %s): %s', status, code, message)
    log_scale_runtime_event(
        'api_error',
        level=logging.WARNING,
        code=code,
        status=status,
        message=message,
        path=request.path if request else None,
    )
    return jsonify({'success': False, 'code': code, 'message': message}), status


def stage6_error_response(code: str, message: str, status: int):
    """Return stage-6 contract error payload and emit structured log."""
    logger.warning('Stage6 API error (%s %s): %s', status, code, message)
    log_stage6_event(
        'api_error',
        'error',
        reason=code,
        http_status=status,
        path=request.path if request else None,
        method=request.method if request else None,
        message=message,
    )
    return jsonify({'success': False, 'code': code, 'message': message}), status


def _stage6_request_actor_fields(actor: dict[str, Any] | None) -> dict[str, Any]:
    """Map session actor to stage-6 log operator fields."""
    if not isinstance(actor, dict):
        return {}
    return {
        'operator_id': actor.get('id'),
        'operator_name': actor.get('display_name') or actor.get('username'),
    }


def _read_active_actor() -> dict[str, Any] | None:
    """Read active session actor from persisted `app_current_user` payload."""
    try:
        data = read_active_storage()
    except Exception:
        return None
    raw_session = data.get('app_current_user')
    if (not isinstance(raw_session, str) or not raw_session.strip()):
        try:
            # Backward-compatible fallback for tests/legacy flows that persisted
            # session before active_year was configured.
            raw_session = read_database().get('app_current_user')
        except Exception:
            raw_session = None
    if not isinstance(raw_session, str) or not raw_session.strip():
        return None
    try:
        parsed = json.loads(raw_session)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    user = parsed.get('user') if isinstance(parsed.get('user'), dict) else {}
    profile = parsed.get('profile') if isinstance(parsed.get('profile'), dict) else {}
    role = profile.get('role')
    if role not in ('user', 'admin'):
        return None
    return {
        'id': user.get('id'),
        'username': profile.get('username') or user.get('username'),
        'display_name': profile.get('display_name'),
        'role': role,
    }


def _require_rotation_actor() -> dict[str, Any] | tuple[Any, int]:
    """Validate session for year-rotation endpoints."""
    actor = _read_active_actor()
    if actor is None:
        return stage6_error_response(
            'auth_required',
            'Требуется активная сессия пользователя',
            401,
        )
    if actor.get('role') not in ('user', 'admin'):
        return stage6_error_response(
            'insufficient_permissions',
            'Недостаточно прав для выполнения операции',
            403,
        )
    return actor


def _require_archive_actor() -> dict[str, Any] | tuple[Any, int]:
    """Validate session for archive read/edit endpoints."""
    return _require_rotation_actor()


def _parse_archive_year() -> int:
    """Parse and validate archive year query/body parameter."""
    raw_year = request.args.get('year')
    if raw_year is None and request.is_json:
        body = request.get_json(silent=True) or {}
        raw_year = body.get('year')
    return validate_archive_year(raw_year)


def _validate_generic_regex_in_database_payload(data: dict[str, str]) -> tuple[bool, str | None]:
    scales_blob = data.get('app_scales')
    if not isinstance(scales_blob, str):
        return True, None
    try:
        scales_rows = json.loads(scales_blob)
    except json.JSONDecodeError:
        return False, 'Некорректный JSON в app_scales'
    if not isinstance(scales_rows, list):
        return False, 'app_scales должен быть JSON-массивом'

    for row in scales_rows:
        if not isinstance(row, dict):
            continue
        if row.get('adapter_id') != 'generic-regex':
            continue
        connection = row.get('connection') if isinstance(row.get('connection'), dict) else {}
        parser = connection.get('parser') if isinstance(connection.get('parser'), dict) else {}
        test_frame = parser.get('test_frame')
        validation = validate_portable_regex(
            connection,
            test_frame if isinstance(test_frame, str) and test_frame.strip() else None,
        )
        if not validation.get('valid'):
            code = validation.get('validation_error_code') or 'invalid_connection_config'
            message = validation.get('validation_error_message') or 'Некорректная regex-конфигурация'
            return False, f'{code}: {message}'
        parser = connection.setdefault('parser', {})
        parser['validation_status'] = validation.get('validation_status')
        parser['last_validation_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        parser['validation_error_code'] = validation.get('validation_error_code')
        parser['validation_error_message'] = validation.get('validation_error_message')
        row['connection'] = connection

    data['app_scales'] = json.dumps(scales_rows, ensure_ascii=False)
    return True, None


app.register_blueprint(register_scale_api(scale_error_response))
register_runtime_invalidator(invalidate_for_database_payload)


def frontend_available() -> bool:
    return os.path.isfile(os.path.join(DIST_DIR, 'index.html'))


def normalize_firebird_dsn(db_path: str) -> str:
    return db_path.strip().replace('\\', '/')


def fetch_vescom_rows(db_path: str, date_str: str, user: str, password: str):
    if fdb is None:
        raise RuntimeError(
            'Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt'
        )

    logger.info('Vescom query for date=%s db=%s', date_str, db_path)
    items = fetch_vescom_weighings(db_path, date_str, user, password)
    logger.info('Vescom query completed: %s rows', len(items))
    return items


@app.get('/api/health')
def health():
    return jsonify({'success': True, 'service': 'weighing-system-api'})


@app.post('/api/shutdown')
def shutdown_application():
    shutdown_func = request.environ.get('werkzeug.server.shutdown')

    def _stop() -> None:
        time.sleep(0.4)
        if shutdown_func is not None:
            shutdown_func()
            return
        os._exit(0)

    logger.info('Application shutdown requested from %s', request.remote_addr)
    threading.Thread(target=_stop, daemon=True).start()
    return jsonify({'success': True, 'message': 'Приложение завершает работу'})


@app.get('/api/storage/paths')
def storage_paths():
    return jsonify({'success': True, **get_storage_paths()})


@app.get('/api/archive/years')
def archive_years():
    actor_or_error = _require_archive_actor()
    if isinstance(actor_or_error, tuple):
        return actor_or_error
    actor = actor_or_error
    log_stage6_event(
        'api_archive_years',
        'start',
        path=request.path,
        method=request.method,
        **_stage6_request_actor_fields(actor),
    )
    years = list_archive_years(read_active_year())
    log_stage6_event(
        'api_archive_years',
        'success',
        path=request.path,
        method=request.method,
        year_count=len(years),
        **_stage6_request_actor_fields(actor),
    )
    return jsonify({'success': True, 'years': years})


@app.get('/api/archive/tickets')
def archive_tickets():
    actor_or_error = _require_archive_actor()
    if isinstance(actor_or_error, tuple):
        return actor_or_error
    actor = actor_or_error
    try:
        year = _parse_archive_year()
        log_stage6_event(
            'api_archive_tickets',
            'start',
            source_year=year,
            path=request.path,
            method=request.method,
            **_stage6_request_actor_fields(actor),
        )
        filters = {
            key: value
            for key, value in request.args.items()
            if key != 'year'
        }
        payload = get_archive_tickets(year, filters=filters)
        log_stage6_event(
            'api_archive_tickets',
            'success',
            source_year=year,
            path=request.path,
            method=request.method,
            ticket_count=len(payload.get('tickets') or []),
            **_stage6_request_actor_fields(actor),
        )
        return jsonify(payload)
    except ArchiveContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)


@app.get('/api/archive/tickets/<ticket_id>')
def archive_ticket(ticket_id: str):
    actor_or_error = _require_archive_actor()
    if isinstance(actor_or_error, tuple):
        return actor_or_error
    actor = actor_or_error
    try:
        year = _parse_archive_year()
        log_stage6_event(
            'api_archive_ticket',
            'start',
            source_year=year,
            path=request.path,
            method=request.method,
            ticket_id=ticket_id,
            **_stage6_request_actor_fields(actor),
        )
        payload = get_archive_ticket(year, ticket_id)
        log_stage6_event(
            'api_archive_ticket',
            'success',
            source_year=year,
            path=request.path,
            method=request.method,
            ticket_id=ticket_id,
            **_stage6_request_actor_fields(actor),
        )
        return jsonify(payload)
    except ArchiveContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)


@app.patch('/api/archive/tickets/<ticket_id>')
def archive_ticket_patch(ticket_id: str):
    actor_or_error = _require_archive_actor()
    if isinstance(actor_or_error, tuple):
        return actor_or_error
    actor = actor_or_error
    if actor.get('role') != 'admin':
        return stage6_error_response(
            'insufficient_permissions',
            'Недостаточно прав для выполнения операции',
            403,
        )
    body = request.get_json(silent=True) or {}
    try:
        year = _parse_archive_year()
        patch = body.get('patch')
        if not isinstance(patch, dict):
            log_stage6_event(
                'api_archive_edit',
                'forbidden',
                source_year=year,
                path=request.path,
                method=request.method,
                ticket_id=ticket_id,
                reason='archive_edit_forbidden_field',
                **_stage6_request_actor_fields(actor),
            )
            return stage6_error_response(
                'archive_edit_forbidden_field',
                'Некорректный формат patch',
                422,
            )
        acknowledge = bool(body.get('acknowledge_reo_sent_warning'))
        log_stage6_event(
            'api_archive_edit',
            'start',
            source_year=year,
            path=request.path,
            method=request.method,
            ticket_id=ticket_id,
            **_stage6_request_actor_fields(actor),
        )
        payload = apply_archive_edit(
            year,
            ticket_id,
            patch,
            actor,
            acknowledge,
        )
        log_stage6_event(
            'api_archive_edit',
            'success',
            source_year=year,
            path=request.path,
            method=request.method,
            ticket_id=ticket_id,
            **_stage6_request_actor_fields(actor),
        )
        return jsonify(payload)
    except ArchiveContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)


@app.post('/api/year/rotation/preview')
def year_rotation_preview():
    actor_or_error = _require_rotation_actor()
    if isinstance(actor_or_error, tuple):
        return actor_or_error
    actor = actor_or_error
    body = request.get_json(silent=True) or {}
    body = {**body, 'actor': actor}
    log_stage6_event(
        'api_rotation_preview',
        'start',
        path=request.path,
        method=request.method,
        source_year=body.get('source_year'),
        target_year=body.get('target_year'),
        **_stage6_request_actor_fields(actor),
    )
    try:
        payload = preview_rotation(body)
        log_stage6_event(
            'api_rotation_preview',
            'success',
            path=request.path,
            method=request.method,
            source_year=payload.get('source_year'),
            target_year=payload.get('target_year'),
            open_count=len(payload.get('open_candidates') or []),
            pending_reo_count=payload.get('pending_reo_count'),
            **_stage6_request_actor_fields(actor),
        )
        return jsonify(payload)
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)


@app.post('/api/year/rotation/commit')
def year_rotation_commit():
    actor_or_error = _require_rotation_actor()
    if isinstance(actor_or_error, tuple):
        return actor_or_error
    actor = actor_or_error
    body = request.get_json(silent=True) or {}
    body = {**body, 'actor': actor}
    log_stage6_event(
        'api_rotation_commit',
        'start',
        path=request.path,
        method=request.method,
        source_year=body.get('source_year'),
        target_year=body.get('target_year'),
        **_stage6_request_actor_fields(actor),
    )
    try:
        payload = commit_rotation(body)
        log_stage6_event(
            'api_rotation_commit',
            'success',
            path=request.path,
            method=request.method,
            source_year=payload.get('source_year'),
            target_year=payload.get('target_year'),
            auto_closed_count=payload.get('auto_closed_count'),
            backup_path=payload.get('backup_path'),
            db_path=payload.get('new_db_path'),
            **_stage6_request_actor_fields(actor),
        )
        return jsonify(payload)
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)


@app.get('/api/config')
def get_config():
    try:
        bootstrap = ensure_stage6_storage_bootstrap()
        if bootstrap.get('status') == 'error':
            return jsonify(
                {
                    'success': False,
                    'code': bootstrap.get('code', 'migration_failed'),
                    'message': bootstrap.get('message', 'Ошибка миграции годовой БД'),
                    'bootstrap': bootstrap,
                }
            ), 500
        return jsonify({'success': True, 'config': read_config(), 'bootstrap': bootstrap})
    except Exception as exc:
        logger.exception('Config read failed')
        return error_response(f'Ошибка чтения config.ini: {exc}')


@app.post('/api/config')
def save_config():
    body = request.get_json(silent=True) or {}
    config = body.get('config')
    if not isinstance(config, dict):
        return error_response('Некорректный формат config.ini')

    try:
        write_config(config)
        logger.info('Config saved (%s keys)', len(config))
        return jsonify({'success': True})
    except Exception as exc:
        logger.exception('Config write failed')
        return error_response(f'Ошибка сохранения config.ini: {exc}')


@app.get('/api/database')
def get_database():
    try:
        bootstrap = ensure_stage6_storage_bootstrap()
        if bootstrap.get('status') == 'error':
            return jsonify(
                {
                    'success': False,
                    'code': bootstrap.get('code', 'migration_failed'),
                    'message': bootstrap.get('message', 'Ошибка миграции годовой БД'),
                    'bootstrap': bootstrap,
                }
            ), 500
        return jsonify({'success': True, 'data': read_active_storage()})
    except Exception as exc:
        logger.exception('Database read failed')
        return error_response(f'Ошибка чтения BD/weighing.db: {exc}')


@app.post('/api/database')
def save_database():
    body = request.get_json(silent=True) or {}
    data = body.get('data')
    if not isinstance(data, dict):
        return error_response('Некорректный формат BD/weighing.db')

    try:
        valid_payload, validation_message = _validate_generic_regex_in_database_payload(data)
        if not valid_payload:
            return scale_error_response('invalid_connection_config', validation_message or 'Некорректная конфигурация', 422)
        write_active_storage(data, operation='POST /api/database')
        logger.info('Database saved (%s keys)', len(data))
        return jsonify({'success': True})
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)
    except Exception as exc:
        logger.exception('Database write failed')
        return error_response(f'Ошибка сохранения BD/weighing.db: {exc}')


@app.get('/api/storage')
def get_storage():
    try:
        combined: dict[str, str] = {}
        config = read_config()
        if config:
            combined['app_settings'] = json.dumps(config, ensure_ascii=False)
        combined.update(read_active_storage())
        return jsonify({'success': True, 'data': combined})
    except Exception as exc:
        logger.exception('Storage read failed')
        return error_response(f'Ошибка чтения данных: {exc}')


@app.post('/api/storage')
def save_storage():
    body = request.get_json(silent=True) or {}
    data = body.get('data')
    if not isinstance(data, dict):
        return error_response('Некорректный формат данных')

    safe_data = {
        str(key): value
        for key, value in data.items()
        if str(key).startswith('app_') and isinstance(value, str)
    }

    try:
        config_raw = safe_data.get('app_settings')
        if isinstance(config_raw, str) and config_raw.strip():
            parsed_config = json.loads(config_raw)
            if isinstance(parsed_config, dict):
                write_config({str(key): str(value) for key, value in parsed_config.items()})

        db_payload = {key: value for key, value in safe_data.items() if key != 'app_settings'}
        write_active_storage(db_payload, operation='POST /api/storage')
        logger.info('Storage saved (%s keys)', len(safe_data))
        return jsonify({'success': True})
    except json.JSONDecodeError:
        return error_response('Некорректный формат app_settings')
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)
    except Exception as exc:
        logger.exception('Storage write failed')
        return error_response(f'Ошибка сохранения данных: {exc}')


@app.get('/api/storage/export')
def export_storage():
    try:
        backup = build_backup()
        backup['exported_at'] = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
        content = backup_to_ini(backup)
        return jsonify({'success': True, 'format': 'ini', 'content': content, 'backup': backup})
    except Exception as exc:
        logger.exception('Storage export failed')
        return error_response(f'Ошибка экспорта: {exc}')


@app.post('/api/storage/import')
def import_storage():
    body = request.get_json(silent=True) or {}
    backup = body.get('backup')
    content = body.get('content')

    try:
        assert_active_db_write_allowed('POST /api/storage/import')
        if isinstance(content, str) and content.strip():
            combined = import_backup_file(content, filename=str(body.get('filename') or ''))
        elif isinstance(backup, dict):
            combined = import_backup(backup)
        else:
            return error_response('Некорректный формат резервной копии')

        logger.info('Storage imported (%s keys)', len(combined))
        return jsonify({'success': True, 'data': combined})
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)
    except ValueError as exc:
        return error_response(str(exc))
    except Exception as exc:
        logger.exception('Storage import failed')
        return error_response(f'Ошибка импорта: {exc}')


@app.get('/api/browse')
def browse_filesystem():
    path = (request.args.get('path') or '').strip()
    mode = (request.args.get('mode') or 'file').strip().lower()
    extensions = [
        item.strip()
        for item in (request.args.get('extensions') or '').split(',')
        if item.strip()
    ]

    if mode not in ('file', 'directory'):
        return error_response('Некорректный режим обзора')

    try:
        result = browse_path(path or None, mode=mode, extensions=extensions or None)
        return jsonify({'success': True, **result})
    except FileNotFoundError as exc:
        return error_response(str(exc), 404)
    except PermissionError as exc:
        return error_response(str(exc), 403)
    except Exception as exc:
        logger.exception('Browse failed')
        return error_response(f'Ошибка обзора каталога: {exc}')


@app.post('/api/reo/test')
def reo_test():
    data = request.get_json(silent=True) or {}
    access_key = (data.get('access_key') or '').strip()
    object_url = (data.get('object_url') or '').strip()
    object_id = (data.get('object_id') or 'test').strip()

    if not access_key or not object_url:
        return error_response('Не указаны URL сервиса или ключ доступа')

    try:
        logger.info('REO test connection to %s', object_url)
        payload = build_reo_test_payload(object_id, access_key)
        response = post_reo_import(object_url, payload, filename='data_test.json')
        if is_reo_test_successful(response):
            logger.info('REO test successful (HTTP %s)', response.status_code)
            return jsonify({'success': True, 'message': 'Подключение к РЭО успешно'})
        logger.warning('REO test failed: %s', format_reo_error(response))
        return error_response(f'Ошибка подключения к РЭО: {format_reo_error(response)}')
    except Exception as exc:
        logger.exception('REO test failed')
        return error_response(f'Ошибка подключения к РЭО: {exc}')


@app.post('/api/reo/send')
def reo_send():
    data = request.get_json(silent=True) or {}
    object_url = (data.get('object_url') or '').strip()
    payload = data.get('payload')

    if not object_url:
        return error_response('Не указан URL сервиса РЭО')
    if not isinstance(payload, dict):
        return error_response('Некорректный формат данных для отправки')

    count = len(payload.get('weightControls') or payload.get('WeightControls') or [])
    try:
        assert_active_db_write_allowed('POST /api/reo/send')
        logger.info('REO send request to %s (%s records)', object_url, count)
        filename = f'data_{datetime.now().strftime("%Y-%m-%d")}.json'
        response = post_reo_import(object_url, payload, filename=filename)
        if response.status_code not in (200, 422):
            response.raise_for_status()
        if response.status_code == 422:
            logger.warning('REO send validation error: %s', format_reo_error(response))
            return error_response(f'Ошибка отправки в РЭО: {format_reo_error(response)}')
        logger.info('REO send successful (%s records)', count)
        return jsonify({'success': True, 'sent': count})
    except Exception as exc:
        logger.exception('REO send failed')
        return error_response(f'Ошибка отправки в РЭО: {exc}')


@app.post('/api/vescom/test')
def vescom_test():
    if fdb is None:
        return error_response(
            'Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt'
        )

    data = request.get_json(silent=True) or {}
    db_path = normalize_firebird_dsn(data.get('db_path') or '')
    user = (data.get('user') or 'SYSDBA').strip()
    password = data.get('password') or 'masterkey'

    if not db_path:
        return error_response('Не указан путь к базе данных Vescom')

    try:
        logger.info('Vescom test connection to %s', db_path)
        conn = connect_vescom(db_path, user, password)
        conn.close()
        logger.info('Vescom test successful')
        return jsonify({'success': True, 'message': 'Подключение к базе Vescom успешно'})
    except Exception as exc:
        logger.exception('Vescom test failed')
        return error_response(f'Ошибка подключения к Vescom: {exc}')


@app.get('/api/vescom/weighing_data')
def vescom_weighing_data():
    date_str = (request.args.get('date') or datetime.now().strftime('%Y-%m-%d')).strip()
    db_path = normalize_firebird_dsn(request.args.get('db_path') or '')
    user = (request.args.get('user') or 'SYSDBA').strip()
    password = request.args.get('password') or 'masterkey'

    if not db_path:
        return error_response('Не указан путь к базе данных Vescom')

    try:
        datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return error_response('Некорректная дата')

    try:
        items = fetch_vescom_rows(db_path, date_str, user, password)
        return jsonify({'success': True, 'items': items})
    except Exception as exc:
        logger.exception('Vescom fetch failed')
        return error_response(f'Ошибка чтения Vescom: {exc}')


@app.post('/api/vescom/import_dictionaries')
def vescom_import_dictionaries():
    if fdb is None:
        return error_response(
            'Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt'
        )

    data = request.get_json(silent=True) or {}
    db_path = normalize_firebird_dsn(data.get('db_path') or '')
    user = (data.get('user') or 'SYSDBA').strip()
    password = data.get('password') or 'masterkey'

    if not db_path:
        return error_response('Не указан путь к базе данных Vescom')

    try:
        assert_active_db_write_allowed('POST /api/vescom/import_dictionaries')
        dictionaries = fetch_vescom_dictionaries(db_path, user, password)
        added = merge_dictionaries(dictionaries)
        fetched_total = sum(len(values) for values in dictionaries.values())
        logger.info('Vescom dictionaries imported: fetched=%s added=%s', fetched_total, sum(added.values()))
        message = format_import_message('Vescom', dictionaries, added)
        return jsonify({
            'success': True,
            'message': message,
            'fetched': {key: len(values) for key, values in dictionaries.items()},
            'added': added,
            'data': read_active_storage(),
        })
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)
    except Exception as exc:
        logger.exception('Vescom dictionary import failed')
        return error_response(f'Ошибка импорта справочников Vescom: {exc}')


@app.post('/api/metra/test')
def metra_test():
    data = request.get_json(silent=True) or {}
    db_path = (data.get('db_path') or '').strip()

    if not db_path:
        return error_response('Не указан путь к базе Metra')

    try:
        resolved = resolve_metra_db_path(db_path)
        logger.info('Metra test connection to %s', resolved)
        count = test_metra_connection(db_path)
        logger.info('Metra test successful (%s records)', count)
        return jsonify({
            'success': True,
            'message': f'Подключение к базе Metra успешно ({count} записей)',
            'count': count,
        })
    except Exception as exc:
        logger.exception('Metra test failed')
        return error_response(f'Ошибка подключения к Metra: {exc}')


@app.get('/api/metra/weighing_data')
def metra_weighing_data():
    date_str = (request.args.get('date') or datetime.now().strftime('%Y-%m-%d')).strip()
    db_path = (request.args.get('db_path') or '').strip()

    if not db_path:
        return error_response('Не указан путь к базе Metra')

    try:
        datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return error_response('Некорректная дата')

    try:
        items = fetch_metra_items(db_path, date_str)
        db_dir = resolve_metra_db_dir(db_path)
        warning = metra_dictionary_warning(db_dir) if db_dir else None
        logger.info('Metra fetch completed: %s records for %s', len(items), date_str)
        return jsonify({'success': True, 'items': items, 'warning': warning})
    except Exception as exc:
        logger.exception('Metra fetch failed')
        return error_response(f'Ошибка чтения Metra: {exc}')


@app.post('/api/metra/import_dictionaries')
def metra_import_dictionaries():
    data = request.get_json(silent=True) or {}
    db_path = (data.get('db_path') or '').strip()

    if not db_path:
        return error_response('Не указан путь к базе Metra')

    try:
        assert_active_db_write_allowed('POST /api/metra/import_dictionaries')
        dictionaries = fetch_metra_dictionary_names(db_path)
        added = merge_dictionaries(dictionaries)
        logger.info('Metra dictionaries imported: %s new entries', sum(added.values()))
        return jsonify({
            'success': True,
            'message': format_import_message('Metra', dictionaries, added),
            'fetched': {key: len(values) for key, values in dictionaries.items()},
            'added': added,
            'data': read_active_storage(),
        })
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)
    except Exception as exc:
        logger.exception('Metra dictionary import failed')
        return error_response(f'Ошибка импорта справочников Metra: {exc}')


@app.post('/api/wa/test')
def wa_test():
    data = request.get_json(silent=True) or {}
    db_path = (data.get('db_path') or '').strip()
    user = (data.get('user') or 'SYSDBA').strip()
    password = data.get('password') or 'masterkey'

    if not db_path:
        return error_response('Не указан путь к базе WA')

    try:
        resolved = resolve_wa_db_path(db_path)
        logger.info('WA test connection to %s', resolved)
        count = test_wa_connection(db_path, user, password)
        logger.info('WA test successful (%s records)', count)
        return jsonify({
            'success': True,
            'message': f'Подключение к базе WA успешно ({count} записей)',
            'count': count,
            'resolved_path': resolved,
        })
    except Exception as exc:
        logger.exception('WA test failed')
        return error_response(f'Ошибка подключения к WA: {exc}')


@app.get('/api/wa/weighing_data')
def wa_weighing_data():
    date_str = (request.args.get('date') or datetime.now().strftime('%Y-%m-%d')).strip()
    db_path = (request.args.get('db_path') or '').strip()
    user = (request.args.get('user') or 'SYSDBA').strip()
    password = request.args.get('password') or 'masterkey'

    if not db_path:
        return error_response('Не указан путь к базе WA')

    try:
        datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return error_response('Некорректная дата')

    try:
        items = fetch_wa_items(db_path, date_str, user, password)
        logger.info('WA fetch completed: %s records for %s', len(items), date_str)
        return jsonify({'success': True, 'items': items})
    except Exception as exc:
        logger.exception('WA fetch failed')
        return error_response(f'Ошибка чтения WA: {exc}')


@app.post('/api/wa/import_dictionaries')
def wa_import_dictionaries():
    data = request.get_json(silent=True) or {}
    db_path = (data.get('db_path') or '').strip()
    user = (data.get('user') or 'SYSDBA').strip()
    password = data.get('password') or 'masterkey'

    if not db_path:
        return error_response('Не указан путь к базе WA')

    try:
        assert_active_db_write_allowed('POST /api/wa/import_dictionaries')
        dictionaries = fetch_wa_dictionary_names(db_path, user, password)
        added = merge_dictionaries(dictionaries)
        logger.info('WA dictionaries imported: %s new entries', sum(added.values()))
        return jsonify({
            'success': True,
            'message': format_import_message('WA', dictionaries, added),
            'fetched': {key: len(values) for key, values in dictionaries.items()},
            'added': added,
            'data': read_active_storage(),
        })
    except RotationContractError as exc:
        return stage6_error_response(exc.code, exc.message, exc.status)
    except Exception as exc:
        logger.exception('WA dictionary import failed')
        return error_response(f'Ошибка импорта справочников WA: {exc}')


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path: str):
    if path.startswith('api/'):
        return error_response('API endpoint not found', 404)

    if not frontend_available():
        return (
            'Frontend не собран. Выполните: npm install && npm run build',
            503,
            {'Content-Type': 'text/plain; charset=utf-8'},
        )

    if path:
        asset_path = os.path.join(DIST_DIR, path)
        if os.path.isfile(asset_path):
            response = send_from_directory(DIST_DIR, path)
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
            return response

    response = send_from_directory(DIST_DIR, 'index.html')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '5001'))
    debug = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes')
    url = f'http://{host}:{port}'

    if frontend_available():
        logger.info('Serving frontend from %s', DIST_DIR)
    else:
        logger.warning('Frontend not found at %s — API-only mode', DIST_DIR)

    logger.info('Starting weighing-system on %s', url)
    logger.info('API browse endpoint: %s/api/browse', url)
    if frontend_available() and os.environ.get('OPEN_BROWSER', '1') not in ('0', 'false', 'no'):
        webbrowser.open(url)

    app.run(host=host, port=port, debug=debug)
