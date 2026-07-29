import json

from sqlite_store import connect, read_database, write_database


def _user(uid='u1', username='admin'):
    return {
        'id': uid,
        'email': f'{username}@example.com',
        'username': username,
        'passwordHash': 'x',
    }


def _profile(username='admin', role='admin'):
    return {'username': username, 'display_name': username.title(), 'role': role}


def test_users_only_write_preserves_existing_profiles(temp_app_root):
    write_database({
        'app_users': json.dumps([_user()]),
        'app_users_profiles': json.dumps({'u1': _profile()}),
        'app_weighing_tickets': json.dumps([]),
    })

    write_database({
        'app_users': json.dumps([_user(), _user('u2', 'operator')]),
    })

    with connect() as connection:
        users = {row['id'] for row in connection.execute('SELECT id FROM users')}
        profiles = {
            row['user_id']: row['role']
            for row in connection.execute('SELECT user_id, role FROM profiles')
        }

    assert users == {'u1', 'u2'}
    assert profiles == {'u1': 'admin'}


def test_stale_ticket_snapshot_can_overwrite_newer_tickets(temp_app_root):
    """Documents full-replace semantics: last write_database wins for a key."""
    older = [{
        'id': '1',
        'ticket_number': 1,
        'vehicle_number': 'A',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': '',
        'cargo_name': '',
        'shipper_name': '',
        'receiver_name': '',
        'carrier_name': '',
        'price': 0,
        'vat_rate': 0,
        'gross_weight': 1,
        'tare_weight': 1,
        'net_weight': 0,
        'total_amount': 0,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': None,
        'tare_datetime': None,
        'scale_device': '',
        'operator_id': None,
        'operator_name': '',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-01-01T00:00:00',
        'completed_at': None,
    }]
    newer = [older[0], {**older[0], 'id': '2', 'ticket_number': 2}]

    write_database({'app_weighing_tickets': json.dumps(newer)})
    write_database({'app_weighing_tickets': json.dumps(older)})

    loaded = json.loads(read_database()['app_weighing_tickets'])
    assert [ticket['id'] for ticket in loaded] == ['1']
