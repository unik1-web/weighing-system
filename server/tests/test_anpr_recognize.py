"""ANPR recognize: fake engine ok / failed capture / ticket column soft-read."""

import json
from unittest.mock import patch

import anpr
import year_db
from config_ini import CONFIG_SECTION, write_ini_section
from sqlite_store import connect, ensure_ticket_schema, get_sqlite_path, write_database

FAKE_JPEG = b'\xff\xd8\xff\xe0' + b'\x00' * 64 + b'\xff\xd9'


class FakeEngine:
    def __init__(self, available=True, plate='А123ВС56', confidence=0.87, error=None):
        self.available = available
        self.plate = plate
        self.confidence = confidence
        self.error = error
        self.calls = 0
        self.last_jpeg = None

    def is_available(self) -> bool:
        return self.available

    def recognize(self, jpeg: bytes) -> tuple[str, float]:
        self.calls += 1
        self.last_jpeg = jpeg
        if self.error:
            raise RuntimeError(self.error)
        return self.plate, self.confidence


def _write_config(temp_app_root, **kwargs):
    base = {'active_year': '2026', 'video_enabled': 'true', 'anpr_enabled': 'true'}
    base.update(kwargs)
    write_ini_section(str(temp_app_root / 'config.ini'), CONFIG_SECTION, base)


def _seed():
    year_db.write_active_year(2026)
    write_database(
        {
            'app_sites': json.dumps(
                [
                    {
                        'id': 'site-1',
                        'name': 'Площадка',
                        'is_default': True,
                        'created_at': '2026-08-02T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
            'app_site_runtime': json.dumps(
                [
                    {
                        'site_id': 'site-1',
                        'active_scale_set': 'primary',
                        'camera_mode': 'normal',
                        'anpr_mode': 'enabled',
                        'switch_reason': None,
                        'switch_by_operator_id': None,
                        'switch_by_operator_name': None,
                        'switch_at': None,
                    }
                ],
                ensure_ascii=False,
            ),
            'app_cameras': json.dumps(
                [
                    {
                        'id': 'cam-overview',
                        'site_id': 'site-1',
                        'role': 'overview',
                        'name': 'Обзор',
                        'capture_url': 'http://127.0.0.1:9/overview.jpg',
                        'capture_kind': 'http_snapshot',
                        'enabled': True,
                        'sort_order': 0,
                        'roi': {'x': 0, 'y': 0, 'w': 1, 'h': 1},
                        'reference_normal_path': None,
                        'reference_spare_path': None,
                        'created_at': '2026-08-02T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
        }
    )


def test_recognize_ok_with_fake_engine(api_client, temp_app_root):
    _write_config(temp_app_root)
    _seed()
    engine = FakeEngine(plate='А777АА56', confidence=0.91)
    anpr.set_engine_override(engine)
    try:
        with patch('cameras.grab_frame', return_value=FAKE_JPEG):
            resp = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'})
        data = resp.get_json()
        assert resp.status_code == 200
        assert data['success'] is True
        assert data['engine_invoked'] is True
        assert data['anpr_status'] == 'enabled'
        assert data['plate_raw'] == 'А777АА56'
        assert abs(data['confidence'] - 0.91) < 1e-6
        assert data['camera_id'] == 'cam-overview'
        assert data['error'] is None
        assert engine.calls == 1
    finally:
        anpr.set_engine_override(None)


def test_recognize_engine_error_is_failed(api_client, temp_app_root):
    _write_config(temp_app_root)
    _seed()
    engine = FakeEngine(error='модель сломана')
    anpr.set_engine_override(engine)
    try:
        with patch('cameras.grab_frame', return_value=FAKE_JPEG):
            data = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'}).get_json()
        assert data['engine_invoked'] is True
        assert data['anpr_status'] == 'failed'
        assert data['plate_raw'] is None
        assert 'модель' in (data['error'] or '')
        assert engine.calls == 1
    finally:
        anpr.set_engine_override(None)


def test_recognize_grab_frame_error_is_failed(api_client, temp_app_root):
    _write_config(temp_app_root)
    _seed()
    engine = FakeEngine()
    anpr.set_engine_override(engine)
    try:
        with patch('cameras.grab_frame', side_effect=RuntimeError('Таймаут захвата overview')):
            data = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'}).get_json()
        assert data['engine_invoked'] is True
        assert data['anpr_status'] == 'failed'
        assert data['error'] == 'Таймаут захвата overview'
        assert engine.calls == 0
    finally:
        anpr.set_engine_override(None)


def test_ticket_anpr_columns_roundtrip(api_client, temp_app_root):
    _write_config(temp_app_root, anpr_enabled='false', video_enabled='false')
    year_db.write_active_year(2026)
    ticket = {
        'id': 't-anpr-1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Иванов',
        'cargo_name': 'Грунт',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 100,
        'vat_rate': 20,
        'gross_weight': 20000,
        'tare_weight': 5000,
        'net_weight': 15000,
        'total_amount': 1500,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-08-02T10:00:00',
        'tare_datetime': '2026-08-02T10:05:00',
        'scale_device': 'test',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-08-02T10:00:00',
        'completed_at': '2026-08-02T10:05:00',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': 'anpr',
        'site_id': 'site-1',
        'anpr_plate_raw': 'А001АА56',
        'plate_confidence': 0.75,
        'anpr_accepted': True,
        'anpr_status': 'enabled',
    }
    write_database({'app_weighing_tickets': json.dumps([ticket], ensure_ascii=False)})
    body = api_client.get('/api/database').get_json()
    loaded = json.loads(body['data']['app_weighing_tickets'])
    assert loaded[0]['anpr_plate_raw'] == 'А001АА56'
    assert abs(loaded[0]['plate_confidence'] - 0.75) < 1e-6
    assert loaded[0]['anpr_accepted'] is True
    assert loaded[0]['anpr_status'] == 'enabled'
    assert loaded[0]['plate_source'] == 'anpr'


def test_ensure_schema_adds_anpr_columns(temp_app_root):
    year_db.write_active_year(2026)
    path = get_sqlite_path()
    with connect(path) as connection:
        connection.execute(
            '''
            CREATE TABLE weighing_tickets (
                id TEXT PRIMARY KEY,
                vehicle_number TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                weighing_mode TEXT NOT NULL DEFAULT 'single',
                version INTEGER NOT NULL DEFAULT 1
            )
            '''
        )
        ensure_ticket_schema(connection)
        cols = {row['name'] for row in connection.execute('PRAGMA table_info(weighing_tickets)')}
    assert 'anpr_plate_raw' in cols
    assert 'plate_confidence' in cols
    assert 'anpr_accepted' in cols
    assert 'anpr_status' in cols
