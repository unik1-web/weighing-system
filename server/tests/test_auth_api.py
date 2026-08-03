"""API tests for /api/auth/* login, register, must_change, legacy upgrade."""

import base64
import json

from auth_passwords import DEFAULT_ADMIN_PASSWORD, hash_password, verify_password
from sqlite_store import connect, init_schema, read_database, write_database


def test_bootstrap_admin_and_force_change(temp_app_root, api_client):
    data = read_database()
    users = json.loads(data['app_users'])
    assert len(users) == 1
    assert users[0]['username'] == 'admin'
    assert 'passwordHash' not in users[0]
    assert users[0]['mustChangePassword'] is True

    login = api_client.post(
        '/api/auth/login',
        json={'username': 'admin', 'password': DEFAULT_ADMIN_PASSWORD},
    )
    assert login.status_code == 200, login.get_json()
    body = login.get_json()
    assert body['must_change_password'] is True
    user_id = body['user']['id']

    # CRITICAL: must_change=1 must NOT allow reset without proving current password.
    unauth = api_client.post(
        '/api/auth/change-password',
        json={'user_id': user_id, 'new_password': 'hijacked1'},
    )
    assert unauth.status_code == 401

    wrong_current = api_client.post(
        '/api/auth/change-password',
        json={
            'user_id': user_id,
            'current_password': 'not-the-password',
            'new_password': 'hijacked1',
        },
    )
    assert wrong_current.status_code == 401

    bad = api_client.post(
        '/api/auth/change-password',
        json={
            'user_id': user_id,
            'current_password': DEFAULT_ADMIN_PASSWORD,
            'new_password': DEFAULT_ADMIN_PASSWORD,
        },
    )
    assert bad.status_code == 400

    short = api_client.post(
        '/api/auth/change-password',
        json={
            'user_id': user_id,
            'current_password': DEFAULT_ADMIN_PASSWORD,
            'new_password': '123',
        },
    )
    assert short.status_code == 400

    ok = api_client.post(
        '/api/auth/change-password',
        json={
            'user_id': user_id,
            'current_password': DEFAULT_ADMIN_PASSWORD,
            'new_password': 'newpass1',
        },
    )
    assert ok.status_code == 200
    assert ok.get_json()['must_change_password'] is False

    again = api_client.post(
        '/api/auth/login',
        json={'username': 'admin', 'password': 'newpass1'},
    )
    assert again.status_code == 200
    assert again.get_json()['must_change_password'] is False


def test_change_password_requires_current_even_with_public_user_id(temp_app_root, api_client):
    """LAN attacker with only GET /api/database user_id cannot reset bootstrap admin."""
    data = read_database()
    users = json.loads(data['app_users'])
    user_id = users[0]['id']
    assert users[0]['mustChangePassword'] is True

    # Public id alone + new password must fail.
    attack = api_client.post(
        '/api/auth/change-password',
        json={'user_id': user_id, 'new_password': 'attacker-takeover'},
    )
    assert attack.status_code == 401

    # Default password still works for legitimate first change.
    ok = api_client.post(
        '/api/auth/login',
        json={'username': 'admin', 'password': DEFAULT_ADMIN_PASSWORD},
    )
    assert ok.status_code == 200

    with connect() as connection:
        row = connection.execute(
            'SELECT password_hash FROM users WHERE id = ?', (user_id,)
        ).fetchone()
        assert verify_password(DEFAULT_ADMIN_PASSWORD, row['password_hash'])


