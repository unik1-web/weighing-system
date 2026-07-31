import json
import logging
import os
import sqlite3
import sys
from contextlib import contextmanager
from typing import Any

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILENAME = 'weighing.db'

logger = logging.getLogger('weighing-system-api')

STORAGE_KEYS = {
    'users': 'app_users',
    'profiles': 'app_users_profiles',
    'tickets': 'app_weighing_tickets',
    'ticket_audit': 'app_ticket_audit',
    'vehicle_drivers': 'app_vehicle_drivers',
    'sites': 'app_sites',
    'scales': 'app_scales',
    'site_runtime': 'app_site_runtime',
    'scale_switch_journal': 'app_scale_switch_journal',
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
    'weighing_mode', 'version',
    'plate_source', 'site_id', 'scale_id', 'scale_role', 'photo_entry_path', 'photo_exit_path',
]

AUDIT_COLUMNS = [
    'id', 'ticket_id', 'action', 'at', 'operator_name', 'operator_id',
]

VEHICLE_DRIVER_COLUMNS = [
    'id', 'vehicle_key', 'driver_name', 'last_used_at', 'use_count',
]

SITE_COLUMNS = [
    'id', 'name', 'created_at',
]

SCALE_COLUMNS = [
    'id', 'site_id', 'role', 'adapter_id', 'connection_json', 'name', 'created_at',
]

SITE_RUNTIME_COLUMNS = [
    'site_id', 'active_scale_set', 'camera_mode', 'anpr_mode',
    'last_switch_reason', 'last_switch_comment',
    'last_switch_operator_name', 'last_switch_operator_id', 'last_switch_at',
    'updated_at',
]

SCALE_SWITCH_JOURNAL_COLUMNS = [
    'id', 'site_id', 'from_set', 'to_set', 'reason', 'comment',
    'operator_name', 'operator_id', 'switched_at',
]

TICKET_STUB_COLUMNS = (
    'plate_source',
    'site_id',
    'scale_id',
    'scale_role',
    'photo_entry_path',
    'photo_exit_path',
)


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


