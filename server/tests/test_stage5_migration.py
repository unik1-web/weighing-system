"""Stage-5 migration and backup/import tests."""

from __future__ import annotations

import json
import os
import sqlite3

import persistence


def _create_legacy_stage4_database(path: str) -> None:
    connection = sqlite3.connect(path)
    try:
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
            PRAGMA user_version = 0;
            '''
        )
        connection.execute(
            '''
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, operator_name, created_at, status
            ) VALUES (?, ?, ?, ?, ?, ?)
            ''',
            ('legacy-1', 1, 'A001AA56', 'Operator', '2026-07-31T00:00:00', 'open'),
        )
        connection.commit()
    finally:
        connection.close()


def test_stage5_backup_import_roundtrip_with_manual_reason_and_connection(temp_app_root):
    """TC-UNIT-01: backup/import keeps manual reason policy and stage-5 ticket fields."""
    persistence.write_config(
        {
            'manual_weight_reason_policy': 'required',
            'scale_device_id': 'cas',
        }
    )
    payload = {
        'app_scales': json.dumps(
            [
                {
                    'id': 'scale-primary',
                    'site_id': 'default-site',
                    'role': 'primary',
                    'adapter_id': 'generic-regex',
                    'connection': {
                        'transport': 'serial_backend',
                        'serial': {'port': 'COM3', 'baud_rate': 9600},
                        'parser': {
                            'kind': 'regex',
                            'pattern': r'^(ST|US)\s+(\d+)$',
                            'weight_group': 2,
                            'stability_group': 1,
                        },
                    },
                    'name': 'Основные',
                    'created_at': '2026-07-31T00:00:00.000Z',
                }
            ],
            ensure_ascii=False,
        ),
        'app_weighing_tickets': json.dumps(
            [
                {
                    'id': 'ticket-1',
                    'ticket_number': 10,
                    'vehicle_number': 'А001АА56',
                    'vehicle_brand': '',
                    'trailer_number': '',
                    'driver_name': '',
                    'cargo_name': '',
                    'shipper_name': '',
                    'receiver_name': '',
                    'carrier_name': '',
                    'price': 0,
                    'vat_rate': 0,
                    'gross_weight': 1000,
                    'tare_weight': None,
                    'net_weight': None,
                    'total_amount': None,
                    'gross_source': 'manual',
                    'tare_source': 'manual',
                    'gross_raw': None,
                    'tare_raw': None,
                    'gross_datetime': None,
                    'tare_datetime': None,
                    'scale_device': 'cas',
                    'manual_weight_reason': 'Порт недоступен',
                    'operator_id': None,
                    'operator_name': 'Оператор',
                    'status': 'open',
                    'reo_status': 'pending',
                    'reo_sent_at': None,
                    'notes': '',
                    'created_at': '2026-07-31T00:00:00.000Z',
                    'completed_at': None,
                    'weighing_mode': 'single',
                    'version': 1,
                    'plate_source': None,
                    'site_id': 'default-site',
                    'scale_id': 'scale-primary',
                    'scale_role': 'primary',
                    'photo_entry_path': None,
                    'photo_exit_path': None,
                }
            ],
            ensure_ascii=False,
        ),
    }
    persistence.write_database(payload)

    backup = persistence.build_backup()
    persistence.write_config({'manual_weight_reason_policy': 'optional'})
    persistence.write_database({'app_weighing_tickets': '[]', 'app_scales': '[]'})
    restored = persistence.import_backup(backup)

    restored_config = json.loads(restored['app_settings'])
    restored_tickets = json.loads(restored['app_weighing_tickets'])
    restored_scales = json.loads(restored['app_scales'])
    assert restored_config['manual_weight_reason_policy'] == 'required'
    assert restored_tickets[0]['manual_weight_reason'] == 'Порт недоступен'
    assert restored_scales[0]['connection']['transport'] == 'serial_backend'


def test_stage5_migration_is_idempotent_and_creates_pair_backups(temp_app_root):
    """TC-UNIT-02: stage-5 migration can run repeatedly without destructive changes."""
    config_path = persistence.get_config_path()
    db_path = persistence.get_database_path()

    with open(config_path, 'w', encoding='utf-8') as handle:
        handle.write('[settings]\nscale_device_id = cas\n')
    _create_legacy_stage4_database(db_path)

    persistence.migrate_legacy_storage()

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        user_version = int(connection.execute('PRAGMA user_version').fetchone()[0])
        columns = [
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        ]
    finally:
        connection.close()

    assert user_version >= 5
    assert columns.count('manual_weight_reason') == 1
    config = persistence.read_config()
    assert config['manual_weight_reason_policy'] == 'optional'

    backup_paths = persistence._stage5_backup_paths()
    assert os.path.isfile(backup_paths['config'])
    assert os.path.isfile(backup_paths['database'])

    persistence.migrate_legacy_storage()
    connection = sqlite3.connect(db_path)
    try:
        second_user_version = int(connection.execute('PRAGMA user_version').fetchone()[0])
        second_columns = [
            row[1]
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        ]
    finally:
        connection.close()
    assert second_user_version >= 5
    assert second_columns.count('manual_weight_reason') == 1
