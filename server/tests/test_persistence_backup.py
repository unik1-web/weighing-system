import json

import pytest

from persistence import (
    SETTINGS_KEY,
    backup_to_ini,
    build_backup,
    import_backup,
    import_backup_file,
    import_backup_ini,
    read_combined_storage,
    write_combined_storage,
    write_config,
    write_database,
)
from sqlite_store import STORAGE_KEYS, read_database, write_database as write_sqlite


def _sample_database_blob() -> dict[str, str]:
    users = [
        {
            'id': 'u1',
            'email': 'admin@example.com',
            'username': 'admin',
            'passwordHash': 'hash-1',
        }
    ]
    profiles = {
        'u1': {
            'username': 'admin',
            'display_name': 'Админ',
            'role': 'admin',
        }
    }
    tickets = [
        {
            'id': 't1',
            'ticket_number': 7,
            'vehicle_number': 'А123ВС56',
            'vehicle_brand': 'Камаз',
            'trailer_number': '',
            'driver_name': 'Иванов И.И.',
            'cargo_name': 'ТКО',
            'shipper_name': '',
            'receiver_name': 'ООО Полигон',
            'carrier_name': '',
            'price': 100,
            'vat_rate': 0,
            'gross_weight': 12500,
            'tare_weight': 8200,
            'net_weight': 4300,
            'total_amount': 100,
            'gross_source': 'manual',
            'tare_source': 'manual',
            'gross_raw': None,
            'tare_raw': None,
            'gross_datetime': '2026-07-28 10:05:09',
            'tare_datetime': '2026-07-28 11:00:00',
            'scale_device': '',
            'operator_id': 'u1',
            'operator_name': 'admin',
            'status': 'completed',
            'reo_status': 'pending',
            'reo_sent_at': None,
            'notes': '',
            'created_at': '2026-07-28 09:00:00',
            'completed_at': '2026-07-28 11:05:00',
        }
    ]
    receivers = [
        {
            'id': 'r1',
            'name': 'ООО Полигон',
            'notes': '',
            'created_at': '2026-01-01',
            'inn': '1234567890',
        }
    ]
    return {
        STORAGE_KEYS['users']: json.dumps(users, ensure_ascii=False),
        STORAGE_KEYS['profiles']: json.dumps(profiles, ensure_ascii=False),
        STORAGE_KEYS['tickets']: json.dumps(tickets, ensure_ascii=False),
        STORAGE_KEYS['session']: json.dumps({'userId': 'u1'}, ensure_ascii=False),
        STORAGE_KEYS['receivers']: json.dumps(receivers, ensure_ascii=False),
    }


class TestSqliteDatabaseRoundTrip:
    def test_write_read_preserves_users_tickets_and_dictionary(self, temp_app_root):
        payload = _sample_database_blob()
        write_sqlite(payload)
        restored = read_database()

        assert json.loads(restored[STORAGE_KEYS['users']]) == json.loads(payload[STORAGE_KEYS['users']])
        assert json.loads(restored[STORAGE_KEYS['profiles']]) == json.loads(payload[STORAGE_KEYS['profiles']])
        assert json.loads(restored[STORAGE_KEYS['tickets']])[0]['vehicle_number'] == 'А123ВС56'
        assert json.loads(restored[STORAGE_KEYS['tickets']])[0]['ticket_number'] == 7
        assert restored[STORAGE_KEYS['session']] == payload[STORAGE_KEYS['session']]
        assert json.loads(restored[STORAGE_KEYS['receivers']])[0]['inn'] == '1234567890'


class TestPersistenceBackup:
    def test_ini_backup_roundtrip_restores_config_and_database(self, temp_app_root):
        write_config({'org_name': 'Полигон', 'reo_enabled': 'true', 'reo_object_id': 'obj-1'})
        write_database(_sample_database_blob())

        backup = build_backup()
        ini_text = backup_to_ini(backup)

        assert '[backup]' in ini_text
        assert '[settings]' in ini_text
        assert '[database]' in ini_text
        assert 'org_name' in ini_text

        # Wipe and restore via INI import
        write_config({'org_name': 'cleared'})
        write_database(
            {
                STORAGE_KEYS['users']: json.dumps([], ensure_ascii=False),
                STORAGE_KEYS['profiles']: json.dumps({}, ensure_ascii=False),
                STORAGE_KEYS['tickets']: json.dumps([], ensure_ascii=False),
                STORAGE_KEYS['receivers']: json.dumps([], ensure_ascii=False),
                STORAGE_KEYS['session']: '{}',
            }
        )

        restored = import_backup_ini(ini_text)
        assert restored[SETTINGS_KEY]
        settings = json.loads(restored[SETTINGS_KEY])
        assert settings['org_name'] == 'Полигон'
        assert settings['reo_object_id'] == 'obj-1'
        assert json.loads(restored[STORAGE_KEYS['tickets']])[0]['id'] == 't1'
        assert json.loads(restored[STORAGE_KEYS['users']])[0]['username'] == 'admin'

    def test_import_backup_json_payload(self, temp_app_root):
        payload = {
            'version': 3,
            'config': {'org_name': 'Тест', 'org_inn': '111'},
            'database': _sample_database_blob(),
        }
        restored = import_backup(payload)
        assert json.loads(restored[SETTINGS_KEY])['org_name'] == 'Тест'
        assert json.loads(restored[STORAGE_KEYS['tickets']])[0]['cargo_name'] == 'ТКО'

    def test_import_backup_rejects_invalid_shape(self, temp_app_root):
        with pytest.raises(ValueError, match='Некорректный формат'):
            import_backup({'version': 3})

    def test_import_backup_file_detects_ini_and_json(self, temp_app_root):
        write_config({'org_name': 'INI'})
        write_database(_sample_database_blob())
        ini_text = backup_to_ini()

        write_config({'org_name': 'cleared'})
        from_ini = import_backup_file(ini_text, filename='backup.ini')
        assert json.loads(from_ini[SETTINGS_KEY])['org_name'] == 'INI'

        wrapped = json.dumps(
            {
                'backup': {
                    'version': 3,
                    'config': {'org_name': 'JSON'},
                    'database': _sample_database_blob(),
                }
            },
            ensure_ascii=False,
        )
        from_json = import_backup_file(wrapped, filename='backup.json')
        assert json.loads(from_json[SETTINGS_KEY])['org_name'] == 'JSON'

    def test_import_backup_file_rejects_garbage(self, temp_app_root):
        with pytest.raises(ValueError):
            import_backup_file('not-ini-and-not-json', filename='data.txt')

    def test_combined_storage_roundtrip(self, temp_app_root):
        blob = {
            SETTINGS_KEY: json.dumps({'org_name': 'Комбинированный', 'reo_enabled': 'false'}, ensure_ascii=False),
            **_sample_database_blob(),
        }
        write_combined_storage(blob)
        restored = read_combined_storage()
        assert json.loads(restored[SETTINGS_KEY])['org_name'] == 'Комбинированный'
        assert json.loads(restored[STORAGE_KEYS['tickets']])[0]['vehicle_number'] == 'А123ВС56'
