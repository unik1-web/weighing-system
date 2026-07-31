import json
import logging
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILENAME = 'weighing.db'
SCHEMA_VERSION_STAGE_5 = 5
SCHEMA_VERSION_STAGE_6 = 6

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
    'scale_device', 'manual_weight_reason', 'operator_id', 'operator_name', 'status', 'reo_status', 'reo_sent_at',
    'auto_closed',
    'notes', 'created_at', 'completed_at',
    'weighing_mode', 'version',
    'plate_source', 'site_id', 'scale_id', 'scale_role', 'photo_entry_path', 'photo_exit_path',
]

AUDIT_COLUMNS = [
    'id', 'ticket_id', 'action', 'at', 'operator_name', 'operator_id',
    'event_type', 'source_year', 'changed_fields_json', 'old_values_json', 'new_values_json', 'reo_divergence_warning',
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


def get_sqlite_path(year: int | None = None, *, suffix: str = "") -> str:
    if year is None:
        filename = DB_FILENAME
    else:
        filename = f'weighing-{year}.db'
    return os.path.join(get_bd_dir(), f'{filename}{suffix}')


@contextmanager
def connect(db_path: str | None = None, *, read_only: bool = False):
    ensure_storage_dirs()
    selected_path = db_path or get_sqlite_path()
    if read_only:
        connection = sqlite3.connect(f'file:{selected_path}?mode=ro', uri=True)
    else:
        connection = sqlite3.connect(selected_path)
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

        if 'manual_weight_reason' not in existing:
            connection.execute(
                'ALTER TABLE weighing_tickets ADD COLUMN manual_weight_reason TEXT NULL'
            )

        if 'auto_closed' not in existing:
            connection.execute(
                'ALTER TABLE weighing_tickets ADD COLUMN auto_closed INTEGER NOT NULL DEFAULT 0'
            )

        if column_weighing_mode_added:
            # One-shot backfill: only right after ADD COLUMN weighing_mode.
            connection.execute(
                "UPDATE weighing_tickets SET weighing_mode = 'dual' WHERE status = 'open'"
            )
    except Exception:
        logger.exception('Failed to ensure ticket schema')
        raise


def _get_user_version(connection: sqlite3.Connection) -> int:
    row = connection.execute('PRAGMA user_version').fetchone()
    if row is None:
        return 0
    value = row[0] if not isinstance(row, sqlite3.Row) else row[0]
    return int(value or 0)


def _get_table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(row['name'])
        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }


def migrate_schema_stage_5(connection: sqlite3.Connection) -> None:
    """Apply add-only stage-5 migration and validate post-conditions."""
    ensure_ticket_schema(connection)

    ticket_columns = _get_table_columns(connection, 'weighing_tickets')
    if 'manual_weight_reason' not in ticket_columns:
        connection.execute(
            'ALTER TABLE weighing_tickets ADD COLUMN manual_weight_reason TEXT NULL'
        )
        ticket_columns = _get_table_columns(connection, 'weighing_tickets')

    current_version = _get_user_version(connection)
    if current_version < SCHEMA_VERSION_STAGE_5:
        connection.execute(f'PRAGMA user_version = {SCHEMA_VERSION_STAGE_5}')

    post_version = _get_user_version(connection)
    if post_version < SCHEMA_VERSION_STAGE_5:
        raise RuntimeError('Stage-5 migration failed: PRAGMA user_version is not 5')
    if 'manual_weight_reason' not in ticket_columns:
        raise RuntimeError(
            'Stage-5 migration failed: manual_weight_reason column is missing'
        )