def test_sync_cannot_clear_must_change_password(temp_app_root, api_client):
    """Client sync must not clear mustChangePassword while keeping default hash."""
    data = read_database()
    users = json.loads(data['app_users'])
    assert users[0]['mustChangePassword'] is True
    user_id = users[0]['id']

    # Preserve default hash, try to clear the force-change gate via sync.
    with connect() as connection:
        before = connection.execute(
            'SELECT password_hash, must_change_password FROM users WHERE id = ?',
            (user_id,),
        ).fetchone()
        assert before['must_change_password'] == 1
        default_hash = before['password_hash']

    payload = api_client.get('/api/database').get_json()['data']
    synced_users = json.loads(payload['app_users'])
    synced_users[0]['mustChangePassword'] = False
    payload['app_users'] = json.dumps(synced_users)

    write_resp = api_client.post('/api/database', json={'data': payload})
    assert write_resp.status_code == 200, write_resp.get_json()

    with connect() as connection:
        after = connection.execute(
            'SELECT password_hash, must_change_password FROM users WHERE id = ?',
            (user_id,),
        ).fetchone()
        assert after['must_change_password'] == 1
        assert after['password_hash'] == default_hash

    # Gate still enforced on next login + change still needs current password.
    login = api_client.post(
        '/api/auth/login',
        json={'username': 'admin', 'password': DEFAULT_ADMIN_PASSWORD},
    )
    assert login.get_json()['must_change_password'] is True


def test_legacy_btoa_login_rehashes(temp_app_root, api_client):
    legacy = base64.b64encode(b'oldpass1').decode('ascii')
    write_database(
        {
            'app_users': json.dumps(
                [
                    {
                        'id': 'u-legacy',
                        'email': 'u@example.com',
                        'username': 'legacy',
                        'mustChangePassword': False,
                    }
                ]
            ),
            'app_users_profiles': json.dumps(
                {
                    'u-legacy': {
                        'username': 'legacy',
                        'display_name': 'Legacy',
                        'role': 'user',
                    }
                }
            ),
        }
    )
    # Directly set legacy hash (write_database strips client passwordHash).
    with connect() as connection:
        init_schema(connection)
        connection.execute(
            'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
            (legacy, 'u-legacy'),
        )

    login = api_client.post(
        '/api/auth/login',
        json={'username': 'legacy', 'password': 'oldpass1'},
    )
    assert login.status_code == 200, login.get_json()

    with connect() as connection:
        row = connection.execute(
            'SELECT password_hash FROM users WHERE id = ?', ('u-legacy',)
        ).fetchone()
        assert row['password_hash'].startswith('pbkdf2_sha256$')
        assert verify_password('oldpass1', row['password_hash'])


def test_register_second_user(temp_app_root, api_client):
    read_database()  # bootstrap admin
    response = api_client.post(
        '/api/auth/register',
        json={
            'username': 'operator',
            'password': 'oper123',
            'display_name': 'Оператор',
        },
    )
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body['profile']['role'] == 'user'
    assert body['user']['username'] == 'operator'

    login = api_client.post(
        '/api/auth/login',
        json={'username': 'operator', 'password': 'oper123'},
    )
    assert login.status_code == 200


def test_sync_users_without_password_hash(temp_app_root, api_client):
    read_database()
    with connect() as connection:
        init_schema(connection)
        connection.execute(
            'UPDATE users SET password_hash = ? WHERE username = ?',
            (hash_password('keep-me'), 'admin'),
        )

    # Client sync without hash must preserve server hash.
    get_before = api_client.get('/api/database').get_json()['data']
    users = json.loads(get_before['app_users'])
    assert all('passwordHash' not in u for u in users)

    api_client.post('/api/database', json={'data': get_before})

    with connect() as connection:
        row = connection.execute(
            "SELECT password_hash FROM users WHERE username = 'admin'"
        ).fetchone()
        assert verify_password('keep-me', row['password_hash'])


def test_normal_change_password_requires_current(temp_app_root, api_client):
    read_database()
    # Set a non-default password and clear must_change.
    with connect() as connection:
        init_schema(connection)
        connection.execute(
            '''
            UPDATE users
            SET password_hash = ?, must_change_password = 0
            WHERE username = ?
            ''',
            (hash_password('oldpass1'), 'admin'),
        )
        user_id = connection.execute(
            "SELECT id FROM users WHERE username = 'admin'"
        ).fetchone()['id']

    missing = api_client.post(
        '/api/auth/change-password',
        json={'user_id': user_id, 'new_password': 'newpass2'},
    )
    assert missing.status_code == 401

    ok = api_client.post(
        '/api/auth/change-password',
        json={
            'user_id': user_id,
            'current_password': 'oldpass1',
            'new_password': 'newpass2',
        },
    )
    assert ok.status_code == 200
    assert ok.get_json()['must_change_password'] is False
