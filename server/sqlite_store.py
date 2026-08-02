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
    'ticket_audit': 'app_ticket_audit',
    'vehicle_drivers': 'app_vehicle_drivers',
    'sites': 'app_sites',
    'scales': 'app_scales',
    'site_runtime': 'app_site_runtime',
    'site_scale_switches': 'app_site_scale_switches',
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
    'plate_source', 'site_id', 'scale_id', 'scale_role',
    'photo_entry_path', 'photo_exit_path', 'photo_overview_path',
    'manual_weight_reason',
]

AUDIT_COLUMNS = [
    'id', 'ticket_id', 'action', 'at', 'operator_name', 'operator_id',
]

VEHICLE_DRIVER_COLUMNS = [
    'id', 'vehicle_number', 'driver_name', 'last_used_at', 'use_count', 'driver_id',
]

SITE_COLUMNS = [
    'id', 'name', 'is_default', 'created_at',
]

SCALE_COLUMNS = [
    'id', 'site_id', 'role', 'name', 'adapter_id', 'connection', 'enabled', 'created_at',
]

SITE_RUNTIME_COLUMNS = [
    'site_id', 'active_scale_set', 'camera_mode', 'anpr_mode',
    'switch_reason', 'switch_by_operator_id', 'switch_by_operator_name', 'switch_at',
]

