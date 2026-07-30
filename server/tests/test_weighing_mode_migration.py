"""Tests for weighing_mode / version schema migration and ticket_audit sync."""

import json
import sqlite3

import sqlite_store


def _legacy_create_tickets_table(connection: sqlite3.Connection) -> None:
    """Create weighing_tickets without weighing_mode/version (pre-migration)."""
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


def test_init_schema_has_new_columns_and_audit(temp_app_root):
    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
        cols = {
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        }
        assert 'weighing_mode' in cols
        assert 'version' in cols
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert 'ticket_audit' in tables


def test_ensure_backfill_open_to_dual_once(temp_app_root):
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        _legacy_create_tickets_table(connection)
        connection.execute(
            '''
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, status, created_at, operator_name
            ) VALUES (?, ?, ?, ?, ?, ?)
            ''',
            ('open-1', 1, 'A001', 'open', '2026-01-01T00:00:00', 'Op'),
        )
        connection.execute(
            '''
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, status, created_at, operator_name, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ''',
            ('done-1', 2, 'A002', 'completed', '2026-01-01T00:00:00', 'Op', '2026-01-01T01:00:00'),
        )
        connection.commit()

        sqlite_store.ensure_ticket_schema(connection)
        connection.commit()

        open_mode = connection.execute(
            'SELECT weighing_mode, version FROM weighing_tickets WHERE id = ?',
            ('open-1',),
        ).fetchone()
        done_mode = connection.execute(
            'SELECT weighing_mode, version FROM weighing_tickets WHERE id = ?',
            ('done-1',),
        ).fetchone()
        assert open_mode['weighing_mode'] == 'dual'
        assert done_mode['weighing_mode'] == 'single'
        assert open_mode['version'] == 1

        # Mark completed as dual explicitly — second ensure must not overwrite.
        connection.execute(
            "UPDATE weighing_tickets SET weighing_mode = 'dual' WHERE id = ?",
            ('done-1',),
        )
        connection.commit()
        sqlite_store.ensure_ticket_schema(connection)
        connection.commit()
        done_again = connection.execute(
            'SELECT weighing_mode FROM weighing_tickets WHERE id = ?',
            ('done-1',),
        ).fetchone()
        assert done_again['weighing_mode'] == 'dual'
    finally:
        connection.close()


def test_roundtrip_weighing_mode_version_and_audit(temp_app_root):
    tickets = [
        {
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
            'tare_weight': None,
            'net_weight': None,
            'total_amount': None,
            'gross_source': 'manual',
            'tare_source': 'manual',
            'gross_raw': None,
            'tare_raw': None,
            'gross_datetime': '2026-01-01T10:00:00',
            'tare_datetime': None,
            'scale_device': '',
            'operator_id': None,
            'operator_name': 'Оператор',
            'status': 'open',
            'reo_status': 'pending',
            'reo_sent_at': None,
            'notes': '',
            'created_at': '2026-01-01T10:00:00',
            'completed_at': None,
            'weighing_mode': 'dual',
            'version': 2,
        }
    ]
    audit = [
        {
            'id': 'a1',
            'ticket_id': 't1',
            'action': 'created',
            'at': '2026-01-01T10:00:00',
            'operator_name': 'Оператор',
            'operator_id': None,
        }
    ]
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps(tickets, ensure_ascii=False),
            sqlite_store.STORAGE_KEYS['ticket_audit']: json.dumps(audit, ensure_ascii=False),
        }
    )
    data = sqlite_store.read_database()
    loaded_tickets = json.loads(data[sqlite_store.STORAGE_KEYS['tickets']])
    loaded_audit = json.loads(data[sqlite_store.STORAGE_KEYS['ticket_audit']])
    assert loaded_tickets[0]['weighing_mode'] == 'dual'
    assert loaded_tickets[0]['version'] == 2
    assert loaded_audit[0]['action'] == 'created'


def test_partial_post_without_audit_keeps_audit(temp_app_root):
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['ticket_audit']: json.dumps(
                [
                    {
                        'id': 'a1',
                        'ticket_id': 't1',
                        'action': 'created',
                        'at': '2026-01-01T10:00:00',
                        'operator_name': 'Op',
                        'operator_id': None,
                    }
                ],
                ensure_ascii=False,
            ),
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps([], ensure_ascii=False),
        }
    )
    # Partial POST: tickets only, no audit key
    sqlite_store.write_database(
        {
            sqlite_store.STORAGE_KEYS['tickets']: json.dumps([], ensure_ascii=False),
        }
    )
    data = sqlite_store.read_database()
    assert sqlite_store.STORAGE_KEYS['ticket_audit'] in data
    assert len(json.loads(data[sqlite_store.STORAGE_KEYS['ticket_audit']])) == 1


def test_get_omits_empty_audit_key(temp_app_root):
    with sqlite_store.connect() as connection:
        sqlite_store.init_schema(connection)
    data = sqlite_store.read_database()
    assert sqlite_store.STORAGE_KEYS['ticket_audit'] not in data
