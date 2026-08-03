import logging
import json
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime
from logging.handlers import RotatingFileHandler

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
    read_combined_storage,
    read_config,
    read_database,
    write_combined_storage,
    write_config,
    write_database,
)
import year_db
import year_rotation
from sqlite_store import read_database_at
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
from scale_io import get_active_scale_context_from_db, get_scale_session

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

app = Flask(__name__)
CORS(app)


@app.before_request
def log_request_start():
    g.request_started_at = time.time()
    logger.info('HTTP %s %s', request.method, request.path)


@app.after_request
def log_request_end(response):
    started_at = getattr(g, 'request_started_at', None)
    duration_ms = round((time.time() - started_at) * 1000, 1) if started_at else '-'
    logger.info('HTTP %s %s -> %s (%s ms)', request.method, request.path, response.status_code, duration_ms)
    return response


def error_response(message: str, status: int = 400):
    logger.warning('API error (%s): %s', status, message)
    return jsonify({'success': False, 'message': message}), status


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


@app.post('/api/auth/login')
def auth_login():
    body = request.get_json(silent=True) or {}
    username = str(body.get('username') or '').strip().lower()
    password = body.get('password')
    if not username or not isinstance(password, str):
        return error_response('Укажите логин и пароль', 400)
    try:
        from auth_passwords import (
            DEFAULT_ADMIN_PASSWORD,
            DEFAULT_ADMIN_USERNAME,
            hash_password,
            needs_rehash,
            verify_password,
        )
        from sqlite_store import (
            _load_profiles,
            _load_user_auth_row,
            connect,
            init_schema,
        )

        with connect() as connection:
            init_schema(connection)
            row = _load_user_auth_row(connection, username=username)
            if not row or not verify_password(password, row['password_hash']):
                return error_response('Неверный логин или пароль', 401)

            must_change = bool(row['must_change_password'])
            if username == DEFAULT_ADMIN_USERNAME and password == DEFAULT_ADMIN_PASSWORD:
                must_change = True

            if needs_rehash(row['password_hash']) or (
                username == DEFAULT_ADMIN_USERNAME and password == DEFAULT_ADMIN_PASSWORD
            ):
                connection.execute(
                    '''
                    UPDATE users
                    SET password_hash = ?, must_change_password = ?
                    WHERE id = ?
                    ''',
                    (hash_password(password), 1 if must_change else 0, row['id']),
                )
            elif must_change != bool(row['must_change_password']):
                connection.execute(
                    'UPDATE users SET must_change_password = ? WHERE id = ?',
                    (1 if must_change else 0, row['id']),
                )

            profiles = _load_profiles(connection)
            profile = profiles.get(row['id'])
            if not profile:
                return error_response('Профиль пользователя не найден', 400)

            return jsonify(
                {
                    'success': True,
                    'user': {
                        'id': row['id'],
                        'email': row['email'],
                        'username': row['username'],
                    },
                    'profile': profile,
                    'must_change_password': must_change,
                }
            )
    except Exception as exc:
        logger.exception('auth login failed')
        return error_response(f'Ошибка входа: {exc}')


@app.post('/api/auth/change-password')
def auth_change_password():
    body = request.get_json(silent=True) or {}
    user_id = str(body.get('user_id') or '').strip()
    new_password = body.get('new_password')
    current_password = body.get('current_password')
    if not user_id or not isinstance(new_password, str):
        return error_response('Укажите user_id и новый пароль', 400)
    try:
        from auth_passwords import hash_password, validate_new_password, verify_password
        from sqlite_store import _load_user_auth_row, connect, init_schema

        err = validate_new_password(new_password)
        if err:
            return error_response(err, 400)

        with connect() as connection:
            init_schema(connection)
            row = _load_user_auth_row(connection, user_id=user_id)
            if not row:
                return error_response('Пользователь не найден', 404)

            # Always prove identity: never allow reset by public user_id alone
            # (must_change_password=1 previously skipped this and enabled LAN takeover).
            if not isinstance(current_password, str) or not verify_password(
                current_password, row['password_hash']
            ):
                return error_response('Неверный текущий пароль', 401)

            connection.execute(
                '''
                UPDATE users
                SET password_hash = ?, must_change_password = 0
                WHERE id = ?
                ''',
                (hash_password(new_password), user_id),
            )
            return jsonify({'success': True, 'must_change_password': False})
    except Exception as exc:
        logger.exception('auth change-password failed')
        return error_response(f'Ошибка смены пароля: {exc}')


