import logging
import os
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler

import requests
from flask import Flask, g, jsonify, request
from flask_cors import CORS

try:
    import fdb
except ImportError:  # pragma: no cover - optional until Vescom is used
    fdb = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
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


def normalize_firebird_dsn(db_path: str) -> str:
    return db_path.strip().replace('\\', '/')


def fetch_vescom_rows(db_path: str, date_str: str, user: str, password: str):
    if fdb is None:
        raise RuntimeError(
            'Модуль fdb не установлен. Используйте Python 3.11/3.12: pip install -r server/requirements.txt'
        )

    logger.info('Vescom query for date=%s db=%s', date_str, db_path)
    conn = fdb.connect(dsn=normalize_firebird_dsn(db_path), user=user, password=password)
    cursor = conn.cursor()

    query = """
        SELECT DATE_BRUTTO + TIME_BRUTTO AS DATETIME_BRUTTO,
               DATE_TARA + TIME_TARA AS DATETIME_TARA,
               NOMER_TS || REGION_TS AS NOMER_TS_FULL,
               MARKA_TS,
               FIRMA_POL,
               BRUTTO,
               TARA,
               NETTO,
               GRUZ_NAME
        FROM EVENTS
        WHERE DATE_TARA IS NOT NULL
          AND DATE_BRUTTO = ?
          AND ENABLE = 0
    """

    cursor.execute(query, (date_str,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    logger.info('Vescom query completed: %s rows', len(rows))
    return rows


@app.get('/api/health')
def health():
    return jsonify({'success': True, 'service': 'weighing-system-api'})


@app.post('/api/reo/test')
def reo_test():
    data = request.get_json(silent=True) or {}
    access_key = (data.get('access_key') or '').strip()
    object_url = (data.get('object_url') or '').strip()
    object_id = (data.get('object_id') or 'test').strip()

    if not access_key or not object_url:
        return error_response('Не указаны URL сервиса или ключ доступа')

    try:
        logger.info('REO test request to %s', object_url)
        response = requests.post(
            object_url,
            json={
                'ObjectId': object_id,
                'AccessKey': access_key,
                'WeightControls': [],
            },
            timeout=30,
        )
        response.raise_for_status()
        logger.info('REO test successful')
        return jsonify({'success': True, 'message': 'Подключение к РЭО успешно'})
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

    count = len(payload.get('WeightControls', []))
    try:
        logger.info('REO send request to %s (%s records)', object_url, count)
        response = requests.post(object_url, json=payload, timeout=60)
        response.raise_for_status()
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
        conn = fdb.connect(dsn=db_path, user=user, password=password)
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
        rows = fetch_vescom_rows(db_path, date_str, user, password)
        items = []
        for row in rows:
            items.append({
                'datetimebrutto': row[0].strftime('%Y-%m-%d %H:%M:%S') if row[0] else '',
                'datetimetara': row[1].strftime('%Y-%m-%d %H:%M:%S') if row[1] else '',
                'vehicle_number': row[2] or '',
                'vehicle_brand': row[3] or '',
                'receiver_name': row[4] or '',
                'gross_weight': float(row[5]) if row[5] is not None else None,
                'tare_weight': float(row[6]) if row[6] is not None else None,
                'net_weight': float(row[7]) if row[7] is not None else None,
                'cargo_name': row[8] or '',
            })
        return jsonify({'success': True, 'items': items})
    except Exception as exc:
        logger.exception('Vescom fetch failed')
        return error_response(f'Ошибка чтения Vescom: {exc}')


if __name__ == '__main__':
    logger.info('Starting weighing-system API on http://127.0.0.1:5001')
    app.run(host='127.0.0.1', port=5001, debug=True)
