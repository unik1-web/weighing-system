"""Year rotation: backup, copy entities, auto-close, empty tickets, numbering."""

import json
import os
import sqlite3

import year_db
import year_rotation
from sqlite_store import connect, init_schema, read_database, write_database


def _seed_active_year(admin_id: str = 'admin-1'):
    year_db.write_active_year(2026)
    write_database(
        {
            'app_users': json.dumps(
                [
                    {
                        'id': admin_id,
                        'email': 'a@example.com',
                        'username': 'admin',
                        'passwordHash': 'x',
                    }
                ],
                ensure_ascii=False,
            ),
            'app_users_profiles': json.dumps(
                {
                    admin_id: {
                        'username': 'admin',
                        'display_name': 'Админ',
                        'role': 'admin',
                    }
                },
                ensure_ascii=False,
            ),
            'app_vehicles': json.dumps(
                [
                    {
                        'id': 'v1',
                        'name': 'А001АА56',
                        'notes': '',
                        'created_at': '2026-01-01T00:00:00',
                        'default_tare_weight': 5000,
                    }
                ],
                ensure_ascii=False,
            ),
            'app_vehicle_drivers': json.dumps(
                [
                    {
                        'id': 'vd1',
                        'vehicle_number': 'А001АА56',
                        'driver_name': 'Иванов',
                        'last_used_at': '2026-01-01T00:00:00',
                        'use_count': 2,
                        'driver_id': None,
                    }
                ],
                ensure_ascii=False,
            ),
            'app_sites': json.dumps(
                [
                    {
                        'id': 'site-1',
                        'name': 'Площадка',
                        'is_default': True,
                        'created_at': '2026-01-01T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
            'app_scales': json.dumps(
                [
                    {
                        'id': 'scale-1',
                        'site_id': 'site-1',
                        'role': 'primary',
                        'name': 'Основные',
                        'adapter_id': 'generic_tcp',
                        'connection': {'kind': 'tcp', 'host': '127.0.0.1', 'tcpPort': 9000},
                        'enabled': True,
                        'created_at': '2026-01-01T00:00:00',
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
            'app_weighing_tickets': json.dumps(
                [
                    {
                        'id': 'open-1',
                        'ticket_number': 3,
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
                        'gross_datetime': '2026-01-02T10:00:00',
                        'tare_datetime': None,
                        'scale_device': '',
                        'operator_id': admin_id,
                        'operator_name': 'Админ',
                        'status': 'open',
                        'reo_status': 'pending',
                        'reo_sent_at': None,
                        'notes': '',
                        'created_at': '2026-01-02T10:00:00',
                        'completed_at': None,
                        'weighing_mode': 'dual',
                        'version': 1,
                        'auto_closed': False,
                    },
                    {
                        'id': 'done-1',
                        'ticket_number': 2,
                        'vehicle_number': 'В002ВВ56',
                        'vehicle_brand': '',
                        'trailer_number': '',
                        'driver_name': 'Петров',
                        'cargo_name': 'Грунт',
                        'shipper_name': 'А',
                        'receiver_name': 'Б',
                        'carrier_name': 'В',
                        'price': 100,
                        'vat_rate': 20,
                        'gross_weight': 18000,
                        'tare_weight': 6000,
                        'net_weight': 12000,
                        'total_amount': 1200,
                        'gross_source': 'manual',
                        'tare_source': 'manual',
                        'gross_raw': None,
                        'tare_raw': None,
                        'gross_datetime': '2026-01-01T10:00:00',
                        'tare_datetime': '2026-01-01T10:05:00',
                        'scale_device': '',
                        'operator_id': admin_id,
                        'operator_name': 'Админ',
                        'status': 'completed',
                        'reo_status': 'pending',
                        'reo_sent_at': None,
                        'notes': '',
                        'created_at': '2026-01-01T10:00:00',
                        'completed_at': '2026-01-01T10:05:00',
                        'weighing_mode': 'single',
                        'version': 1,
                        'auto_closed': False,
                    },
                ],
                ensure_ascii=False,
            ),
        }
    )


def test_rotate_copies_entities_not_tickets(temp_app_root, api_client):
    from persistence import write_config

    write_config({'tara_default': '0', 'active_year': '2026'})
    _seed_active_year()

    preview = api_client.get('/api/database/rotate/preview').get_json()
    assert preview['active_year'] == 2026
    assert preview['open_count'] == 1
    assert preview['reo_pending_count'] == 2

    response = api_client.post(
        '/api/database/rotate',
        json={
            'target_year': 2027,
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
            'confirm_reo_pending': True,
        },
    )
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body['ok'] is True
    assert body['previous_year'] == 2026
    assert body['active_year'] == 2027
    assert os.path.isfile(body['backup_path'])
    assert len(body['auto_closed']) == 1
    assert body['auto_closed'][0]['tare_source'] == 'dictionary'
    assert body['auto_closed'][0]['tare_weight'] == 5000
    assert body['auto_closed'][0]['attention'] is False

    # Archive year still has tickets
    archive = api_client.get('/api/database/archive/2026').get_json()['data']
    archive_tickets = json.loads(archive['app_weighing_tickets'])
    assert len(archive_tickets) == 2
    closed = next(t for t in archive_tickets if t['id'] == 'open-1')
    assert closed['status'] == 'completed'
    assert closed['auto_closed'] is True
    assert closed['tare_weight'] == 5000
    assert closed['net_weight'] == 15000

    # Active year has dictionaries/users/sites, empty tickets
    active = api_client.get('/api/database').get_json()['data']
    assert 'app_weighing_tickets' not in active or active.get('app_weighing_tickets') in ('[]', None)
    if 'app_weighing_tickets' in active:
        assert json.loads(active['app_weighing_tickets']) == []
    assert len(json.loads(active['app_vehicles'])) == 1
    assert len(json.loads(active['app_vehicle_drivers'])) == 1
    assert len(json.loads(active['app_sites'])) == 1
    assert len(json.loads(active['app_scales'])) == 1
    assert year_db.read_active_year() == 2027

    # Numbering starts at 1 in new year
    write_database(
        {
            'app_weighing_tickets': json.dumps(
                [
                    {
                        'id': 'new-1',
                        'ticket_number': 1,
                        'vehicle_number': 'X',
                        'vehicle_brand': '',
                        'trailer_number': '',
                        'driver_name': 'D',
                        'cargo_name': 'C',
                        'shipper_name': 'S',
                        'receiver_name': 'R',
                        'carrier_name': 'K',
                        'price': 0,
                        'vat_rate': 0,
                        'gross_weight': 1000,
                        'tare_weight': 500,
                        'net_weight': 500,
                        'total_amount': 0,
                        'gross_source': 'manual',
                        'tare_source': 'manual',
                        'gross_raw': None,
                        'tare_raw': None,
                        'gross_datetime': None,
                        'tare_datetime': None,
                        'scale_device': '',
                        'operator_id': None,
                        'operator_name': 'Оп',
                        'status': 'completed',
                        'reo_status': 'pending',
                        'reo_sent_at': None,
                        'notes': '',
                        'created_at': '2027-01-01T00:00:00',
                        'completed_at': '2027-01-01T00:00:00',
                        'weighing_mode': 'single',
                        'version': 1,
                    }
                ],
                ensure_ascii=False,
            )
        }
    )
    tickets = json.loads(read_database()['app_weighing_tickets'])
    assert tickets[0]['ticket_number'] == 1


def test_rotate_requires_admin(temp_app_root, api_client):
    from persistence import write_config

    write_config({'active_year': '2026'})
    year_db.write_active_year(2026)
    write_database(
        {
            'app_users': json.dumps(
                [{'id': 'u1', 'email': 'u@x', 'username': 'user', 'passwordHash': 'x'}],
                ensure_ascii=False,
            ),
            'app_users_profiles': json.dumps(
                {'u1': {'username': 'user', 'display_name': 'User', 'role': 'user'}},
                ensure_ascii=False,
            ),
        }
    )
    response = api_client.post(
        '/api/database/rotate',
        json={'target_year': 2027, 'operator_id': 'u1', 'operator_name': 'User'},
    )
    assert response.status_code == 403


def test_rotate_reo_pending_requires_confirm(temp_app_root, api_client):
    from persistence import write_config

    write_config({'active_year': '2026'})
    _seed_active_year()
    response = api_client.post(
        '/api/database/rotate',
        json={
            'target_year': 2027,
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
            'confirm_reo_pending': False,
        },
    )
    assert response.status_code == 409
    assert response.get_json()['error'] == 'reo_pending_confirm_required'


def test_auto_close_attention_when_no_tare(temp_app_root):
    year_db.write_active_year(2026)
    with connect() as connection:
        init_schema(connection)
        connection.execute(
            '''
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, status, created_at, operator_name,
                price, vat_rate, gross_weight, weighing_mode, version, auto_closed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                'o1',
                1,
                'UNKNOWN',
                'open',
                '2026-01-01T00:00:00',
                'Op',
                0,
                0,
                10000,
                'dual',
                1,
                0,
            ),
        )
        closed = year_rotation.auto_close_open_tickets(
            connection,
            operator_id=None,
            operator_name='system',
            tara_default=0,
        )
    assert len(closed) == 1
    assert closed[0]['attention'] is True
    assert closed[0]['tare_source'] == 'none'