@app.post('/api/auth/register')
def auth_register():
    body = request.get_json(silent=True) or {}
    username = str(body.get('username') or '').strip().lower()
    password = body.get('password')
    display_name = str(body.get('display_name') or '').strip() or username
    if not username or not isinstance(password, str):
        return error_response('Укажите логин и пароль', 400)
    try:
        import uuid

        from auth_passwords import (
            DEFAULT_ADMIN_PASSWORD,
            DEFAULT_ADMIN_USERNAME,
            hash_password,
        )
        from sqlite_store import _table_count, connect, init_schema

        with connect() as connection:
            init_schema(connection)
            is_first = _table_count(connection, 'users') == 0
            if not (
                is_first
                and username == DEFAULT_ADMIN_USERNAME
                and password == DEFAULT_ADMIN_PASSWORD
            ):
                if len(password) < 6:
                    return error_response('Пароль должен быть не короче 6 символов', 400)
                if password == DEFAULT_ADMIN_PASSWORD:
                    return error_response('Нельзя использовать пароль по умолчанию', 400)

            existing = connection.execute(
                'SELECT id FROM users WHERE username = ?', (username,)
            ).fetchone()
            if existing:
                return error_response('Пользователь уже существует', 409)

            user_id = str(uuid.uuid4())
            must_change = (
                1
                if username == DEFAULT_ADMIN_USERNAME and password == DEFAULT_ADMIN_PASSWORD
                else 0
            )
            role = 'admin' if is_first else 'user'
            connection.execute(
                '''
                INSERT INTO users (id, email, username, password_hash, must_change_password)
                VALUES (?, ?, ?, ?, ?)
                ''',
                (
                    user_id,
                    f'{username}@example.com',
                    username,
                    hash_password(password),
                    must_change,
                ),
            )
            connection.execute(
                '''
                INSERT INTO profiles (user_id, username, display_name, role)
                VALUES (?, ?, ?, ?)
                ''',
                (user_id, username, display_name, role),
            )
            return jsonify(
                {
                    'success': True,
                    'user': {
                        'id': user_id,
                        'email': f'{username}@example.com',
                        'username': username,
                    },
                    'profile': {
                        'username': username,
                        'display_name': display_name,
                        'role': role,
                    },
                    'must_change_password': bool(must_change),
                }
            )
    except Exception as exc:
        logger.exception('auth register failed')
        return error_response(f'Ошибка регистрации: {exc}')


@app.get('/api/health')
def health():
    return jsonify({'success': True, 'service': 'weighing-system-api'})


@app.get('/api/scales/context')
def scales_context():
    try:
        ctx = get_active_scale_context_from_db()
        return jsonify({'success': True, **ctx})
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('scales context failed')
        return error_response(f'Ошибка чтения комплекта весов: {exc}')


@app.get('/api/scales/status')
def scales_status():
    session = get_scale_session()
    return jsonify({'success': True, **session.status()})


@app.post('/api/scales/connect')
def scales_connect():
    body = request.get_json(silent=True) or {}
    overrides = {}
    if body.get('host'):
        overrides['host'] = body['host']
    if body.get('tcpPort') is not None:
        overrides['tcpPort'] = body['tcpPort']
    if body.get('serialPath'):
        overrides['serialPath'] = body['serialPath']
    session = get_scale_session()
    try:
        result = session.connect(overrides)
        return jsonify({'success': True, **result})
    except NotImplementedError as exc:
        return error_response(str(exc), 501)
    except ValueError as exc:
        return error_response(str(exc), 400)
    except OSError as exc:
        logger.exception('scales connect failed')
        return error_response(f'Не удалось подключить весы: {exc}')
    except Exception as exc:
        logger.exception('scales connect failed')
        return error_response(f'Ошибка подключения весов: {exc}')


@app.post('/api/scales/disconnect')
def scales_disconnect():
    session = get_scale_session()
    session.disconnect()
    return jsonify({'success': True, 'connected': False})


@app.get('/api/scales/reading')
def scales_reading():
    session = get_scale_session()
    return jsonify({'success': True, **session.reading()})