def ensure_vehicle_drivers_schema(connection: sqlite3.Connection) -> None:
    """Create vehicle_drivers table and indexes (no FK to tickets)."""
    try:
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS vehicle_drivers (
                id TEXT PRIMARY KEY,
                vehicle_key TEXT NOT NULL,
                driver_name TEXT NOT NULL,
                last_used_at TEXT NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 1
            )
            '''
        )
        connection.execute(
            '''
            CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_drivers_key_name
                ON vehicle_drivers(vehicle_key, driver_name)
            '''
        )
        connection.execute(
            '''
            CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vehicle_key
                ON vehicle_drivers(vehicle_key)
            '''
        )
    except Exception:
        logger.exception('Failed to ensure vehicle_drivers schema')
        raise


def ensure_site_schema(connection: sqlite3.Connection) -> None:
    """Create sites / scales / site_runtime / scale_switch_journal tables (idempotent)."""
    try:
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS sites (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            '''
        )
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS scales (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                role TEXT NOT NULL,
                adapter_id TEXT NOT NULL,
                connection_json TEXT NOT NULL DEFAULT '{}',
                name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE (site_id, role)
            )
            '''
        )
        connection.execute(
            'CREATE INDEX IF NOT EXISTS idx_scales_site_id ON scales(site_id)'
        )
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS site_runtime (
                site_id TEXT PRIMARY KEY,
                active_scale_set TEXT NOT NULL,
                camera_mode TEXT NOT NULL,
                anpr_mode TEXT NOT NULL,
                last_switch_reason TEXT,
                last_switch_comment TEXT,
                last_switch_operator_name TEXT,
                last_switch_operator_id TEXT,
                last_switch_at TEXT,
                updated_at TEXT NOT NULL
            )
            '''
        )
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS scale_switch_journal (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                from_set TEXT NOT NULL,
                to_set TEXT NOT NULL,
                reason TEXT NOT NULL,
                comment TEXT,
                operator_name TEXT NOT NULL DEFAULT '',
                operator_id TEXT,
                switched_at TEXT NOT NULL
            )
            '''
        )
        connection.execute(
            '''
            CREATE INDEX IF NOT EXISTS idx_scale_switch_journal_site_at
                ON scale_switch_journal(site_id, switched_at)
            '''
        )
    except Exception:
        logger.exception('Failed to ensure site schema')
        raise


def ensure_ticket_schema(connection: sqlite3.Connection) -> None:
    """Ensure weighing_tickets columns, ticket_audit, vehicle_drivers, site tables, open→dual backfill."""
    try:
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS ticket_audit (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                action TEXT NOT NULL,
                at TEXT NOT NULL,
                operator_name TEXT NOT NULL DEFAULT '',
                operator_id TEXT
            )
            '''
        )
        connection.execute(
            'CREATE INDEX IF NOT EXISTS idx_ticket_audit_ticket ON ticket_audit(ticket_id)'
        )
        ensure_vehicle_drivers_schema(connection)
        ensure_site_schema(connection)

        existing = {
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        }
        if not existing:
            return

        column_weighing_mode_added = False
        if 'weighing_mode' not in existing:
            connection.execute(
                "ALTER TABLE weighing_tickets ADD COLUMN weighing_mode TEXT NOT NULL DEFAULT 'single'"
            )
            column_weighing_mode_added = True

        if 'version' not in existing:
            connection.execute(
                'ALTER TABLE weighing_tickets ADD COLUMN version INTEGER NOT NULL DEFAULT 1'
            )

        for column in TICKET_STUB_COLUMNS:
            if column not in existing:
                connection.execute(
                    f'ALTER TABLE weighing_tickets ADD COLUMN {column} TEXT'
                )

        if column_weighing_mode_added:
            # One-shot backfill: only right after ADD COLUMN weighing_mode.
            connection.execute(
                "UPDATE weighing_tickets SET weighing_mode = 'dual' WHERE status = 'open'"
            )
    except Exception:
        logger.exception('Failed to ensure ticket schema')
        raise


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
            completed_at TEXT,
            weighing_mode TEXT NOT NULL DEFAULT 'single',
            version INTEGER NOT NULL DEFAULT 1,
            plate_source TEXT,
            site_id TEXT,
            scale_id TEXT,
            scale_role TEXT,
            photo_entry_path TEXT,
            photo_exit_path TEXT
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

        CREATE TABLE IF NOT EXISTS ticket_audit (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            action TEXT NOT NULL,
            at TEXT NOT NULL,
            operator_name TEXT NOT NULL DEFAULT '',
            operator_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ticket_audit_ticket
            ON ticket_audit(ticket_id);

        CREATE TABLE IF NOT EXISTS vehicle_drivers (
            id TEXT PRIMARY KEY,
            vehicle_key TEXT NOT NULL,
            driver_name TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 1
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_drivers_key_name
            ON vehicle_drivers(vehicle_key, driver_name);

        CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vehicle_key
            ON vehicle_drivers(vehicle_key);

        CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scales (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            role TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            connection_json TEXT NOT NULL DEFAULT '{}',
            name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE (site_id, role)
        );

        CREATE INDEX IF NOT EXISTS idx_scales_site_id ON scales(site_id);

        CREATE TABLE IF NOT EXISTS site_runtime (
            site_id TEXT PRIMARY KEY,
            active_scale_set TEXT NOT NULL,
            camera_mode TEXT NOT NULL,
            anpr_mode TEXT NOT NULL,
            last_switch_reason TEXT,
            last_switch_comment TEXT,
            last_switch_operator_name TEXT,
            last_switch_operator_id TEXT,
            last_switch_at TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scale_switch_journal (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            from_set TEXT NOT NULL,
            to_set TEXT NOT NULL,
            reason TEXT NOT NULL,
            comment TEXT,
            operator_name TEXT NOT NULL DEFAULT '',
            operator_id TEXT,
            switched_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scale_switch_journal_site_at
            ON scale_switch_journal(site_id, switched_at);
        '''
    )
    ensure_ticket_schema(connection)


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


def _load_ticket_audit(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(AUDIT_COLUMNS)} FROM ticket_audit ORDER BY at ASC'
    ).fetchall()
    return [{column: row[column] for column in AUDIT_COLUMNS} for row in rows]


def _load_vehicle_drivers(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'''
        SELECT {", ".join(VEHICLE_DRIVER_COLUMNS)}
        FROM vehicle_drivers
        ORDER BY last_used_at DESC, use_count DESC
        '''
    ).fetchall()
    return [{column: row[column] for column in VEHICLE_DRIVER_COLUMNS} for row in rows]


def _load_sites(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SITE_COLUMNS)} FROM sites ORDER BY created_at ASC'
    ).fetchall()
    return [{column: row[column] for column in SITE_COLUMNS} for row in rows]


def _parse_connection_json(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or '{}')
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {}


def _load_scales(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SCALE_COLUMNS)} FROM scales ORDER BY created_at ASC'
    ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        items.append(
            {
                'id': row['id'],
                'site_id': row['site_id'],
                'role': row['role'],
                'adapter_id': row['adapter_id'],
                'connection': _parse_connection_json(row['connection_json']),
                'name': row['name'],
                'created_at': row['created_at'],
            }
        )
    return items


def _load_site_runtime(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SITE_RUNTIME_COLUMNS)} FROM site_runtime'
    ).fetchall()
    return [{column: row[column] for column in SITE_RUNTIME_COLUMNS} for row in rows]


def _load_scale_switch_journal(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'''
        SELECT {", ".join(SCALE_SWITCH_JOURNAL_COLUMNS)}
        FROM scale_switch_journal
        ORDER BY switched_at ASC
        '''
    ).fetchall()
    return [{column: row[column] for column in SCALE_SWITCH_JOURNAL_COLUMNS} for row in rows]


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

        audit_events = _load_ticket_audit(connection)
        if audit_events:
            result[STORAGE_KEYS['ticket_audit']] = json.dumps(audit_events, ensure_ascii=False)

        vehicle_drivers = _load_vehicle_drivers(connection)
        if vehicle_drivers:
            result[STORAGE_KEYS['vehicle_drivers']] = json.dumps(
                vehicle_drivers, ensure_ascii=False
            )

        sites = _load_sites(connection)
        if sites:
            result[STORAGE_KEYS['sites']] = json.dumps(sites, ensure_ascii=False)

        scales = _load_scales(connection)
        if scales:
            result[STORAGE_KEYS['scales']] = json.dumps(scales, ensure_ascii=False)

        site_runtime = _load_site_runtime(connection)
        if site_runtime:
            result[STORAGE_KEYS['site_runtime']] = json.dumps(
                site_runtime, ensure_ascii=False
            )

        scale_switch_journal = _load_scale_switch_journal(connection)
        if scale_switch_journal:
            result[STORAGE_KEYS['scale_switch_journal']] = json.dumps(
                scale_switch_journal, ensure_ascii=False
            )

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
        values = []
        for column in TICKET_COLUMNS:
            if column == 'weighing_mode':
                values.append(ticket.get(column) if ticket.get(column) is not None else 'single')
            elif column == 'version':
                values.append(ticket.get(column) if ticket.get(column) is not None else 1)
            else:
                values.append(ticket.get(column))
        connection.execute(
            f'''
            INSERT INTO weighing_tickets ({", ".join(TICKET_COLUMNS)})
            VALUES ({", ".join(['?'] * len(TICKET_COLUMNS))})
            ''',
            values,
        )


def _replace_ticket_audit(connection: sqlite3.Connection, events: list[Any]) -> None:
    connection.execute('DELETE FROM ticket_audit')
    for event in events:
        if not isinstance(event, dict):
            continue
        connection.execute(
            f'''
            INSERT INTO ticket_audit ({", ".join(AUDIT_COLUMNS)})
            VALUES ({", ".join(['?'] * len(AUDIT_COLUMNS))})
            ''',
            (
                str(event.get('id', '')),
                str(event.get('ticket_id', '')),
                str(event.get('action', '')),
                str(event.get('at', '')),
                str(event.get('operator_name', '')),
                event.get('operator_id'),
            ),
        )


def _replace_vehicle_drivers(connection: sqlite3.Connection, rows: list[Any]) -> None:
    connection.execute('DELETE FROM vehicle_drivers')
    for row in rows:
        if not isinstance(row, dict):
            continue
        use_count = row.get('use_count')
        try:
            use_count_int = int(use_count) if use_count is not None else 1
        except (TypeError, ValueError):
            use_count_int = 1
        if use_count_int < 1:
            use_count_int = 1
        connection.execute(
            f'''
            INSERT INTO vehicle_drivers ({", ".join(VEHICLE_DRIVER_COLUMNS)})
            VALUES ({", ".join(['?'] * len(VEHICLE_DRIVER_COLUMNS))})
            ''',
            (
                str(row.get('id', '')),
                str(row.get('vehicle_key', '')),
                str(row.get('driver_name', '')),
                str(row.get('last_used_at', '')),
                use_count_int,
            ),
        )


def _replace_sites(connection: sqlite3.Connection, rows: list[Any]) -> None:
    connection.execute('DELETE FROM sites')
    for row in rows:
        if not isinstance(row, dict):
            continue
        connection.execute(
            f'''
            INSERT INTO sites ({", ".join(SITE_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SITE_COLUMNS))})
            ''',
            (
                str(row.get('id', '')),
                str(row.get('name', '')),
                str(row.get('created_at', '')),
            ),
        )


def _replace_scales(connection: sqlite3.Connection, rows: list[Any]) -> None:
    connection.execute('DELETE FROM scales')
    for row in rows:
        if not isinstance(row, dict):
            continue
        connection_obj = row.get('connection')
        if isinstance(connection_obj, dict):
            connection_json = json.dumps(connection_obj, ensure_ascii=False)
        elif isinstance(row.get('connection_json'), str):
            connection_json = str(row.get('connection_json') or '{}')
        else:
            connection_json = '{}'
        connection.execute(
            f'''
            INSERT INTO scales ({", ".join(SCALE_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SCALE_COLUMNS))})
            ''',
            (
                str(row.get('id', '')),
                str(row.get('site_id', '')),
                str(row.get('role', '')),
                str(row.get('adapter_id', 'web_serial')),
                connection_json,
                str(row.get('name', '')),
                str(row.get('created_at', '')),
            ),
        )


def _replace_site_runtime(connection: sqlite3.Connection, rows: list[Any]) -> None:
    connection.execute('DELETE FROM site_runtime')
    for row in rows:
        if not isinstance(row, dict):
            continue
        connection.execute(
            f'''
            INSERT INTO site_runtime ({", ".join(SITE_RUNTIME_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SITE_RUNTIME_COLUMNS))})
            ''',
            (
                str(row.get('site_id', '')),
                str(row.get('active_scale_set', 'primary')),
                str(row.get('camera_mode', 'primary')),
                str(row.get('anpr_mode', 'enabled')),
                row.get('last_switch_reason'),
                row.get('last_switch_comment'),
                row.get('last_switch_operator_name'),
                row.get('last_switch_operator_id'),
                row.get('last_switch_at'),
                str(row.get('updated_at', '')),
            ),
        )


def _replace_scale_switch_journal(connection: sqlite3.Connection, rows: list[Any]) -> None:
    connection.execute('DELETE FROM scale_switch_journal')
    for row in rows:
        if not isinstance(row, dict):
            continue
        connection.execute(
            f'''
            INSERT INTO scale_switch_journal ({", ".join(SCALE_SWITCH_JOURNAL_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SCALE_SWITCH_JOURNAL_COLUMNS))})
            ''',
            (
                str(row.get('id', '')),
                str(row.get('site_id', '')),
                str(row.get('from_set', '')),
                str(row.get('to_set', '')),
                str(row.get('reason', '')),
                row.get('comment'),
                str(row.get('operator_name', '')),
                row.get('operator_id'),
                str(row.get('switched_at', '')),
            ),
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

        if STORAGE_KEYS['users'] in data:
            try:
                users = json.loads(str(data[STORAGE_KEYS['users']]))
                if isinstance(users, list):
                    _replace_users(connection, users)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['profiles'] in data:
            try:
                profiles = json.loads(str(data[STORAGE_KEYS['profiles']]))
                if isinstance(profiles, dict):
                    _replace_profiles(connection, profiles)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['tickets'] in data:
            try:
                tickets = json.loads(str(data[STORAGE_KEYS['tickets']]))
                if isinstance(tickets, list):
                    _replace_tickets(connection, tickets)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['ticket_audit'] in data:
            try:
                events = json.loads(str(data[STORAGE_KEYS['ticket_audit']]))
                if isinstance(events, list):
                    _replace_ticket_audit(connection, events)
            except json.JSONDecodeError:
                logger.warning('Invalid JSON for %s', STORAGE_KEYS['ticket_audit'])

        if STORAGE_KEYS['vehicle_drivers'] in data:
            try:
                rows = json.loads(str(data[STORAGE_KEYS['vehicle_drivers']]))
                if isinstance(rows, list):
                    _replace_vehicle_drivers(connection, rows)
            except json.JSONDecodeError:
                logger.warning(
                    'Invalid JSON for %s; vehicle_drivers not replaced',
                    STORAGE_KEYS['vehicle_drivers'],
                )
            except Exception:
                logger.exception('Failed to replace vehicle_drivers')
                raise

        # Order: sites → scales → runtime → journal (logical FK)
        if STORAGE_KEYS['sites'] in data:
            try:
                rows = json.loads(str(data[STORAGE_KEYS['sites']]))
                if isinstance(rows, list):
                    _replace_sites(connection, rows)
            except json.JSONDecodeError:
                logger.warning(
                    'Invalid JSON for %s; sites not replaced',
                    STORAGE_KEYS['sites'],
                )
            except Exception:
                logger.exception('Failed to replace sites')
                raise

        if STORAGE_KEYS['scales'] in data:
            try:
                rows = json.loads(str(data[STORAGE_KEYS['scales']]))
                if isinstance(rows, list):
                    _replace_scales(connection, rows)
            except json.JSONDecodeError:
                logger.warning(
                    'Invalid JSON for %s; scales not replaced',
                    STORAGE_KEYS['scales'],
                )
            except Exception:
                logger.exception('Failed to replace scales')
                raise

        if STORAGE_KEYS['site_runtime'] in data:
            try:
                rows = json.loads(str(data[STORAGE_KEYS['site_runtime']]))
                if isinstance(rows, list):
                    _replace_site_runtime(connection, rows)
            except json.JSONDecodeError:
                logger.warning(
                    'Invalid JSON for %s; site_runtime not replaced',
                    STORAGE_KEYS['site_runtime'],
                )
            except Exception:
                logger.exception('Failed to replace site_runtime')
                raise

        if STORAGE_KEYS['scale_switch_journal'] in data:
            try:
                rows = json.loads(str(data[STORAGE_KEYS['scale_switch_journal']]))
                if isinstance(rows, list):
                    _replace_scale_switch_journal(connection, rows)
            except json.JSONDecodeError:
                logger.warning(
                    'Invalid JSON for %s; scale_switch_journal not replaced',
                    STORAGE_KEYS['scale_switch_journal'],
                )
            except Exception:
                logger.exception('Failed to replace scale_switch_journal')
                raise

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
