"""Yearly SQLite database paths, listing, backups dir, and legacy migration."""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
from datetime import datetime
from typing import Any

from config_ini import CONFIG_SECTION, read_ini_section, write_ini_section

YEAR_DB_RE = re.compile(r'^weighing-(\d{4})\.db$', re.IGNORECASE)
YEAR_VALUE_RE = re.compile(r'^\d{4}$')
LEGACY_DB_FILENAME = 'weighing.db'


def get_app_root() -> str:
    import sqlite_store

    return sqlite_store.get_app_root()


def get_bd_dir() -> str:
    import sqlite_store

    return sqlite_store.get_bd_dir()


def get_config_path() -> str:
    return os.path.join(get_app_root(), 'config.ini')


def get_backups_dir() -> str:
    return os.path.join(get_bd_dir(), 'backups')


def ensure_backups_dir() -> str:
    path = get_backups_dir()
    os.makedirs(path, exist_ok=True)
    return path


def year_db_filename(year: int | str) -> str:
    return f'weighing-{int(year)}.db'


def year_db_path(year: int | str) -> str:
    return os.path.join(get_bd_dir(), year_db_filename(year))


def legacy_db_path() -> str:
    return os.path.join(get_bd_dir(), LEGACY_DB_FILENAME)


def parse_year_from_filename(name: str) -> int | None:
    match = YEAR_DB_RE.match(os.path.basename(name))
    if not match:
        return None
    return int(match.group(1))


def parse_year_value(raw: Any) -> int | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not YEAR_VALUE_RE.match(text):
        return None
    return int(text)


def calendar_year() -> int:
    return datetime.now().year


def read_active_year() -> int | None:
    config = read_ini_section(get_config_path(), CONFIG_SECTION)
    return parse_year_value(config.get('active_year'))


def write_active_year(year: int) -> None:
    path = get_config_path()
    config = read_ini_section(path, CONFIG_SECTION)
    config['active_year'] = str(int(year))
    write_ini_section(path, CONFIG_SECTION, config)


def list_year_files() -> list[tuple[int, str]]:
    bd_dir = get_bd_dir()
    if not os.path.isdir(bd_dir):
        return []
    found: list[tuple[int, str]] = []
    for name in os.listdir(bd_dir):
        year = parse_year_from_filename(name)
        if year is None:
            continue
        path = os.path.join(bd_dir, name)
        if os.path.isfile(path):
            found.append((year, path))
    found.sort(key=lambda item: item[0])
    return found


def list_years() -> list[int]:
    return [year for year, _path in list_year_files()]


def _parse_year_from_timestamp(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if len(text) < 4:
        return None
    prefix = text[:4]
    if YEAR_VALUE_RE.match(prefix):
        return int(prefix)
    return None


def detect_year_from_db_file(path: str) -> int | None:
    if not os.path.isfile(path):
        return None
    connection = sqlite3.connect(path)
    try:
        row = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='weighing_tickets'"
        ).fetchone()
        if not row:
            return None
        tickets = connection.execute(
            'SELECT created_at, completed_at FROM weighing_tickets'
        ).fetchall()
        years: list[int] = []
        for created_at, completed_at in tickets:
            for stamp in (completed_at, created_at):
                year = _parse_year_from_timestamp(stamp)
                if year is not None:
                    years.append(year)
        return max(years) if years else None
    except sqlite3.Error:
        return None
    finally:
        connection.close()


def migrate_legacy_weighing_db() -> dict[str, Any] | None:
    """Copy BD/weighing.db → weighing-{YYYY}.db when yearly scheme is not active yet."""
    import sqlite_store

    sqlite_store.ensure_storage_dirs()
    legacy = legacy_db_path()
    if not os.path.isfile(legacy):
        return None

    active = read_active_year()
    years = list_years()
    if active is not None and os.path.isfile(year_db_path(active)):
        return None
    if years:
        # Yearly files already present — do not touch ambiguous legacy file.
        if active is None:
            write_active_year(years[-1])
        return None

    year = detect_year_from_db_file(legacy) or calendar_year()
    target = year_db_path(year)
    if not os.path.isfile(target):
        shutil.copy2(legacy, target)

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    migrated_name = f'{LEGACY_DB_FILENAME}.migrated-{stamp}'
    migrated_path = os.path.join(get_bd_dir(), migrated_name)
    os.replace(legacy, migrated_path)
    write_active_year(year)
    return {
        'year': year,
        'target': target,
        'migrated_legacy': migrated_path,
    }


def resolve_active_year() -> int:
    """Ensure active_year is set; run legacy migrate; return year."""
    import sqlite_store

    sqlite_store.ensure_storage_dirs()
    migrate_legacy_weighing_db()
    year = read_active_year()
    if year is None:
        years = list_years()
        year = years[-1] if years else calendar_year()
        write_active_year(year)
    return year


def resolve_active_sqlite_path() -> str:
    year = resolve_active_year()
    return year_db_path(year)


def make_rotation_backup(year: int) -> str:
    """Copy weighing-{year}.db into BD/backups/ with timestamp."""
    src = year_db_path(year)
    if not os.path.isfile(src):
        raise FileNotFoundError(f'Нет файла базы года {year}')
    backups = ensure_backups_dir()
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    dest = os.path.join(backups, f'weighing-{int(year)}-{stamp}.db')
    shutil.copy2(src, dest)
    return dest