@app.get('/api/cameras/capabilities')
def cameras_capabilities():
    try:
        import cameras as cameras_mod

        caps = cameras_mod.capabilities()
        return jsonify({'success': True, **caps})
    except Exception as exc:
        logger.exception('cameras capabilities failed')
        return error_response(f'Ошибка capabilities камер: {exc}')


@app.post('/api/cameras/capture')
def cameras_capture():
    body = request.get_json(silent=True) or {}
    ticket_id = body.get('ticket_id')
    phase = body.get('phase')
    site_id = body.get('site_id')
    if not ticket_id or not phase:
        return error_response('Нужны ticket_id и phase')
    try:
        import cameras as cameras_mod

        photos, stubs = cameras_mod.capture_for_ticket(
            str(ticket_id),
            str(phase),
            str(site_id) if site_id else None,
        )
        return jsonify({'success': True, 'photos': photos, 'stubs': stubs})
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('cameras capture failed')
        return error_response(f'Ошибка захвата фото: {exc}')


@app.post('/api/cameras/snapshot')
def cameras_snapshot():
    body = request.get_json(silent=True) or {}
    camera_id = body.get('camera_id')
    capture_url = body.get('capture_url')
    capture_kind = body.get('capture_kind')
    try:
        import cameras as cameras_mod

        relative_path = cameras_mod.snapshot_camera(
            camera_id=str(camera_id) if camera_id else None,
            capture_url=str(capture_url) if capture_url else None,
            capture_kind=str(capture_kind) if capture_kind else None,
        )
        return jsonify({'success': True, 'relative_path': relative_path})
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('cameras snapshot failed')
        return error_response(f'Ошибка снимка: {exc}')


@app.post('/api/cameras/reference')
def cameras_reference():
    body = request.get_json(silent=True) or {}
    camera_id = body.get('camera_id')
    mode = body.get('mode')
    if not camera_id or not mode:
        return error_response('Нужны camera_id и mode')
    try:
        import cameras as cameras_mod

        camera = cameras_mod.save_reference(str(camera_id), str(mode))
        return jsonify({'success': True, 'camera': camera})
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('cameras reference failed')
        return error_response(f'Ошибка эталона: {exc}')


@app.get('/api/cameras/photo')
def cameras_photo():
    relative = request.args.get('path') or ''
    try:
        import cameras as cameras_mod

        absolute = cameras_mod.resolve_safe_photo_path(relative)
        if not os.path.isfile(absolute):
            return error_response('Файл не найден', 404)
        directory, filename = os.path.split(absolute)
        return send_from_directory(directory, filename, mimetype='image/jpeg')
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('cameras photo serve failed')
        return error_response(f'Ошибка чтения фото: {exc}')


@app.get('/api/cameras/discover/brands')
def cameras_discover_brands():
    try:
        import camera_discover as discover_mod

        return jsonify({'success': True, 'brands': discover_mod.get_brands()})
    except Exception as exc:
        logger.exception('cameras discover brands failed')
        return error_response(f'Ошибка списка брендов: {exc}')


@app.post('/api/cameras/discover')
def cameras_discover_start():
    body = request.get_json(silent=True) or {}
    ip = body.get('ip')
    if not ip:
        return error_response('Нужен ip')
    username = body.get('username') or ''
    password = body.get('password') or ''
    brand = body.get('brand', None)
    http_port = body.get('http_port', None)
    rtsp_port = body.get('rtsp_port', None)
    try:
        import camera_discover as discover_mod

        result = discover_mod.start_discover(
            ip=str(ip),
            username=str(username) if username is not None else '',
            password=str(password) if password is not None else '',
            brand=str(brand) if brand not in (None, '') else None,
            http_port=int(http_port) if http_port is not None and http_port != '' else None,
            rtsp_port=int(rtsp_port) if rtsp_port is not None and rtsp_port != '' else None,
        )
        return jsonify(result)
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('cameras discover start failed')
        return error_response(f'Ошибка поиска камеры: {exc}')


@app.get('/api/cameras/discover/<session_id>')
def cameras_discover_status(session_id: str):
    try:
        import camera_discover as discover_mod

        return jsonify(discover_mod.get_discover(session_id))
    except KeyError:
        return error_response('Сессия поиска не найдена', 404)
    except Exception as exc:
        logger.exception('cameras discover status failed')
        return error_response(f'Ошибка статуса поиска: {exc}')


