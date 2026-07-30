"""Schema migration tests for vehicle_drivers and ticket audit stubs."""

import json
import logging
import sqlite3

import sqlite_store


def _connect(tmp_path):
    db_path = tmp_path / 'BD' / 'weighing.db'
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    return connection


def test_init_schema_creates_vehicle_drivers_and_unique_index(temp_app_root):
    """TC-UNIT-01: vehicle_drivers table and unique index exist after init_schema."""
    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
        tables = {
            row['name']
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert 'vehicle_drivers' in tables
        indexes = {
            row['name']
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }
        assert 'idx_vehicle_drivers_key_name' in indexes
        assert 'idx_vehicle_drivers_vehicle_key' in indexes


def test_ensure_ticket_schema_adds_stub_columns_idempotent(temp_app_root):
    """TC-UNIT-02: stub columns added; second call is idempotent."""
    with sqlite_store.connect() as connection:
        connection.executescript(
            '''
            CREATE TABLE weighing_tickets (
                id TEXT PRIMARY KEY,
                ticket_number INTEGER,
                vehicle_number TEXT NOT NULL DEFAULT '',
                vehicle_brand TEXT NOT NULL DEFAULT '',
                trailer_number TEXT NOT NULL DEFAULT '',
                driver_name TEXT NOT NULL DEFAULT '',
                cargo_name TEXT NOT NULL DEFAULT '',
                shipper_name TEXT NOT NULL DEFAULT '',
                receiver_name TEXT NOT NULL DEFAULT '',
                carrier_name TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL DEFAULT 0,
                vat_rate REAL NOT NULL DEFAULT 0,
                gross_weight REAL,
                tare_weight REAL,
                net_weight REAL,
                total_amount REAL,
                gross_source TEXT NOT NULL DEFAULT 'manual',
                tare_source TEXT NOT NULL DEFAULT 'manual',
                gross_raw TEXT,
                tare_raw TEXT,
                gross_datetime TEXT,
                tare_datetime TEXT,
                scale_device TEXT NOT NULL DEFAULT '',
                operator_id TEXT,
                operator_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                reo_status TEXT NOT NULL DEFAULT 'pending',
                reo_sent_at TEXT,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            '''
        )
        sqlite_store.ensure_ticket_schema(connection)
        cols = {
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        }
        for name in sqlite_store.TICKET_STUB_COLUMNS:
            assert name in cols
        sqlite_store.ensure_ticket_schema(connection)
        cols2 = {
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        }
        assert cols2 == cols


def test_partial_post_without_vehicle_drivers_keeps_history(temp_app_root):
    """TC-UNIT-03: POST without app_vehicle_drivers does not clear history."""
    drivers = [
        {
            'id': 'd1',
            'vehicle_key': 'а001аа56',
            'driver_name': 'Иванов И.И.',
            'last_used_at': '2026-07-01T10:00:00.000Z',
            'use_count': 2,
        }
    ]
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['vehicle_drivers']: json.dumps(drivers, ensure_ascii=False),
        }
    )
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps([], ensure_ascii=False),
        }
    )
    data = sqlite_store.read_database()
    loaded = json.loads(data[sqlite_store.STORAGE_KEYS['vehicle_drivers']])
    assert len(loaded) == 1
    assert loaded[0]['use_count'] == 2


def test_vehicle_drivers_write_read_roundtrip(temp_app_root):
    """TC-UNIT: write+read preserves use_count / keys."""
    drivers = [
        {
            'id': 'd1',
            'vehicle_key': 'а001аа56',
            'driver_name': 'Иванов И.И.',
            'last_used_at': '2026-07-01T10:00:00.000Z',
            'use_count': 3,
        }
    ]
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['vehicle_drivers']: json.dumps(drivers, ensure_ascii=False),
        }
    )
    data = sqlite_store.read_database()
    loaded = json.loads(data[sqlite_store.STORAGE_KEYS['vehicle_drivers']])
    assert loaded[0]['vehicle_key'] == 'а001аа56'
    assert loaded[0]['use_count'] == 3


def test_ticket_stubs_roundtrip_and_legacy_null(temp_app_root):
    """TC-UNIT: tickets with/without stubs round-trip."""
    with_stubs = {
        'id': 't1',
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
        'tare_weight': 8500,
        'net_weight': 11500,
        'total_amount': 1150,
        'gross_source': 'instrument',
        'tare_source': 'dictionary',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-07-01T10:00:00',
        'tare_datetime': '2026-07-01T10:00:00',
        'scale_device': '',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-07-01T10:00:00',
        'completed_at': '2026-07-01T10:01:00',
        'weighing_mode': 'single',
        'version': 1,
        'plate_source': 'directory',
        'scale_role': None,
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    legacy = {k: v for k, v in with_stubs.items() if k not in sqlite_store.TICKET_STUB_COLUMNS}
    legacy['id'] = 't2'
    legacy['ticket_number'] = 2

    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps(
                [with_stubs, legacy], ensure_ascii=False
            ),
        }
    )
    loaded = json.loads(sqlite_store.read_database()[sqlite_store.STORAGE_KEYS['tickets']])
    by_id = {row['id']: row for row in loaded}
    assert by_id['t1']['plate_source'] == 'directory'
    assert by_id['t1']['scale_role'] is None
    assert by_id['t2']['plate_source'] is None


def test_replace_vehicle_drivers_logs_on_json_error(temp_app_root, caplog):
    """TC-UNIT-04: invalid JSON for vehicle_drivers is logged."""
    with caplog.at_level(logging.WARNING, logger='weighing-system-api'):
        sqlite_store.write_database(
            {
                sqlite_store.STORAGE_KEYS['vehicle_drivers']: '{not-json',
            }
        )
    assert any('app_vehicle_drivers' in rec.message for rec in caplog.records)
