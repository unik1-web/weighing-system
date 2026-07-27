import json
import os
import sys
from datetime import datetime
from typing import Any

from config_ini import (
    BACKUP_SECTION,
    CONFIG_SECTION,
    DATABASE_SECTION,
    dump_ini,
    parse_ini,
    read_ini_section,
    write_ini_section,
)
from sqlite_store import get_sqlite_path, read_database as read_sqlite_database, write_database as write_sqlite_database

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SETTINGS_KEY = 'app_settings'
BACKUP_VERSION = 3
LEGACY_CONFIG_JSON = 'config.json'
CONFIG_INI = 'config.ini'


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


def get_legacy_storage_path() -> str:
    return os.path.join(BASE_DIR, 'data', 'app_storage.json')


def ensure_storage_dirs() -> None:
    os.makedirs(get_bd_dir(), exist_ok=True)


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


def migrate_legacy_storage() -> None:
    ensure_storage_dirs()
    _migrate_config_json_to_ini()

    config_exists = os.path.isfile(get_config_path())
    sqlite_exists = os.path.isfile(get_sqlite_path())
    if config_exists or sqlite_exists:
        return

    legacy_path = get_legacy_storage_path()
    if os.path.isfile(legacy_path):
        blob = _read_json_file(legacy_path)
        config, database = _split_storage_blob(blob)
        if config:
            write_config(config)
        if database:
            write_database(database)
        return

    json_path = get_json_database_path()
    if os.path.isfile(json_path):
        database = {
            str(key): value
            for key, value in _read_json_file(json_path).items()
            if str(key).startswith('app_') and isinstance(value, str)
        }
        if database:
            write_database(database)


def read_config() -> dict[str, str]:
    migrate_legacy_storage()
    return read_ini_section(get_config_path(), CONFIG_SECTION)


def write_config(config: dict[str, Any]) -> None:
    ensure_storage_dirs()
    safe_config = {str(key): str(value) for key, value in config.items()}
    write_ini_section(get_config_path(), CONFIG_SECTION, safe_config)


def read_database() -> dict[str, str]:
    migrate_legacy_storage()
    return read_sqlite_database()


def write_database(data: dict[str, Any]) -> None:
    safe_data = {
        str(key): value
        for key, value in data.items()
        if str(key).startswith('app_') and str(key) != SETTINGS_KEY and isinstance(value, str)
    }
    write_sqlite_database(safe_data)


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