@app.post('/api/cameras/discover/<session_id>/cancel')
def cameras_discover_cancel(session_id: str):
    try:
        import camera_discover as discover_mod

        return jsonify(discover_mod.cancel_discover(session_id))
    except KeyError:
        return error_response('Сессия поиска не найдена', 404)
    except Exception as exc:
        logger.exception('cameras discover cancel failed')
        return error_response(f'Ошибка отмены поиска: {exc}')


@app.get('/api/anpr/capabilities')
def anpr_capabilities():
    try:
        import anpr as anpr_mod

        caps = anpr_mod.capabilities()
        return jsonify({'success': True, **caps})
    except Exception as exc:
        logger.exception('anpr capabilities failed')
        return error_response(f'Ошибка capabilities ANPR: {exc}')


@app.post('/api/anpr/recognize')
def anpr_recognize():
    body = request.get_json(silent=True) or {}
    site_id = body.get('site_id')
    camera_id = body.get('camera_id')
    try:
        import anpr as anpr_mod

        result = anpr_mod.recognize(
            site_id=str(site_id) if site_id else None,
            camera_id=str(camera_id) if camera_id else None,
        )
        return jsonify(result)
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('anpr recognize failed')
        return error_response(f'Ошибка распознавания ANPR: {exc}')


@app.post('/api/shutdown')
def shutdown_application():
    """Stop the local API process after the HTTP response is sent.

    Werkzeug removed ``werkzeug.server.shutdown``; always exit the process.
    Delay long enough for the client to read the JSON body — otherwise the
    browser shows ``Failed to fetch`` and the exit UI aborts.
    """

    def _stop() -> None:
        time.sleep(1.2)
        os._exit(0)

    logger.info('Application shutdown requested from %s', request.remote_addr)
    threading.Thread(target=_stop, daemon=True).start()
    response = jsonify({'success': True, 'message': 'Приложение завершает работу'})
    response.headers['Connection'] = 'close'
    return response


@app.get('/api/storage/paths')
def storage_paths():
    return jsonify({'success': True, **get_storage_paths()})


@app.get('/api/config')
def get_config():
    try:
        return jsonify({'success': True, 'config': read_config()})
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
        return jsonify({'success': True, 'data': read_database()})
    except Exception as exc:
        logger.exception('Database read failed')
        return error_response(f'Ошибка чтения базы данных: {exc}')


@app.post('/api/database')
def save_database():
    body = request.get_json(silent=True) or {}
    data = body.get('data')
    if not isinstance(data, dict):
        return error_response('Некорректный формат базы данных')

    try:
        write_database(data)
        logger.info('Database saved (%s keys)', len(data))
        return jsonify({'success': True})
    except Exception as exc:
        logger.exception('Database write failed')
        return error_response(f'Ошибка сохранения базы данных: {exc}')


@app.get('/api/database/years')
def database_years():
    try:
        active = year_db.resolve_active_year()
        years = year_db.list_years()
        if active not in years:
            years = sorted(set(years) | {active})
        return jsonify({'success': True, 'years': years, 'active_year': active})
    except Exception as exc:
        logger.exception('Years list failed')
        return error_response(f'Ошибка списка годов: {exc}')


@app.get('/api/database/rotate/preview')
def database_rotate_preview():
    try:
        return jsonify({'success': True, **year_rotation.preview_rotation()})
    except Exception as exc:
        logger.exception('Rotate preview failed')
        return error_response(f'Ошибка предпросмотра ротации: {exc}')