def migrate_schema_stage_6(connection: sqlite3.Connection) -> None:
    """Apply add-only stage-6 migration and validate post-conditions."""
    ensure_ticket_schema(connection)

    ticket_columns = _get_table_columns(connection, 'weighing_tickets')
    if 'auto_closed' not in ticket_columns:
        connection.execute(
            'ALTER TABLE weighing_tickets ADD COLUMN auto_closed INTEGER NOT NULL DEFAULT 0'
        )
        ticket_columns = _get_table_columns(connection, 'weighing_tickets')

    audit_columns = _get_table_columns(connection, 'ticket_audit')
    audit_additions: tuple[tuple[str, str], ...] = (
        ('event_type', "TEXT NOT NULL DEFAULT ''"),
        ('source_year', 'INTEGER'),
        ('changed_fields_json', 'TEXT'),
        ('old_values_json', 'TEXT'),
        ('new_values_json', 'TEXT'),
        ('reo_divergence_warning', 'INTEGER NOT NULL DEFAULT 0'),
    )
    for column_name, column_sql in audit_additions:
        if column_name in audit_columns:
            continue
        connection.execute(f'ALTER TABLE ticket_audit ADD COLUMN {column_name} {column_sql}')
    audit_columns = _get_table_columns(connection, 'ticket_audit')

    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_ticket_audit_event_year
            ON ticket_audit(event_type, source_year)
        '''
    )
    connection.execute(
        '''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_audit_autoclose_once
            ON ticket_audit(ticket_id, event_type)
            WHERE event_type = 'auto_close'
        '''
    )
    connection.execute(
        '''
        CREATE UNIQUE INDEX IF NOT EXISTS tickets_number_uq
            ON weighing_tickets(ticket_number)
            WHERE ticket_number IS NOT NULL
        '''
    )
    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS tickets_status_created_idx
            ON weighing_tickets(status, created_at DESC)
        '''
    )
    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS tickets_reo_status_idx
            ON weighing_tickets(reo_status, created_at DESC)
        '''
    )
    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS tickets_vehicle_number_idx
            ON weighing_tickets(vehicle_number)
        '''
    )
    connection.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_ticket_audit_ticket_at
            ON ticket_audit(ticket_id, at ASC)
        '''
    )

    current_version = _get_user_version(connection)
    if current_version < SCHEMA_VERSION_STAGE_6:
        connection.execute(f'PRAGMA user_version = {SCHEMA_VERSION_STAGE_6}')

    post_version = _get_user_version(connection)
    if post_version < SCHEMA_VERSION_STAGE_6:
        raise RuntimeError('Stage-6 migration failed: PRAGMA user_version is not 6')
    if 'auto_closed' not in ticket_columns:
        raise RuntimeError('Stage-6 migration failed: auto_closed column is missing')
    for required_column in (
        'event_type',
        'source_year',
        'changed_fields_json',
        'old_values_json',
        'new_values_json',
        'reo_divergence_warning',
    ):
        if required_column not in audit_columns:
            raise RuntimeError(
                f'Stage-6 migration failed: {required_column} in ticket_audit is missing'
            )


def read_ticket_year_range(connection: sqlite3.Connection) -> dict[str, Any]:
    """
    Read ticket year range from legacy date columns.

    Returns:
        Dictionary with min/max year and unique years list.
    """
    cursor = connection.execute(
        '''
        SELECT created_at, gross_datetime, completed_at
        FROM weighing_tickets
        '''
    )
    years: set[int] = set()
    for row in cursor.fetchall():
        for column in ('created_at', 'gross_datetime', 'completed_at'):
            raw = row[column]
            if not raw:
                continue
            text = str(raw)
            year = None
            try:
                year = int(text[:4])
            except (TypeError, ValueError):
                year = None
            if year is not None and 1900 <= year <= 2100:
                years.add(year)
    sorted_years = sorted(years)
    return {
        'min_year': sorted_years[0] if sorted_years else None,
        'max_year': sorted_years[-1] if sorted_years else None,
        'years': sorted_years,
        'is_mixed': len(sorted_years) > 1,
    }


def count_stage6_tables(connection: sqlite3.Connection) -> dict[str, int]:
    """Count rows in key stage-6 tables."""
    table_names = (
        'users',
        'profiles',
        'weighing_tickets',
        'ticket_audit',
        'dictionary_entries',
        'vehicle_drivers',
        'sites',
        'scales',
        'site_runtime',
        'scale_switch_journal',
    )
    counts: dict[str, int] = {}
    for table in table_names:
        try:
            counts[table] = _table_count(connection, table)
        except sqlite3.Error:
            counts[table] = 0
    return counts


def backfill_stage6_audit_columns(connection: sqlite3.Connection, source_year: int) -> None:
    """
    Backfill stage-6 audit columns for legacy rows.

    Existing `ticket_audit` rows are enriched without changing their original
    semantic values. JSON diff columns stay NULL for legacy events.
    """
    connection.execute(
        '''
        UPDATE ticket_audit
        SET
            event_type = COALESCE(NULLIF(event_type, ''), action),
            source_year = COALESCE(source_year, ?),
            changed_fields_json = NULL,
            old_values_json = NULL,
            new_values_json = NULL,
            reo_divergence_warning = COALESCE(reo_divergence_warning, 0)
        ''',
        (int(source_year),),
    )


def validate_stage6_database(connection: sqlite3.Connection) -> dict[str, Any]:
    """
    Validate stage-6 migration post-conditions.

    Returns:
        Validation payload with `valid` flag and diagnostics.
    """
    ticket_columns = _get_table_columns(connection, 'weighing_tickets')
    audit_columns = _get_table_columns(connection, 'ticket_audit')
    required_ticket_columns = {'auto_closed'}
    required_audit_columns = {
        'event_type',
        'source_year',
        'changed_fields_json',
        'old_values_json',
        'new_values_json',
        'reo_divergence_warning',
    }
    indexes = {
        row['name']
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
        ).fetchall()
    }
    required_indexes = {
        'tickets_number_uq',
        'tickets_status_created_idx',
        'tickets_reo_status_idx',
        'tickets_vehicle_number_idx',
        'idx_ticket_audit_ticket_at',
        'idx_ticket_audit_event_year',
        'idx_ticket_audit_autoclose_once',
    }
    missing_ticket_columns = sorted(required_ticket_columns - ticket_columns)
    missing_audit_columns = sorted(required_audit_columns - audit_columns)
    missing_indexes = sorted(required_indexes - indexes)
    version = _get_user_version(connection)
    valid = (
        version >= SCHEMA_VERSION_STAGE_6
        and not missing_ticket_columns
        and not missing_audit_columns
        and not missing_indexes
    )
    return {
        'valid': valid,
        'schema_version': version,
        'missing_ticket_columns': missing_ticket_columns,
        'missing_audit_columns': missing_audit_columns,
        'missing_indexes': missing_indexes,
    }


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
            manual_weight_reason TEXT,
            operator_id TEXT,
            operator_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open',
            reo_status TEXT NOT NULL DEFAULT 'pending',
            reo_sent_at TEXT,
            auto_closed INTEGER NOT NULL DEFAULT 0,
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
            operator_id TEXT,
            event_type TEXT NOT NULL DEFAULT '',
            source_year INTEGER,
            changed_fields_json TEXT,
            old_values_json TEXT,
            new_values_json TEXT,
            reo_divergence_warning INTEGER NOT NULL DEFAULT 0
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
    migrate_schema_stage_5(connection)
    migrate_schema_stage_6(connection)


def _normalize_plate_for_lookup(value: str | None) -> str:
    """Normalize vehicle plate for dictionary lookup."""
    raw = (value or '').upper()
    return ''.join(char for char in raw if char.isalnum())


def _read_vehicle_tare_map(connection: sqlite3.Connection) -> dict[str, float]:
    """Build map `normalized_plate -> default_tare_weight` from vehicles dictionary."""
    rows = connection.execute(
        """
        SELECT name, payload
        FROM dictionary_entries
        WHERE category = 'vehicles'
        """
    ).fetchall()
    tare_map: dict[str, float] = {}
    for row in rows:
        payload_text = row['payload'] or '{}'
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            continue
        plate = payload.get('vehicle_number') or row['name']
        normalized_plate = _normalize_plate_for_lookup(str(plate or ''))
        if not normalized_plate:
            continue
        tare_value = payload.get('default_tare_weight')
        try:
            tare_float = float(tare_value)
        except (TypeError, ValueError):
            continue
        tare_map[normalized_plate] = tare_float
    return tare_map


def _build_source_db_fingerprint(path: str) -> str:
    """Generate deterministic source DB fingerprint from file metadata."""
    stat = os.stat(path)
    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace('+00:00', 'Z')
    return f"size:{stat.st_size};mtime:{mtime}"


def load_rotation_preview(
    source_db_path: str,
    source_year: int,
    target_year: int,
) -> dict[str, Any]:
    """Load open ticket candidates and source fingerprint for rotation preview."""
    if not os.path.isfile(source_db_path):
        raise FileNotFoundError(f'Active year database is missing: {source_db_path}')

    with sqlite3.connect(source_db_path) as connection:
        connection.row_factory = sqlite3.Row
        tare_map = _read_vehicle_tare_map(connection)
        pending_reo_count_row = connection.execute(
            "SELECT COUNT(*) AS count FROM weighing_tickets WHERE reo_status = 'pending'"
        ).fetchone()
        pending_reo_count = int(pending_reo_count_row['count']) if pending_reo_count_row else 0

        open_rows = connection.execute(
            """
            SELECT
                id,
                ticket_number,
                vehicle_number,
                gross_weight,
                tare_weight,
                net_weight,
                total_amount,
                price,
                vat_rate,
                created_at,
                operator_id,
                operator_name
            FROM weighing_tickets
            WHERE status = 'open'
            ORDER BY created_at ASC, ticket_number ASC
            """
        ).fetchall()

    open_candidates: list[dict[str, Any]] = []
    blocking_tickets: list[dict[str, Any]] = []
    for row in open_rows:
        normalized_plate = _normalize_plate_for_lookup(row['vehicle_number'])
        tare_from_dictionary = tare_map.get(normalized_plate)
        candidate = {
            'ticket_id': row['id'],
            'ticket_number': row['ticket_number'],
            'vehicle_number': row['vehicle_number'],
            'normalized_plate': normalized_plate,
            'gross_weight': row['gross_weight'],
            'price': row['price'],
            'vat_rate': row['vat_rate'],
            'operator_id': row['operator_id'],
            'operator_name': row['operator_name'],
            'tare_from_dictionary': tare_from_dictionary,
            'source_year': int(source_year),
            'target_year': int(target_year),
        }
        open_candidates.append(candidate)
        if tare_from_dictionary is None:
            blocking_tickets.append(
                {
                    'ticket_id': row['id'],
                    'ticket_number': row['ticket_number'],
                    'vehicle_number': row['vehicle_number'],
                    'reason': 'missing_tare_dictionary_and_default',
                }
            )

    return {
        'source_db_path': source_db_path,
        'source_year': int(source_year),
        'target_year': int(target_year),
        'source_db_fingerprint': _build_source_db_fingerprint(source_db_path),
        'open_candidates': open_candidates,
        'pending_reo_count': pending_reo_count,
        'blocking_tickets': blocking_tickets,
    }


def apply_auto_close_plan(
    connection: sqlite3.Connection | None,
    plan: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply auto-close plan and write idempotent `ticket_audit.auto_close` events."""
    from ticket_audit_stage6 import build_auto_close_audit_event

    if connection is None:
        raise ValueError('Active DB connection is required for auto-close plan')

    applied_ids: list[str] = []
    now_iso = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    for candidate in plan:
        ticket_id = str(candidate.get('ticket_id') or '').strip()
        if not ticket_id:
            continue

        already_applied = connection.execute(
            """
            SELECT 1
            FROM ticket_audit
            WHERE ticket_id = ? AND event_type = 'auto_close'
            LIMIT 1
            """,
            (ticket_id,),
        ).fetchone()
        if already_applied:
            continue

        ticket_row = connection.execute(
            """
            SELECT
                id,
                status,
                auto_closed,
                tare_weight,
                tare_source,
                net_weight,
                total_amount,
                gross_weight,
                price,
                vat_rate
            FROM weighing_tickets
            WHERE id = ?
            """,
            (ticket_id,),
        ).fetchone()
        if ticket_row is None:
            continue

        tare_weight = candidate.get('tare_weight')
        gross_weight = ticket_row['gross_weight']
        price = ticket_row['price'] or 0
        vat_rate = ticket_row['vat_rate'] or 0

        next_net_weight: float | None = None
        next_total_amount: float | None = None
        if gross_weight is not None and tare_weight is not None:
            next_net_weight = float(gross_weight) - float(tare_weight)
            next_total_amount = round(next_net_weight * float(price) * (1 + float(vat_rate) / 100), 2)

        next_status = str(candidate.get('status') or 'completed')
        next_tare_source = str(candidate.get('tare_source') or 'default')
        connection.execute(
            """
            UPDATE weighing_tickets
            SET
                status = ?,
                auto_closed = 1,
                tare_weight = ?,
                tare_source = ?,
                net_weight = ?,
                total_amount = ?,
                completed_at = COALESCE(completed_at, ?)
            WHERE id = ?
            """,
            (
                next_status,
                tare_weight,
                next_tare_source,
                next_net_weight,
                next_total_amount,
                now_iso,
                ticket_id,
            ),
        )

        old_values = {
            'status': ticket_row['status'],
            'auto_closed': bool(ticket_row['auto_closed']),
            'tare_weight': ticket_row['tare_weight'],
            'tare_source': ticket_row['tare_source'],
            'net_weight': ticket_row['net_weight'],
            'total_amount': ticket_row['total_amount'],
        }
        new_values = {
            'status': next_status,
            'auto_closed': True,
            'tare_weight': tare_weight,
            'tare_source': next_tare_source,
            'net_weight': next_net_weight,
            'total_amount': next_total_amount,
        }
        audit_event = build_auto_close_audit_event(
            ticket_id=ticket_id,
            source_year=candidate.get('source_year'),
            old_values=old_values,
            new_values=new_values,
            actor={
                'id': candidate.get('actor_id'),
                'display_name': str(candidate.get('actor_name') or 'system'),
            },
            timestamp=now_iso,
        )
        insert_ticket_audit_event(connection, audit_event)
        applied_ids.append(ticket_id)

    return {
        'status': 'ok',
        'auto_closed_count': len(applied_ids),
        'applied_ids': applied_ids,
    }


def copy_whitelist_data(
    source_conn: sqlite3.Connection,
    target_conn: sqlite3.Connection,
) -> dict[str, int]:
    """Copy stage-6 whitelist entities from source DB to target DB."""
    source_conn.row_factory = sqlite3.Row
    target_conn.row_factory = sqlite3.Row

    copied: dict[str, int] = {}

    def _copy_table(table: str, where_sql: str = '', params: tuple[Any, ...] = ()) -> int:
        columns = [row['name'] for row in source_conn.execute(f'PRAGMA table_info({table})').fetchall()]
        if not columns:
            return 0
        query = f"SELECT {', '.join(columns)} FROM {table}"
        if where_sql:
            query += f' WHERE {where_sql}'
        rows = source_conn.execute(query, params).fetchall()
        if rows:
            placeholders = ', '.join(['?'] * len(columns))
            target_conn.executemany(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                [tuple(row[column] for column in columns) for row in rows],
            )
        return len(rows)

    copied['users'] = _copy_table('users')
    copied['profiles'] = _copy_table('profiles')
    copied['vehicle_drivers'] = _copy_table('vehicle_drivers')
    copied['sites'] = _copy_table('sites')
    copied['scales'] = _copy_table('scales')
    copied['site_runtime'] = _copy_table('site_runtime')
    copied['dictionary_entries'] = _copy_table(
        'dictionary_entries',
        "category IN (?, ?, ?, ?, ?, ?)",
        ('vehicles', 'drivers', 'cargos', 'shippers', 'receivers', 'carriers'),
    )

    target_conn.execute('DELETE FROM app_sessions')
    return copied


def assert_no_forbidden_runtime_keys(target_conn: sqlite3.Connection) -> None:
    """Validate deny-by-default absence of session/runtime app_* rows."""
    target_conn.row_factory = sqlite3.Row
    app_tables = [
        row['name']
        for row in target_conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'app_%'"
        ).fetchall()
    ]
    for table_name in app_tables:
        count = _table_count(target_conn, table_name)
        if count > 0:
            raise RuntimeError(
                f'Target DB contains forbidden runtime/session data in table {table_name}'
            )


def validate_new_year_database(target_conn: sqlite3.Connection) -> dict[str, Any]:
    """Validate fresh year DB invariants after whitelist copy."""
    assert_no_forbidden_runtime_keys(target_conn)
    forbidden_nonzero: dict[str, int] = {}
    for table_name in ('weighing_tickets', 'ticket_audit', 'scale_switch_journal'):
        count = _table_count(target_conn, table_name)
        if count > 0:
            forbidden_nonzero[table_name] = count
    return {
        'valid': len(forbidden_nonzero) == 0,
        'forbidden_nonzero': forbidden_nonzero,
    }


def _archive_ticket_matches_filters(ticket: dict[str, Any], filters: dict[str, Any]) -> bool:
    """Apply optional archive journal filters to a mapped ticket."""
    status = filters.get('status')
    if status not in (None, '', 'all') and str(ticket.get('status') or '') != str(status):
        return False

    reo_status = filters.get('reo_status')
    if reo_status not in (None, '', 'all') and str(ticket.get('reo_status') or '') != str(reo_status):
        return False

    query = str(filters.get('q') or '').strip().lower()
    if not query:
        return True

    haystack = ' '.join(
        [
            str(ticket.get('ticket_number') or ''),
            str(ticket.get('vehicle_number') or ''),
            str(ticket.get('driver_name') or ''),
            str(ticket.get('cargo_name') or ''),
            str(ticket.get('status') or ''),
            str(ticket.get('reo_status') or ''),
        ]
    ).lower()
    return query in haystack


def read_archive_tickets(db_path: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    Read tickets from an archive DB in read-only mode.

    Args:
        db_path: Absolute path to yearly archive SQLite file.
        filters: Optional journal filters (`q`, `status`, `reo_status`).

    Returns:
        Mapped ticket dictionaries ordered by created_at DESC.
    """
    selected_filters = filters or {}
    with connect(db_path=db_path, read_only=True) as connection:
        tickets = _load_tickets(connection)
    return [
        ticket
        for ticket in tickets
        if _archive_ticket_matches_filters(ticket, selected_filters)
    ]


def read_archive_ticket(db_path: str, ticket_id: str) -> dict[str, Any] | None:
    """
    Read one archive ticket by id from a yearly DB in read-only mode.

    Args:
        db_path: Absolute path to yearly archive SQLite file.
        ticket_id: Ticket identifier.

    Returns:
        Mapped ticket dict or None when the ticket is absent.
    """
    with connect(db_path=db_path, read_only=True) as connection:
        row = connection.execute(
            f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets WHERE id = ?',
            (ticket_id,),
        ).fetchone()
    if row is None:
        return None
    return map_ticket_row(row)


def read_archive_ticket_rows(db_path: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
    """Backward-compatible alias for `read_archive_tickets`."""
    return read_archive_tickets(db_path, filters)


def update_archive_ticket(db_path: str, ticket_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Return stage-6 stub patched ticket payload (legacy helper for early stubs)."""
    _ = db_path
    ticket: dict[str, Any] = {
        'id': ticket_id,
        'ticket_number': 0,
        'status': 'completed',
        'reo_status': 'pending',
        'auto_closed': False,
    }
    ticket.update(patch)
    return ticket


ARCHIVE_EDIT_PERSIST_FIELDS: tuple[str, ...] = (
    'vehicle_number',
    'vehicle_brand',
    'trailer_number',
    'driver_name',
    'cargo_name',
    'shipper_name',
    'receiver_name',
    'carrier_name',
    'gross_weight',
    'tare_weight',
    'net_weight',
    'total_amount',
    'notes',
)


def read_archive_ticket_for_update(
    connection: sqlite3.Connection,
    ticket_id: str,
) -> dict[str, Any] | None:
    """
    Read a weighing ticket inside an open archive write transaction.

    Args:
        connection: Writable SQLite connection to the archive year DB.
        ticket_id: Ticket identifier.

    Returns:
        Mapped ticket dict or None when missing.
    """
    row = connection.execute(
        f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets WHERE id = ?',
        (ticket_id,),
    ).fetchone()
    if row is None:
        return None
    return map_ticket_row(row)


def save_archive_ticket_edit(
    connection: sqlite3.Connection,
    ticket_id: str,
    updated_ticket: dict[str, Any],
) -> dict[str, Any]:
    """
    Persist allowlisted archive-edit fields and derived totals.

    Does not modify `reo_status`, identifiers, or other denylisted columns.

    Args:
        connection: Writable archive DB connection (same transaction as audit).
        ticket_id: Ticket identifier.
        updated_ticket: Full ticket dict after patch + recalculation.

    Returns:
        Fresh ticket row after UPDATE.

    Raises:
        ValueError: when the ticket row is missing after update.
    """
    assignments = ', '.join(f'{column} = ?' for column in ARCHIVE_EDIT_PERSIST_FIELDS)
    values = [updated_ticket.get(column) for column in ARCHIVE_EDIT_PERSIST_FIELDS]
    values.append(ticket_id)
    connection.execute(
        f'UPDATE weighing_tickets SET {assignments} WHERE id = ?',
        values,
    )
    saved = read_archive_ticket_for_update(connection, ticket_id)
    if saved is None:
        raise ValueError(f'Archive ticket disappeared during edit: {ticket_id}')
    return saved


def insert_ticket_audit_event(
    connection: sqlite3.Connection,
    event: dict[str, Any],
) -> dict[str, Any]:
    """
    Insert a stage-6 audit event into existing `ticket_audit` table.

    Args:
        connection: Writable SQLite connection.
        event: Logical audit payload from `ticket_audit_stage6` builders.

    Returns:
        The persisted logical event (same shape, with generated id if needed).
    """
    event_id = str(event.get('id') or uuid.uuid4())
    event_type = str(event.get('event_type') or event.get('action') or '')
    timestamp = str(event.get('timestamp') or event.get('at') or '')
    actor_id = event.get('actor_id') if event.get('actor_id') is not None else event.get('operator_id')
    actor_name = (
        event.get('actor_name')
        if event.get('actor_name') is not None
        else event.get('operator_name')
    )
    changed_fields = event.get('changed_fields') or []
    old_values = event.get('old_values') or {}
    new_values = event.get('new_values') or {}
    reo_warning = 1 if event.get('reo_divergence_warning') else 0

    connection.execute(
        f'''
        INSERT INTO ticket_audit ({", ".join(AUDIT_COLUMNS)})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            event_id,
            event.get('ticket_id'),
            event_type,
            timestamp,
            actor_name,
            actor_id,
            event_type,
            event.get('source_year'),
            json.dumps(changed_fields, ensure_ascii=False),
            json.dumps(old_values, ensure_ascii=False),
            json.dumps(new_values, ensure_ascii=False),
            reo_warning,
        ),
    )
    return {
        **event,
        'id': event_id,
        'action': event_type,
        'event_type': event_type,
        'at': timestamp,
        'timestamp': timestamp,
        'actor_id': actor_id,
        'actor_name': actor_name,
        'operator_id': actor_id,
        'operator_name': actor_name,
        'changed_fields': list(changed_fields),
        'old_values': dict(old_values),
        'new_values': dict(new_values),
        'reo_divergence_warning': bool(reo_warning),
    }


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


