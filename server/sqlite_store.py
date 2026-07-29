import json
import os
import sqlite3
import sys
from contextlib import contextmanager
from typing import Any

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILENAME = 'weighing.db'

STORAGE_KEYS = {
    'users': 'app_users',
    'profiles': 'app_users_profiles',
    'tickets': 'app_weighing_tickets',
    'session': 'app_current_user',
    'vehicles': 'app_vehicles',
    'drivers': 'app_drivers',
    'cargos': 'app_cargos',
    'shippers': 'app_shippers',
    'receivers': 'app_receivers',
    'carriers': 'app_carriers',
}

DICTIONARY_CATEGORIES = {
    'app_vehicles': 'vehicles',
    'app_drivers': 'drivers',
    'app_cargos': 'cargos',
    'app_shippers': 'shippers',
    'app_receivers': 'receivers',
    'app_carriers': 'carriers',
}

TICKET_COLUMNS = [
    'id', 'ticket_number', 'vehicle_number', 'vehicle_brand', 'trailer_number',
    'driver_name', 'cargo_name', 'shipper_name', 'receiver_name', 'carrier_name',
    'price', 'vat_rate', 'gross_weight', 'tare_weight', 'net_weight', 'total_amount',
    'gross_source', 'tare_source', 'gross_raw', 'tare_raw', 'gross_datetime', 'tare_datetime',
    'scale_device', 'operator_id', 'operator_name', 'status', 'reo_status', 'reo_sent_at',
    'notes', 'created_at', 'completed_at',
]


def get_app_root() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.abspath(os.path.join(BASE_DIR, '..'))


def get_bd_dir() -> str:
    return os.path.join(get_app_root(), 'BD')


def get_json_database_path() -> str:
    return os.path.join(get_bd_dir(), 'app_data.json')


def ensure_storage_dirs() -> None:
    os.makedirs(get_bd_dir(), exist_ok=True)


def get_sqlite_path() -> str:
    return os.path.join(get_bd_dir(), DB_FILENAME)


@contextmanager
def connect():
    ensure_storage_dirs()
    connection = sqlite3.connect(get_sqlite_path())
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        '''
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS profiles (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS weighing_tickets (
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

        CREATE TABLE IF NOT EXISTS dictionary_entries (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_dictionary_category
            ON dictionary_entries(category);

        CREATE TABLE IF NOT EXISTS app_sessions (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL
        );
        '''
    )


def _table_count(connection: sqlite3.Connection, table: str) -> int:
    row = connection.execute(f'SELECT COUNT(*) AS count FROM {table}').fetchone()
    return int(row['count']) if row else 0


def database_has_data(connection: sqlite3.Connection) -> bool:
    for table in ('users', 'weighing_tickets', 'dictionary_entries', 'app_sessions'):
        if _table_count(connection, table) > 0:
            return True
    return False


def migrate_json_database_if_needed() -> None:
    sqlite_path = get_sqlite_path()
    json_path = get_json_database_path()

    with connect() as connection:
        init_schema(connection)
        if database_has_data(connection):
            return

    if not os.path.isfile(json_path):
        return

    with open(json_path, 'r', encoding='utf-8') as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        return

    payload = {
        str(key): value
        for key, value in raw.items()
        if str(key).startswith('app_') and isinstance(value, str)
    }
    if payload:
        write_database(payload)


def _load_users(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        'SELECT id, email, username, password_hash FROM users ORDER BY username'
    ).fetchall()
    return [
        {
            'id': row['id'],
            'email': row['email'],
            'username': row['username'],
            'passwordHash': row['password_hash'],
        }
        for row in rows
    ]


def _load_profiles(connection: sqlite3.Connection) -> dict[str, dict[str, str]]:
    rows = connection.execute(
        'SELECT user_id, username, display_name, role FROM profiles'
    ).fetchall()
    return {
        row['user_id']: {
            'username': row['username'],
            'display_name': row['display_name'],
            'role': row['role'],
        }
        for row in rows
    }


def _load_tickets(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets ORDER BY created_at DESC'
    ).fetchall()
    tickets: list[dict[str, Any]] = []
    for row in rows:
        ticket = {column: row[column] for column in TICKET_COLUMNS}
        tickets.append(ticket)
    return tickets


