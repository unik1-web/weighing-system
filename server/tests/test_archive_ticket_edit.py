"""Admin archive ticket edit: revisions, audit, reo sent confirm, version lock."""

import json

import year_db
from sqlite_store import write_database


def _seed(admin_id: str = 'admin-1', *, reo_status: str = 'pending'):
    year_db.write_active_year(2025)
    write_database(
        {
            'app_users': json.dumps(
                [
                    {
                        'id': admin_id,
                        'email': 'a@example.com',
                        'username': 'admin',
                        'passwordHash': 'x',
                    },
                    {
                        'id': 'user-1',
                        'email': 'u@example.com',
                        'username': 'user',
                        'passwordHash': 'x',
                    },
                ],
                ensure_ascii=False,
            ),
            'app_users_profiles': json.dumps(
                {
                    admin_id: {
                        'username': 'admin',
                        'display_name': 'Админ',
                        'role': 'admin',
                    },
                    'user-1': {
                        'username': 'user',
                        'display_name': 'Юзер',
                        'role': 'user',
                    },
                },
                ensure_ascii=False,
            ),
            'app_weighing_tickets': json.dumps(
                [
                    {
                        'id': 'arch-1',
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
                        'gross_datetime': '2025-03-01T10:00:00',
                        'tare_datetime': '2025-03-01T10:05:00',
                        'scale_device': '',
                        'operator_id': admin_id,
                        'operator_name': 'Админ',
                        'status': 'completed',
                        'reo_status': reo_status,
                        'reo_sent_at': '2025-03-01T12:00:00' if reo_status == 'sent' else None,
                        'notes': '',
                        'created_at': '2025-03-01T10:00:00',
                        'completed_at': '2025-03-01T10:05:00',
                        'weighing_mode': 'single',
                        'version': 1,
                        'auto_closed': False,
                    }
                ],
                ensure_ascii=False,
            ),
        }
    )
    # Simulate archive: keep 2025 file, switch active to 2026 empty year
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
                    },
                    {
                        'id': 'user-1',
                        'email': 'u@example.com',
                        'username': 'user',
                        'passwordHash': 'x',
                    },
                ],
                ensure_ascii=False,
            ),
            'app_users_profiles': json.dumps(
                {
                    admin_id: {
                        'username': 'admin',
                        'display_name': 'Админ',
                        'role': 'admin',
                    },
                    'user-1': {
                        'username': 'user',
                        'display_name': 'Юзер',
                        'role': 'user',
                    },
                },
                ensure_ascii=False,
            ),
        }
    )


def test_admin_archive_edit_writes_revisions_and_audit(temp_app_root, api_client):
    _seed(reo_status='pending')
    response = api_client.post(
        '/api/database/archive/2025/ticket',
        json={
            'ticket': {
                'id': 'arch-1',
                'version': 1,
                'notes': 'исправлено',
                'driver_name': 'Сидоров',
            },
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
        },
    )
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body['ticket']['notes'] == 'исправлено'
    assert body['ticket']['driver_name'] == 'Сидоров'
    assert body['ticket']['version'] == 2
    fields = {r['field'] for r in body['revisions']}
    assert fields == {'notes', 'driver_name'}

    archive = api_client.get('/api/database/archive/2025').get_json()['data']
    revisions = json.loads(archive['app_ticket_revisions'])
    assert len(revisions) == 2
    audit = json.loads(archive['app_ticket_audit'])
    assert any(e['action'] == 'updated' for e in audit)


def test_archive_edit_reo_sent_requires_confirm(temp_app_root, api_client):
    _seed(reo_status='sent')
    denied = api_client.post(
        '/api/database/archive/2025/ticket',
        json={
            'ticket': {'id': 'arch-1', 'version': 1, 'notes': 'x'},
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
            'confirm_reo_sent': False,
        },
    )
    assert denied.status_code == 409
    assert denied.get_json()['error'] == 'reo_sent_confirm_required'

    ok = api_client.post(
        '/api/database/archive/2025/ticket',
        json={
            'ticket': {'id': 'arch-1', 'version': 1, 'notes': 'x'},
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
            'confirm_reo_sent': True,
        },
    )
    assert ok.status_code == 200
    assert ok.get_json()['ticket']['notes'] == 'x'


def test_archive_edit_version_conflict(temp_app_root, api_client):
    _seed()
    response = api_client.post(
        '/api/database/archive/2025/ticket',
        json={
            'ticket': {'id': 'arch-1', 'version': 99, 'notes': 'x'},
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
        },
    )
    assert response.status_code == 409
    assert response.get_json()['error'] == 'version_conflict'


def test_archive_edit_forbidden_for_user(temp_app_root, api_client):
    _seed()
    response = api_client.post(
        '/api/database/archive/2025/ticket',
        json={
            'ticket': {'id': 'arch-1', 'version': 1, 'notes': 'x'},
            'operator_id': 'user-1',
            'operator_name': 'Юзер',
        },
    )
    assert response.status_code == 403


def test_archive_edit_noop_skips_audit_and_version(temp_app_root, api_client):
    _seed()
    response = api_client.post(
        '/api/database/archive/2025/ticket',
        json={
            'ticket': {
                'id': 'arch-1',
                'version': 1,
                'notes': '',  # same as seeded
                'driver_name': 'Иванов',
            },
            'operator_id': 'admin-1',
            'operator_name': 'Админ',
        },
    )
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body['ticket']['version'] == 1
    assert body['revisions'] == []

    archive = api_client.get('/api/database/archive/2025').get_json()['data']
    audit = json.loads(archive.get('app_ticket_audit') or '[]')
    assert not any(e['action'] == 'updated' for e in audit)