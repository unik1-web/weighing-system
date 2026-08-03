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

    bad = api_client.post(
        '/api/auth/change-password',
        json={'user_id': user_id, 'new_password': DEFAULT_ADMIN_PASSWORD},
    )
    assert bad.status_code == 400

    short = api_client.post(
        '/api/auth/change-password',
        json={'user_id': user_id, 'new_password': '123'},
    )
    assert short.status_code == 400

    ok = api_client.post(
        '/api/auth/change-password',
        json={'user_id': user_id, 'new_password': 'newpass1'},
    )
    assert ok.status_code == 200
    assert ok.get_json()['must_change_password'] is False

    again = api_client.post(
        '/api/auth/login',
        json={'username': 'admin', 'password': 'newpass1'},
    )
    assert again.status_code == 200
    assert again.get_json()['must_change_password'] is False


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