@app.post('/api/database/rotate')
def database_rotate():
    body = request.get_json(silent=True) or {}
    target_year = body.get('target_year')
    try:
        target_year_int = int(target_year)
    except (TypeError, ValueError):
        return error_response('Некорректный target_year')

    operator_id = body.get('operator_id')
    operator_name = str(body.get('operator_name') or '')
    confirm_reo_pending = bool(body.get('confirm_reo_pending'))

    try:
        result = year_rotation.rotate_year(
            target_year_int,
            operator_id=str(operator_id) if operator_id else None,
            operator_name=operator_name,
            confirm_reo_pending=confirm_reo_pending,
        )
        logger.info(
            'Year rotated %s -> %s (auto_closed=%s)',
            result.get('previous_year'),
            result.get('active_year'),
            len(result.get('auto_closed') or []),
        )
        return jsonify({'success': True, **result})
    except year_rotation.ReoPendingConfirmRequired as exc:
        return jsonify({
            'success': False,
            'error': exc.error,
            'reo_pending_count': exc.count,
            'message': f'Есть {exc.count} тикетов с ожидающей отправкой в РЭО. Подтвердите ротацию.',
        }), 409
    except PermissionError as exc:
        return error_response(str(exc), 403)
    except RuntimeError as exc:
        return error_response(str(exc), 503)
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('Rotate failed')
        return error_response(f'Ошибка ротации года: {exc}')


@app.get('/api/database/archive/<int:year>')
def database_archive(year: int):
    try:
        path = year_db.year_db_path(year)
        data = read_database_at(path)
        return jsonify({'success': True, 'year': year, 'data': data})
    except FileNotFoundError:
        return error_response(f'Архив года {year} не найден', 404)
    except Exception as exc:
        logger.exception('Archive read failed')
        return error_response(f'Ошибка чтения архива: {exc}')


@app.post('/api/database/archive/<int:year>/ticket')
def database_archive_ticket(year: int):
    body = request.get_json(silent=True) or {}
    ticket = body.get('ticket')
    if not isinstance(ticket, dict):
        return error_response('Некорректный формат ticket')

    operator_id = body.get('operator_id')
    operator_name = str(body.get('operator_name') or '')
    confirm_reo_sent = bool(body.get('confirm_reo_sent'))

    try:
        result = year_rotation.update_archive_ticket(
            year,
            ticket,
            operator_id=str(operator_id) if operator_id else None,
            operator_name=operator_name,
            confirm_reo_sent=confirm_reo_sent,
        )
        return jsonify({'success': True, **result})
    except year_rotation.ReoSentConfirmRequired as exc:
        return jsonify({
            'success': False,
            'error': exc.error,
            'message': 'Тикет уже отправлен в РЭО. Подтвердите изменение.',
        }), 409
    except year_rotation.VersionConflict as exc:
        return jsonify({
            'success': False,
            'error': exc.error,
            'expected': exc.expected,
            'actual': exc.actual,
            'message': 'Конфликт версии тикета',
        }), 409
    except PermissionError as exc:
        return error_response(str(exc), 403)
    except FileNotFoundError:
        return error_response(f'Архив года {year} не найден', 404)
    except LookupError as exc:
        return error_response(str(exc), 404)
    except ValueError as exc:
        return error_response(str(exc), 400)
    except Exception as exc:
        logger.exception('Archive ticket update failed')
        return error_response(f'Ошибка правки архивного тикета: {exc}')


@app.get('/api/storage')
def get_storage():
    try:
        return jsonify({'success': True, 'data': read_combined_storage()})
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
        write_combined_storage(safe_data)
        logger.info('Storage saved (%s keys)', len(safe_data))
        return jsonify({'success': True})
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
        if isinstance(content, str) and content.strip():
            combined = import_backup_file(content, filename=str(body.get('filename') or ''))
        elif isinstance(backup, dict):
            combined = import_backup(backup)
        else:
            return error_response('Некорректный формат резервной копии')

        logger.info('Storage imported (%s keys)', len(combined))
        return jsonify({'success': True, 'data': combined})
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
            'data': read_database(),
        })
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
        dictionaries = fetch_metra_dictionary_names(db_path)
        added = merge_dictionaries(dictionaries)
        logger.info('Metra dictionaries imported: %s new entries', sum(added.values()))
        return jsonify({
            'success': True,
            'message': format_import_message('Metra', dictionaries, added),
            'fetched': {key: len(values) for key, values in dictionaries.items()},
            'added': added,
            'data': read_database(),
        })
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
        dictionaries = fetch_wa_dictionary_names(db_path, user, password)
        added = merge_dictionaries(dictionaries)
        logger.info('WA dictionaries imported: %s new entries', sum(added.values()))
        return jsonify({
            'success': True,
            'message': format_import_message('WA', dictionaries, added),
            'fetched': {key: len(values) for key, values in dictionaries.items()},
            'added': added,
            'data': read_database(),
        })
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
