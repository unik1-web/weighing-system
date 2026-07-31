"""Schema and sync tests for sites / scales / site_runtime / scale_switch_journal."""

import json
import logging

import sqlite_store


def test_init_schema_creates_site_tables_and_indexes(temp_app_root):
    """TC-UNIT-01: four site tables + indexes after init_schema."""
    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
        tables = {
            row['name']
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert 'sites' in tables
        assert 'scales' in tables
        assert 'site_runtime' in tables
        assert 'scale_switch_journal' in tables
        indexes = {
            row['name']
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }
        assert 'idx_scale_switch_journal_site_at' in indexes
        assert 'idx_scales_site_id' in indexes


def test_ensure_ticket_schema_adds_manual_reason_and_site_columns_idempotent(temp_app_root):
    """TC-UNIT-01: migration adds manual_weight_reason and is idempotent."""
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
        assert 'manual_weight_reason' in cols
        assert 'site_id' in cols
        assert 'scale_id' in cols
        sqlite_store.ensure_ticket_schema(connection)
        cols2 = {
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        }
        assert cols2 == cols


def _site_payload():
    return {
        'sites': [
            {
                'id': 'default-site',
                'name': 'Площадка по умолчанию',
                'created_at': '2026-07-31T00:00:00.000Z',
            }
        ],
        'scales': [
            {
                'id': 's-primary',
                'site_id': 'default-site',
                'role': 'primary',
                'adapter_id': 'web_serial',
                'connection': {'device_id': 'newton'},
                'name': 'Основные',
                'created_at': '2026-07-31T00:00:00.000Z',
            },
            {
                'id': 's-spare',
                'site_id': 'default-site',
                'role': 'spare',
                'adapter_id': 'web_serial',
                'connection': {'device_id': None},
                'name': 'Резервные',
                'created_at': '2026-07-31T00:00:00.000Z',
            },
        ],
        'runtime': [
            {
                'site_id': 'default-site',
                'active_scale_set': 'primary',
                'camera_mode': 'primary',
                'anpr_mode': 'enabled',
                'last_switch_reason': None,
                'last_switch_comment': None,
                'last_switch_operator_name': None,
                'last_switch_operator_id': None,
                'last_switch_at': None,
                'updated_at': '2026-07-31T00:00:00.000Z',
            }
        ],
        'journal': [
            {
                'id': 'j1',
                'site_id': 'default-site',
                'from_set': 'primary',
                'to_set': 'spare',
                'reason': 'repair',
                'comment': None,
                'operator_name': 'Оператор',
                'operator_id': None,
                'switched_at': '2026-07-31T01:00:00.000Z',
            }
        ],
    }


def test_site_keys_write_read_roundtrip(temp_app_root):
    """TC-UNIT-03: round-trip app_sites / scales / runtime / journal."""
    payload = _site_payload()
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['sites']: json.dumps(payload['sites'], ensure_ascii=False),
            sqlite_store.STORAGE_KEYS['scales']: json.dumps(payload['scales'], ensure_ascii=False),
            sqlite_store.STORAGE_KEYS['site_runtime']: json.dumps(
                payload['runtime'], ensure_ascii=False
            ),
            sqlite_store.STORAGE_KEYS['scale_switch_journal']: json.dumps(
                payload['journal'], ensure_ascii=False
            ),
        }
    )
    data = sqlite_store.read_database()
    sites = json.loads(data[sqlite_store.STORAGE_KEYS['sites']])
    scales = json.loads(data[sqlite_store.STORAGE_KEYS['scales']])
    runtime = json.loads(data[sqlite_store.STORAGE_KEYS['site_runtime']])
    journal = json.loads(data[sqlite_store.STORAGE_KEYS['scale_switch_journal']])
    assert sites[0]['id'] == 'default-site'
    assert scales[0]['connection']['device_id'] == 'newton'
    assert scales[1]['connection']['device_id'] is None
    assert runtime[0]['active_scale_set'] == 'primary'
    assert journal[0]['reason'] == 'repair'


def test_partial_post_without_site_keys_keeps_tables(temp_app_root):
    """TC-UNIT-04: POST without site keys does not clear site tables."""
    payload = _site_payload()
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['sites']: json.dumps(payload['sites'], ensure_ascii=False),
            sqlite_store.STORAGE_KEYS['scales']: json.dumps(payload['scales'], ensure_ascii=False),
            sqlite_store.STORAGE_KEYS['site_runtime']: json.dumps(
                payload['runtime'], ensure_ascii=False
            ),
            sqlite_store.STORAGE_KEYS['scale_switch_journal']: json.dumps(
                payload['journal'], ensure_ascii=False
            ),
        }
    )
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps([], ensure_ascii=False),
        }
    )
    data = sqlite_store.read_database()
    assert len(json.loads(data[sqlite_store.STORAGE_KEYS['sites']])) == 1
    assert len(json.loads(data[sqlite_store.STORAGE_KEYS['scales']])) == 2
    assert len(json.loads(data[sqlite_store.STORAGE_KEYS['scale_switch_journal']])) == 1


def test_ticket_site_columns_roundtrip_and_legacy(temp_app_root):
    """TC-UNIT-05: ticket with site_id/scale_id round-trip; legacy without → NULL."""
    with_fields = {
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
        'site_id': 'default-site',
        'scale_id': 's-primary',
        'scale_role': 'primary',
        'photo_entry_path': None,
        'photo_exit_path': None,
    }
    legacy = {k: v for k, v in with_fields.items() if k not in ('site_id', 'scale_id', 'scale_role', 'plate_source', 'photo_entry_path', 'photo_exit_path')}
    legacy['id'] = 't2'
    legacy['ticket_number'] = 2

    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps(
                [with_fields, legacy], ensure_ascii=False
            ),
        }
    )
    loaded = json.loads(sqlite_store.read_database()[sqlite_store.STORAGE_KEYS['tickets']])
    by_id = {row['id']: row for row in loaded}
    assert by_id['t1']['site_id'] == 'default-site'
    assert by_id['t1']['scale_id'] == 's-primary'
    assert by_id['t1']['scale_role'] == 'primary'
    assert by_id['t2']['site_id'] is None
    assert by_id['t2']['scale_id'] is None


def test_replace_sites_logs_on_json_error(temp_app_root, caplog):
    """TC-UNIT: invalid JSON for app_sites is logged."""
    with caplog.at_level(logging.WARNING, logger='weighing-system-api'):
        sqlite_store.write_database(
            {
                sqlite_store.STORAGE_KEYS['sites']: '{not-json',
            }
        )
    assert any('app_sites' in rec.message for rec in caplog.records)