def map_ticket_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    """
    Map a weighing_tickets row to the shared ticket dict contract.

    Reused by active storage reads and archive read helpers.
    """
    ticket = {column: row[column] for column in TICKET_COLUMNS}
    ticket['auto_closed'] = bool(ticket.get('auto_closed') or False)
    return ticket


def _load_tickets(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets ORDER BY created_at DESC'
    ).fetchall()
    return [map_ticket_row(row) for row in rows]


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


def next_ticket_number(connection: sqlite3.Connection) -> int:
    """
    Calculate next ticket number inside current SQLite database file.

    Numbering is year-local because each yearly DB is an isolated container.
    """
    row = connection.execute(
        'SELECT MAX(ticket_number) AS max_ticket_number FROM weighing_tickets'
    ).fetchone()
    max_ticket_number = 0
    if row and row['max_ticket_number'] is not None:
        max_ticket_number = int(row['max_ticket_number'])
    return max_ticket_number + 1


def read_database(db_path: str | None = None) -> dict[str, str]:
    if db_path is None:
        migrate_json_database_if_needed()
    result: dict[str, str] = {}

    with connect(db_path=db_path) as connection:
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


def read_runtime_snapshot(db_path: str | None = None) -> dict[str, Any]:
    """Read runtime-critical storage blobs as one SQLite snapshot."""
    if db_path is None:
        migrate_json_database_if_needed()
    with connect(db_path=db_path) as connection:
        init_schema(connection)
        return {
            'sites': _load_sites(connection),
            'scales': _load_scales(connection),
            'site_runtime': _load_site_runtime(connection),
            'current_user': _load_session(connection),
        }


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
            elif column == 'auto_closed':
                values.append(ticket.get(column) if ticket.get(column) is not None else 0)
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
                str(event.get('event_type', event.get('action', ''))),
                event.get('source_year'),
                event.get('changed_fields_json'),
                event.get('old_values_json'),
                event.get('new_values_json'),
                event.get('reo_divergence_warning', 0),
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


def write_database(data: dict[str, Any], db_path: str | None = None) -> None:
    with connect(db_path=db_path) as connection:
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