def _load_dictionary(connection: sqlite3.Connection, category: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        '''
        SELECT id, name, notes, created_at, payload
        FROM dictionary_entries
        WHERE category = ?
        ORDER BY name
        ''',
        (category,),
    ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        item: dict[str, Any] = {
            'id': row['id'],
            'name': row['name'],
            'notes': row['notes'],
            'created_at': row['created_at'],
        }
        try:
            extra = json.loads(row['payload'] or '{}')
            if isinstance(extra, dict):
                item.update(extra)
        except json.JSONDecodeError:
            pass
        items.append(item)
    return items


def _load_session(connection: sqlite3.Connection) -> str | None:
    row = connection.execute('SELECT payload FROM app_sessions WHERE id = 1').fetchone()
    return row['payload'] if row else None


def read_database() -> dict[str, str]:
    migrate_json_database_if_needed()
    result: dict[str, str] = {}

    with connect() as connection:
        init_schema(connection)

        users = _load_users(connection)
        if users:
            result[STORAGE_KEYS['users']] = json.dumps(users, ensure_ascii=False)

        profiles = _load_profiles(connection)
        if profiles:
            result[STORAGE_KEYS['profiles']] = json.dumps(profiles, ensure_ascii=False)

        tickets = _load_tickets(connection)
        if tickets:
            result[STORAGE_KEYS['tickets']] = json.dumps(tickets, ensure_ascii=False)

        session = _load_session(connection)
        if session:
            result[STORAGE_KEYS['session']] = session

        for storage_key, category in DICTIONARY_CATEGORIES.items():
            items = _load_dictionary(connection, category)
            if items:
                result[storage_key] = json.dumps(items, ensure_ascii=False)

    return result


def _replace_users(connection: sqlite3.Connection, users: list[Any]) -> None:
    connection.execute('DELETE FROM profiles')
    connection.execute('DELETE FROM users')
    for user in users:
        if not isinstance(user, dict):
            continue
        connection.execute(
            '''
            INSERT INTO users (id, email, username, password_hash)
            VALUES (?, ?, ?, ?)
            ''',
            (
                str(user.get('id', '')),
                str(user.get('email', '')),
                str(user.get('username', '')),
                str(user.get('passwordHash', '')),
            ),
        )


def _replace_profiles(connection: sqlite3.Connection, profiles: dict[str, Any]) -> None:
    connection.execute('DELETE FROM profiles')
    for user_id, profile in profiles.items():
        if not isinstance(profile, dict):
            continue
        connection.execute(
            '''
            INSERT INTO profiles (user_id, username, display_name, role)
            VALUES (?, ?, ?, ?)
            ''',
            (
                str(user_id),
                str(profile.get('username', '')),
                str(profile.get('display_name', '')),
                str(profile.get('role', 'user')),
            ),
        )


def _replace_tickets(connection: sqlite3.Connection, tickets: list[Any]) -> None:
    connection.execute('DELETE FROM weighing_tickets')
    for ticket in tickets:
        if not isinstance(ticket, dict):
            continue
        values = [ticket.get(column) for column in TICKET_COLUMNS]
        connection.execute(
            f'''
            INSERT INTO weighing_tickets ({", ".join(TICKET_COLUMNS)})
            VALUES ({", ".join(['?'] * len(TICKET_COLUMNS))})
            ''',
            values,
        )


def _replace_dictionary(connection: sqlite3.Connection, category: str, items: list[Any]) -> None:
    connection.execute('DELETE FROM dictionary_entries WHERE category = ?', (category,))
    for item in items:
        if not isinstance(item, dict):
            continue
        base_keys = {'id', 'name', 'notes', 'created_at'}
        extra = {key: value for key, value in item.items() if key not in base_keys}
        connection.execute(
            '''
            INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (
                str(item.get('id', '')),
                category,
                str(item.get('name', '')),
                str(item.get('notes', '')),
                str(item.get('created_at', '')),
                json.dumps(extra, ensure_ascii=False),
            ),
        )


def _replace_session(connection: sqlite3.Connection, payload: str) -> None:
    connection.execute('DELETE FROM app_sessions')
    connection.execute(
        'INSERT INTO app_sessions (id, payload) VALUES (1, ?)',
        (payload,),
    )


def write_database(data: dict[str, Any]) -> None:
    with connect() as connection:
        init_schema(connection)

        has_users = STORAGE_KEYS['users'] in data
        has_profiles = STORAGE_KEYS['profiles'] in data
        saved_profiles: dict[str, dict[str, str]] | None = None
        if has_users and not has_profiles:
            # _replace_users deletes profiles (FK cascade). Preserve them when
            # the client payload omits app_users_profiles.
            saved_profiles = _load_profiles(connection)

        if has_users:
            try:
                users = json.loads(str(data[STORAGE_KEYS['users']]))
                if isinstance(users, list):
                    _replace_users(connection, users)
            except json.JSONDecodeError:
                pass

        if has_profiles:
            try:
                profiles = json.loads(str(data[STORAGE_KEYS['profiles']]))
                if isinstance(profiles, dict):
                    _replace_profiles(connection, profiles)
            except json.JSONDecodeError:
                pass
        elif saved_profiles:
            _replace_profiles(connection, saved_profiles)

        if STORAGE_KEYS['tickets'] in data:
            try:
                tickets = json.loads(str(data[STORAGE_KEYS['tickets']]))
                if isinstance(tickets, list):
                    _replace_tickets(connection, tickets)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['session'] in data:
            _replace_session(connection, str(data[STORAGE_KEYS['session']]))

        for storage_key, category in DICTIONARY_CATEGORIES.items():
            if storage_key not in data:
                continue
            try:
                items = json.loads(str(data[storage_key]))
                if isinstance(items, list):
                    _replace_dictionary(connection, category, items)
            except json.JSONDecodeError:
                pass
