import json
import os
import sys
from typing import Any

from sqlite_store import get_sqlite_path, read_database as read_sqlite_database, write_database as write_sqlite_database

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SETTINGS_KEY = 'app_settings'
BACKUP_VERSION = 2


def get_app_root() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.abspath(os.path.join(BASE_DIR, '..'))


def get_config_path() -> str:
    return os.path.join(get_app_root(), 'config.json')


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


def _write_json_file(path: str, data: dict[str, Any]) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    temp_path = path + '.tmp'
    with open(temp_path, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)


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


def migrate_legacy_storage() -> None:
    ensure_storage_dirs()

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
    raw = _read_json_file(get_config_path())
    return {str(key): str(value) for key, value in raw.items()}


def write_config(config: dict[str, Any]) -> None:
    ensure_storage_dirs()
    safe_config = {str(key): str(value) for key, value in config.items()}
    _write_json_file(get_config_path(), safe_config)


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


def get_storage_paths() -> dict[str, str]:
    return {
        'app_root': get_app_root(),
        'config_file': get_config_path(),
        'database_dir': get_bd_dir(),
        'database_file': get_sqlite_path(),
    }