SITE_SCALE_SWITCH_COLUMNS = [
    'id', 'site_id', 'from_set', 'to_set', 'reason',
    'operator_id', 'operator_name', 'at', 'camera_ack',
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


def ensure_ticket_schema(connection: sqlite3.Connection) -> None:
    """Ensure weighing_tickets columns, ticket_audit, vehicle_drivers, sites/scales, and open→dual backfill."""
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

    connection.execute(
        '''
        CREATE TABLE IF NOT EXISTS vehicle_drivers (
            id TEXT PRIMARY KEY,
            vehicle_number TEXT NOT NULL,
            driver_name TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 1,
            driver_id TEXT
        )
        '''
    )
    connection.execute(
        '''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_drivers_pair
            ON vehicle_drivers(vehicle_number, driver_name)
        '''
    )
    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vehicle
            ON vehicle_drivers(vehicle_number)
        '''
    )

    _ensure_site_tables(connection)

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

    for column in (
        'plate_source',
        'site_id',
        'scale_id',
        'scale_role',
        'photo_entry_path',
        'photo_exit_path',
        'photo_overview_path',
        'manual_weight_reason',
    ):
        if column not in existing:
            connection.execute(f'ALTER TABLE weighing_tickets ADD COLUMN {column} TEXT')

    if column_weighing_mode_added:
        # One-shot backfill: only right after ADD COLUMN weighing_mode.
        connection.execute(
            "UPDATE weighing_tickets SET weighing_mode = 'dual' WHERE status = 'open'"
        )


def _ensure_site_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        '''
        CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
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
            name TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            connection TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        )
        '''
    )
    connection.execute(
        'CREATE INDEX IF NOT EXISTS idx_scales_site_role ON scales(site_id, role)'
    )
    connection.execute(
        '''
        CREATE TABLE IF NOT EXISTS site_runtime (
            site_id TEXT PRIMARY KEY,
            active_scale_set TEXT NOT NULL,
            camera_mode TEXT NOT NULL,
            anpr_mode TEXT NOT NULL,
            switch_reason TEXT,
            switch_by_operator_id TEXT,
            switch_by_operator_name TEXT,
            switch_at TEXT,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        )
        '''
    )
    connection.execute(
        '''
        CREATE TABLE IF NOT EXISTS site_scale_switches (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            from_set TEXT NOT NULL,
            to_set TEXT NOT NULL,
            reason TEXT NOT NULL,
            operator_id TEXT,
            operator_name TEXT NOT NULL,
            at TEXT NOT NULL,
            camera_ack TEXT,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        )
        '''
    )
    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_site_scale_switches_site_at
            ON site_scale_switches(site_id, at)
        '''
    )


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
            photo_exit_path TEXT,
            photo_overview_path TEXT,
            manual_weight_reason TEXT
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
            vehicle_number TEXT NOT NULL,
            driver_name TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 1,
            driver_id TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_drivers_pair
            ON vehicle_drivers(vehicle_number, driver_name);

        CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vehicle
            ON vehicle_drivers(vehicle_number);

        CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scales (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            adapter_id TEXT NOT NULL,
            connection TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        );

        CREATE INDEX IF NOT EXISTS idx_scales_site_role ON scales(site_id, role);

        CREATE TABLE IF NOT EXISTS site_runtime (
            site_id TEXT PRIMARY KEY,
            active_scale_set TEXT NOT NULL,
            camera_mode TEXT NOT NULL,
            anpr_mode TEXT NOT NULL,
            switch_reason TEXT,
            switch_by_operator_id TEXT,
            switch_by_operator_name TEXT,
            switch_at TEXT,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        );

        CREATE TABLE IF NOT EXISTS site_scale_switches (
            id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,
            from_set TEXT NOT NULL,
            to_set TEXT NOT NULL,
            reason TEXT NOT NULL,
            operator_id TEXT,
            operator_name TEXT NOT NULL,
            at TEXT NOT NULL,
            camera_ack TEXT,
            FOREIGN KEY (site_id) REFERENCES sites(id)
        );

        CREATE INDEX IF NOT EXISTS idx_site_scale_switches_site_at
            ON site_scale_switches(site_id, at);
        '''
    )
    ensure_ticket_schema(connection)


def _table_count(connection: sqlite3.Connection, table: str) -> int:
    row = connection.execute(f'SELECT COUNT(*) AS count FROM {table}').fetchone()
    return int(row['count']) if row else 0


def database_has_data(connection: sqlite3.Connection) -> bool:
    for table in (
        'users',
        'weighing_tickets',
        'dictionary_entries',
        'app_sessions',
        'vehicle_drivers',
        'sites',
        'scales',
    ):
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
        f'SELECT {", ".join(VEHICLE_DRIVER_COLUMNS)} FROM vehicle_drivers'
        ' ORDER BY last_used_at DESC'
    ).fetchall()
    return [{column: row[column] for column in VEHICLE_DRIVER_COLUMNS} for row in rows]


def _load_sites(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SITE_COLUMNS)} FROM sites ORDER BY created_at ASC'
    ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                'id': row['id'],
                'name': row['name'],
                'is_default': bool(row['is_default']),
                'created_at': row['created_at'],
            }
        )
    return result


def _load_scales(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SCALE_COLUMNS)} FROM scales ORDER BY created_at ASC'
    ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        connection_raw = row['connection']
        try:
            connection_obj = json.loads(connection_raw) if connection_raw else {}
        except (TypeError, json.JSONDecodeError):
            connection_obj = {}
        result.append(
            {
                'id': row['id'],
                'site_id': row['site_id'],
                'role': row['role'],
                'name': row['name'],
                'adapter_id': row['adapter_id'],
                'connection': connection_obj,
                'enabled': bool(row['enabled']),
                'created_at': row['created_at'],
            }
        )
    return result


def _load_site_runtime(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SITE_RUNTIME_COLUMNS)} FROM site_runtime'
    ).fetchall()
    return [{column: row[column] for column in SITE_RUNTIME_COLUMNS} for row in rows]


def _load_site_scale_switches(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(SITE_SCALE_SWITCH_COLUMNS)} FROM site_scale_switches'
        ' ORDER BY at ASC'
    ).fetchall()
    return [{column: row[column] for column in SITE_SCALE_SWITCH_COLUMNS} for row in rows]


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
            result[STORAGE_KEYS['site_runtime']] = json.dumps(site_runtime, ensure_ascii=False)

        site_switches = _load_site_scale_switches(connection)
        if site_switches:
            result[STORAGE_KEYS['site_scale_switches']] = json.dumps(
                site_switches, ensure_ascii=False
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


def _default_weighing_mode(ticket: dict[str, Any]) -> str:
    """Match client normalizeWeighingMode: missing mode → dual if open, else single."""
    mode = ticket.get('weighing_mode')
    if mode is not None and mode != '':
        return str(mode)
    status = ticket.get('status') or 'open'
    return 'dual' if status == 'open' else 'single'


def _replace_tickets(connection: sqlite3.Connection, tickets: list[Any]) -> None:
    connection.execute('DELETE FROM weighing_tickets')
    for ticket in tickets:
        if not isinstance(ticket, dict):
            continue
        values = []
        for column in TICKET_COLUMNS:
            if column == 'weighing_mode':
                values.append(_default_weighing_mode(ticket))
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


def _replace_vehicle_drivers(connection: sqlite3.Connection, links: list[Any]) -> None:
    connection.execute('DELETE FROM vehicle_drivers')
    for link in links:
        if not isinstance(link, dict):
            continue
        use_count = link.get('use_count')
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
                str(link.get('id', '')),
                str(link.get('vehicle_number', '')),
                str(link.get('driver_name', '')),
                str(link.get('last_used_at', '')),
                use_count_int,
                link.get('driver_id'),
            ),
        )


def _replace_sites(connection: sqlite3.Connection, sites: list[Any]) -> None:
    connection.execute('DELETE FROM sites')
    for site in sites:
        if not isinstance(site, dict):
            continue
        is_default = site.get('is_default')
        connection.execute(
            f'''
            INSERT INTO sites ({", ".join(SITE_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SITE_COLUMNS))})
            ''',
            (
                str(site.get('id', '')),
                str(site.get('name', '')),
                1 if is_default else 0,
                str(site.get('created_at', '')),
            ),
        )


def _replace_scales(connection: sqlite3.Connection, scales: list[Any]) -> None:
    connection.execute('DELETE FROM scales')
    for scale in scales:
        if not isinstance(scale, dict):
            continue
        conn_val = scale.get('connection')
        if isinstance(conn_val, (dict, list)):
            connection_json = json.dumps(conn_val, ensure_ascii=False)
        else:
            connection_json = str(conn_val or '{}')
        enabled = scale.get('enabled')
        connection.execute(
            f'''
            INSERT INTO scales ({", ".join(SCALE_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SCALE_COLUMNS))})
            ''',
            (
                str(scale.get('id', '')),
                str(scale.get('site_id', '')),
                str(scale.get('role', '')),
                str(scale.get('name', '')),
                str(scale.get('adapter_id', '')),
                connection_json,
                1 if enabled else 0,
                str(scale.get('created_at', '')),
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
                str(row.get('camera_mode', 'normal')),
                str(row.get('anpr_mode', 'enabled')),
                row.get('switch_reason'),
                row.get('switch_by_operator_id'),
                row.get('switch_by_operator_name'),
                row.get('switch_at'),
            ),
        )


def _replace_site_scale_switches(connection: sqlite3.Connection, events: list[Any]) -> None:
    connection.execute('DELETE FROM site_scale_switches')
    for event in events:
        if not isinstance(event, dict):
            continue
        connection.execute(
            f'''
            INSERT INTO site_scale_switches ({", ".join(SITE_SCALE_SWITCH_COLUMNS)})
            VALUES ({", ".join(['?'] * len(SITE_SCALE_SWITCH_COLUMNS))})
            ''',
            (
                str(event.get('id', '')),
                str(event.get('site_id', '')),
                str(event.get('from_set', '')),
                str(event.get('to_set', '')),
                str(event.get('reason', '')),
                event.get('operator_id'),
                str(event.get('operator_name', '')),
                str(event.get('at', '')),
                event.get('camera_ack'),
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
                pass

        if STORAGE_KEYS['vehicle_drivers'] in data:
            try:
                links = json.loads(str(data[STORAGE_KEYS['vehicle_drivers']]))
                if isinstance(links, list):
                    _replace_vehicle_drivers(connection, links)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['sites'] in data:
            try:
                sites = json.loads(str(data[STORAGE_KEYS['sites']]))
                if isinstance(sites, list):
                    _replace_sites(connection, sites)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['scales'] in data:
            try:
                scales = json.loads(str(data[STORAGE_KEYS['scales']]))
                if isinstance(scales, list):
                    _replace_scales(connection, scales)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['site_runtime'] in data:
            try:
                runtime_rows = json.loads(str(data[STORAGE_KEYS['site_runtime']]))
                if isinstance(runtime_rows, list):
                    _replace_site_runtime(connection, runtime_rows)
            except json.JSONDecodeError:
                pass

        if STORAGE_KEYS['site_scale_switches'] in data:
            try:
                switches = json.loads(str(data[STORAGE_KEYS['site_scale_switches']]))
                if isinstance(switches, list):
                    _replace_site_scale_switches(connection, switches)
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
