import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from typing import Any, Callable

from config_ini import (
    BACKUP_SECTION,
    CONFIG_SECTION,
    DATABASE_SECTION,
    dump_ini,
    parse_ini,
    read_ini_section,
    write_ini_section,
)
from sqlite_store import (
    SCHEMA_VERSION_STAGE_5,
    get_sqlite_path,
    migrate_schema_stage_5,
    read_database as read_sqlite_database,
    write_database as write_sqlite_database,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SETTINGS_KEY = 'app_settings'
BACKUP_VERSION = 3
LEGACY_CONFIG_JSON = 'config.json'
CONFIG_INI = 'config.ini'
DEFAULT_MANUAL_WEIGHT_REASON_POLICY = 'optional'
_RUNTIME_CRITICAL_KEYS = {'app_scales', 'app_site_runtime', 'app_current_user'}
_runtime_invalidator: Callable[[set[str]], None] | None = None
STAGE5_CONFIG_BACKUP = 'config.stage5.bak.ini'
STAGE5_DB_BACKUP = 'weighing.stage5.bak.db'
ROTATION_LOCK_TTL_SECONDS = 15 * 60


def get_app_root() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.abspath(os.path.join(BASE_DIR, '..'))


def get_config_path() -> str:
    return os.path.join(get_app_root(), CONFIG_INI)


def get_legacy_config_json_path() -> str:
    return os.path.join(get_app_root(), LEGACY_CONFIG_JSON)


def get_bd_dir() -> str:
    return os.path.join(get_app_root(), 'BD')


def get_json_database_path() -> str:
    return os.path.join(get_bd_dir(), 'app_data.json')


def get_database_path() -> str:
    return get_sqlite_path()


def get_year_database_path(year: int, *, suffix: str = "") -> str:
    """Build path for year-scoped SQLite database."""
    return get_sqlite_path(year=year, suffix=suffix)


def get_legacy_storage_path() -> str:
    return os.path.join(BASE_DIR, 'data', 'app_storage.json')


def ensure_storage_dirs() -> None:
    os.makedirs(get_bd_dir(), exist_ok=True)


def get_backup_dir() -> str:
    return os.path.join(get_app_root(), 'backup')


def get_rotation_lock_path() -> str:
    """Return lock-file path for stage-6 year rotation."""
    return os.path.join(get_bd_dir(), '.year_rotation.lock')


def _parse_iso_datetime(value: str | None) -> datetime | None:
    """Parse ISO8601 value used in lock payload."""
    if not value:
        return None
    try:
        normalized = value.replace('Z', '+00:00')
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def read_rotation_lock() -> dict[str, Any] | None:
    """Read and parse `BD/.year_rotation.lock` payload."""
    path = get_rotation_lock_path()
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def write_rotation_lock(payload: dict[str, Any]) -> None:
    """
    Persist rotation lock payload atomically.

    Raises:
        FileExistsError: if lock already exists.
    """
    ensure_storage_dirs()
    required = {
        'source_year',
        'target_year',
        'preview_token',
        'source_db_fingerprint',
        'started_at',
        'phase',
        'recovery_mode',
        'backup_path',
        'tmp_db_path',
        'lock_ttl_seconds',
    }
    prepared = dict(payload)
    missing = sorted(required - set(prepared.keys()))
    if missing:
        raise ValueError(f'Rotation lock payload is missing fields: {", ".join(missing)}')

    path = get_rotation_lock_path()
    serialized = json.dumps(prepared, ensure_ascii=False, separators=(',', ':'))
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(serialized)
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def remove_rotation_lock() -> None:
    """Delete lock file if it exists."""
    path = get_rotation_lock_path()
    if not os.path.isfile(path):
        return
    os.unlink(path)


def rotation_lock_is_stale(payload: dict[str, Any], now: datetime) -> bool:
    """Check whether rotation lock TTL has expired."""
    started_at = _parse_iso_datetime(str(payload.get('started_at') or ''))
    if started_at is None:
        return True
    ttl_value = payload.get('lock_ttl_seconds', ROTATION_LOCK_TTL_SECONDS)
    try:
        ttl_seconds = int(ttl_value)
    except (TypeError, ValueError):
        ttl_seconds = ROTATION_LOCK_TTL_SECONDS
    elapsed = (now - started_at).total_seconds()
    return elapsed > ttl_seconds


def read_active_year() -> int | None:
    """Read active year from config.ini[settings]."""
    config = read_ini_section(get_config_path(), CONFIG_SECTION)
    value = config.get('active_year')
    if value is None or value == '':
        return None
    try:
        return int(value)
    except ValueError:
        return None


def write_active_year(year: int) -> None:
    """Persist active year in config.ini[settings]."""
    config = read_ini_section(get_config_path(), CONFIG_SECTION)
    config['active_year'] = str(int(year))
    write_ini_section(get_config_path(), CONFIG_SECTION, config)


def create_database_backup(source_db_path: str, reason: str) -> str:
    """Create database backup file and return its absolute path."""
    os.makedirs(get_backup_dir(), exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    safe_reason = ''.join(ch if ch.isalnum() or ch in ('-', '_') else '-' for ch in reason).strip('-')
    if not safe_reason:
        safe_reason = 'backup'
    source_name = os.path.basename(source_db_path)
    if safe_reason == 'legacy-before-stage6':
        backup_name = f'{source_name}.legacy-before-stage6.{timestamp}.bak'
    else:
        backup_name = f'{source_name}.{safe_reason}.{timestamp}.bak'
    backup_path = os.path.join(get_backup_dir(), backup_name)
    shutil.copy2(source_db_path, backup_path)
    return backup_path


def create_tmp_copy_from_legacy(source_db_path: str, tmp_path: str) -> str:
    """Create temporary copy of legacy database for copy-on-write migration."""
    directory = os.path.dirname(tmp_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    shutil.copy2(source_db_path, tmp_path)
    return tmp_path


def publish_tmp_database(tmp_path: str, final_path: str) -> None:
    """Atomically publish prepared temporary database file."""
    os.replace(tmp_path, final_path)


def _ensure_stage5_backup(path: str, backup_path: str) -> None:
    if not os.path.isfile(path) or os.path.isfile(backup_path):
        return
    os.makedirs(os.path.dirname(backup_path), exist_ok=True)
    shutil.copy2(path, backup_path)


def _stage5_backup_paths() -> dict[str, str]:
    backup_dir = get_backup_dir()
    return {
        'config': os.path.join(backup_dir, STAGE5_CONFIG_BACKUP),
        'database': os.path.join(backup_dir, STAGE5_DB_BACKUP),
    }


def _read_json_file(path: str) -> dict[str, Any]:
    if not os.path.isfile(path):
        return {}
    with open(path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def _split_storage_blob(blob: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    config: dict[str, str] = {}
    database: dict[str, str] = {}

    for key, value in blob.items():
        if not str(key).startswith('app_') or not isinstance(value, str):
            continue
        if key == SETTINGS_KEY:
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    config = {str(k): str(v) for k, v in parsed.items()}
            except json.JSONDecodeError:
                config = {SETTINGS_KEY: value}
        else:
            database[str(key)] = value

    return config, database


def _migrate_config_json_to_ini() -> None:
    ini_path = get_config_path()
    json_path = get_legacy_config_json_path()
    if os.path.isfile(ini_path) or not os.path.isfile(json_path):
        return

    raw = _read_json_file(json_path)
    config = {str(key): str(value) for key, value in raw.items()}
    if config:
        write_ini_section(ini_path, CONFIG_SECTION, config)


def _sql_stage5_ready() -> bool:
    sqlite_path = get_sqlite_path()
    if not os.path.isfile(sqlite_path):
        return True
    connection = sqlite3.connect(sqlite_path)
    connection.row_factory = sqlite3.Row
    try:
        version_row = connection.execute('PRAGMA user_version').fetchone()
        user_version = int(version_row[0]) if version_row else 0
        ticket_columns = {
            row['name']
            for row in connection.execute('PRAGMA table_info(weighing_tickets)').fetchall()
        }
        return user_version >= SCHEMA_VERSION_STAGE_5 and 'manual_weight_reason' in ticket_columns
    finally:
        connection.close()


def _config_stage5_ready() -> bool:
    config = read_ini_section(get_config_path(), CONFIG_SECTION)
    return config.get('manual_weight_reason_policy') in ('optional', 'required')


def _run_sql_stage5_migration() -> None:
    with sqlite3.connect(get_sqlite_path()) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute('BEGIN IMMEDIATE')
        migrate_schema_stage_5(connection)
        connection.commit()


def _run_config_stage5_migration() -> None:
    config = read_ini_section(get_config_path(), CONFIG_SECTION)
    policy = config.get('manual_weight_reason_policy')
    if policy not in ('optional', 'required'):
        config['manual_weight_reason_policy'] = DEFAULT_MANUAL_WEIGHT_REASON_POLICY
        write_ini_section(get_config_path(), CONFIG_SECTION, config)


def _run_stage5_migration_with_backups() -> None:
    if _sql_stage5_ready() and _config_stage5_ready():
        return

    backups = _stage5_backup_paths()
    _ensure_stage5_backup(get_config_path(), backups['config'])
    _ensure_stage5_backup(get_sqlite_path(), backups['database'])

    try:
        _run_sql_stage5_migration()
    except Exception as error:  # pragma: no cover - defensive runtime path
        raise RuntimeError(
            'SQL migration stage 5 failed. Restore pair config.ini + BD/weighing.db from backup.'
        ) from error

    try:
        _run_config_stage5_migration()
    except Exception as error:  # pragma: no cover - defensive runtime path
        raise RuntimeError(
            'Config migration stage 5 failed after SQL migration. Restore pair config.ini + BD/weighing.db from backup.'
        ) from error

    if not _sql_stage5_ready() or not _config_stage5_ready():
        raise RuntimeError(
            'Stage-5 post-check failed. Restore pair config.ini + BD/weighing.db from backup.'
        )


def migrate_legacy_storage() -> None:
    ensure_storage_dirs()
    _migrate_config_json_to_ini()

    config_exists = os.path.isfile(get_config_path())
    sqlite_exists = os.path.isfile(get_sqlite_path())

    legacy_path = get_legacy_storage_path()
    if not config_exists and not sqlite_exists and os.path.isfile(legacy_path):
        blob = _read_json_file(legacy_path)
        config, database = _split_storage_blob(blob)
        if config:
            write_config(config)
        if database:
            write_database(database)
        return

    json_path = get_json_database_path()
    if not config_exists and not sqlite_exists and os.path.isfile(json_path):
        database = {
            str(key): value
            for key, value in _read_json_file(json_path).items()
            if str(key).startswith('app_') and isinstance(value, str)
        }
        if database:
            write_database(database)

    if os.path.isfile(get_sqlite_path()):
        _run_stage5_migration_with_backups()
    else:
        _run_config_stage5_migration()


def read_config() -> dict[str, str]:
    migrate_legacy_storage()
    config = read_ini_section(get_config_path(), CONFIG_SECTION)
    if 'manual_weight_reason_policy' not in config:
        config['manual_weight_reason_policy'] = DEFAULT_MANUAL_WEIGHT_REASON_POLICY
    return config


def write_config(config: dict[str, Any]) -> None:
    ensure_storage_dirs()
    safe_config = {str(key): str(value) for key, value in config.items()}
    policy = safe_config.get('manual_weight_reason_policy')
    if policy not in ('optional', 'required'):
        safe_config['manual_weight_reason_policy'] = DEFAULT_MANUAL_WEIGHT_REASON_POLICY
    write_ini_section(get_config_path(), CONFIG_SECTION, safe_config)


def read_database(db_path: str | None = None) -> dict[str, str]:
    if db_path is None:
        migrate_legacy_storage()
    return read_sqlite_database(db_path=db_path)


def write_database(data: dict[str, Any], db_path: str | None = None) -> None:
    safe_data = {
        str(key): value
        for key, value in data.items()
        if str(key).startswith('app_') and str(key) != SETTINGS_KEY and isinstance(value, str)
    }
    write_sqlite_database(safe_data, db_path=db_path)
    changed_runtime_keys = {key for key in safe_data if key in _RUNTIME_CRITICAL_KEYS}
    if changed_runtime_keys and _runtime_invalidator is not None:
        _runtime_invalidator(changed_runtime_keys)


def register_runtime_invalidator(invalidator: Callable[[set[str]], None]) -> None:
    """Register callback fired after runtime-critical database writes."""
    global _runtime_invalidator
    _runtime_invalidator = invalidator


def read_combined_storage() -> dict[str, str]:
    combined: dict[str, str] = {}
    config = read_config()
    if config:
        combined[SETTINGS_KEY] = json.dumps(config, ensure_ascii=False)
    combined.update(read_database())
    return combined


def write_combined_storage(data: dict[str, Any]) -> None:
    config, database = _split_storage_blob(data)
    if config:
        write_config(config)
    write_database(database)


def build_backup() -> dict[str, Any]:
    return {
        'version': BACKUP_VERSION,
        'config': read_config(),
        'database': read_database(),
    }


def backup_to_ini(backup: dict[str, Any] | None = None) -> str:
    payload = backup or build_backup()
    config = payload.get('config') if isinstance(payload.get('config'), dict) else {}
    database = payload.get('database') if isinstance(payload.get('database'), dict) else {}
    exported_at = payload.get('exported_at') or datetime.now().strftime('%Y-%m-%dT%H:%M:%S')

    sections: dict[str, dict[str, Any]] = {
        BACKUP_SECTION: {
            'version': str(payload.get('version', BACKUP_VERSION)),
            'exported_at': exported_at,
        },
        CONFIG_SECTION: {str(k): str(v) for k, v in config.items()},
        DATABASE_SECTION: {str(k): str(v) for k, v in database.items()},
    }
    return dump_ini(sections)


def import_backup(payload: dict[str, Any]) -> dict[str, str]:
    config_raw = payload.get('config')
    database_raw = payload.get('database')

    if not isinstance(config_raw, dict) or not isinstance(database_raw, dict):
        legacy_data = payload.get('data')
        if isinstance(legacy_data, dict):
            write_combined_storage(legacy_data)
            return read_combined_storage()
        raise ValueError('Некорректный формат резервной копии')

    write_config({str(k): str(v) for k, v in config_raw.items()})
    write_database({
        str(k): v
        for k, v in database_raw.items()
        if str(k).startswith('app_') and isinstance(v, str)
    })
    return read_combined_storage()


def import_backup_ini(text: str) -> dict[str, str]:
    sections = parse_ini(text)
    backup_meta = sections.get(BACKUP_SECTION, {})
    config = sections.get(CONFIG_SECTION, {})
    database = sections.get(DATABASE_SECTION, {})

    if not config and not database:
        raise ValueError('Файл INI не содержит секций config или database')

    if config:
        write_config(config)
    if database:
        write_database({
            str(key): value
            for key, value in database.items()
            if str(key).startswith('app_')
        })

    return read_combined_storage()


def import_backup_file(text: str, filename: str = '') -> dict[str, str]:
    lowered = filename.lower()
    stripped = text.lstrip('\ufeff').strip()

    if lowered.endswith('.ini') or stripped.startswith('['):
        return import_backup_ini(stripped)

    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ValueError('Файл не является корректным INI или JSON') from exc

    if isinstance(parsed, dict) and 'backup' in parsed and isinstance(parsed['backup'], dict):
        parsed = parsed['backup']
    if not isinstance(parsed, dict):
        raise ValueError('Некорректный формат резервной копии')

    return import_backup(parsed)


def get_storage_paths() -> dict[str, str]:
    return {
        'app_root': get_app_root(),
        'config_file': get_config_path(),
        'database_dir': get_bd_dir(),
        'database_file': get_sqlite_path(),
    }
