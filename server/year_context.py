"""Year-based database context selectors for stage 6."""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

from persistence import (
    get_year_database_path,
    read_active_year,
    read_rotation_lock,
    rotation_lock_is_stale,
)
from sqlite_store import get_bd_dir, get_sqlite_path


@dataclass(frozen=True)
class DbContext:
    """Resolved database path and access mode for active/archive operations."""

    year: int | None
    db_path: str
    read_only: bool
    exists: bool


@dataclass(frozen=True)
class RotationContext:
    """Canonical source/target years and DB paths for rotation requests."""

    source_year: int
    target_year: int
    source_db_path: str
    target_db_path: str
    request_matches_server_invariants: bool


class RotationContractError(RuntimeError):
    """API-level rotation error with contract code and HTTP status."""

    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class ArchiveContractError(RuntimeError):
    """API-level archive error with contract code and HTTP status."""

    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


ARCHIVE_YEAR_RE = re.compile(r"^\d{4}$")
YEARLY_DB_NAME_RE = re.compile(r"^weighing-(\d{4})\.db$")


def validate_archive_year(raw_year: str | int | None) -> int:
    """
    Validate mandatory archive year query/body parameter.

    Args:
        raw_year: Raw year from query string or JSON body.

    Returns:
        Parsed Gregorian year as int (YYYY).

    Raises:
        ArchiveContractError: when year is missing or not a four-digit YYYY value.
    """
    if raw_year is None:
        raise ArchiveContractError(
            "invalid_archive_year",
            "Параметр year обязателен и должен быть годом в формате ГГГГ",
            400,
        )
    text = str(raw_year).strip()
    if not ARCHIVE_YEAR_RE.fullmatch(text):
        raise ArchiveContractError(
            "invalid_archive_year",
            "Параметр year обязателен и должен быть годом в формате ГГГГ",
            400,
        )
    return int(text)


def _extract_gregorian_year(value: str | None) -> int | None:
    """Extract Gregorian year from ticket date text."""
    if not value:
        return None
    iso_candidate = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso_candidate).year
    except ValueError:
        pass
    match = re.search(r"(19|20)\d{2}", value)
    if match is None:
        return None
    return int(match.group(0))


def _read_ticket_years(db_path: str) -> list[int]:
    """Read all detected ticket years from legacy container."""
    if not os.path.isfile(db_path):
        return []
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(
                """
                SELECT created_at, gross_datetime, completed_at
                FROM weighing_tickets
                """
            ).fetchall()
        except sqlite3.Error:
            return []
    years: list[int] = []
    for row in rows:
        for key in ("created_at", "gross_datetime", "completed_at"):
            year = _extract_gregorian_year(row[key])
            if year is not None:
                years.append(year)
    return years


def resolve_db_context(mode: Literal["active", "archive"], year: int | None) -> DbContext:
    """
    Resolve database context for active or archive mode.

    Active mode always prefers `active_year` in config and uses the yearly
    database path. Legacy `BD/weighing.db` is used only when `active_year`
    was not configured yet (pre-bootstrap stage).
    """
    if mode == "active":
        active_year = read_active_year()
        if active_year is None:
            legacy_path = get_sqlite_path()
            return DbContext(
                year=None,
                db_path=legacy_path,
                read_only=False,
                exists=os.path.isfile(legacy_path),
            )
        yearly_path = get_year_database_path(active_year)
        return DbContext(
            year=active_year,
            db_path=yearly_path,
            read_only=False,
            exists=os.path.isfile(yearly_path),
        )

    if year is None:
        raise ArchiveContractError(
            "invalid_archive_year",
            "Параметр year обязателен и должен быть годом в формате ГГГГ",
            400,
        )
    archive_year = validate_archive_year(year)
    archive_path = get_year_database_path(archive_year)
    return DbContext(
        year=archive_year,
        db_path=archive_path,
        read_only=True,
        exists=os.path.isfile(archive_path),
    )


def resolve_active_context() -> DbContext:
    """Backward-compatible wrapper for active DB context."""
    return resolve_db_context("active", year=None)


def resolve_archive_context(year: int) -> DbContext:
    """Backward-compatible wrapper for archive DB context."""
    return resolve_db_context("archive", year=year)


def resolve_migration_year(now: datetime) -> int:
    """
    Resolve legacy migration year.

    Returns max ticket year from legacy `BD/weighing.db`. If there are no
    tickets or date columns are not populated, returns current Gregorian year.
    """
    years = _read_ticket_years(get_sqlite_path())
    if not years:
        return now.year
    return max(years)


def list_year_database_files() -> list[str]:
    """Return list of yearly database file names."""
    pattern = "weighing-*.db"
    bd_dir = Path(get_bd_dir())
    return sorted(path.name for path in bd_dir.glob(pattern))


def resolve_rotation_context(
    requested_source_year: int | None,
    requested_target_year: int | None,
    now: datetime,
) -> RotationContext:
    """
    Resolve canonical years and paths for year rotation.

    Canonical rules:
    - `source_year` is the configured `active_year`
    - `target_year` is the current Gregorian year
    """
    active_year = read_active_year()
    if active_year is None:
        raise RotationContractError(
            'rotation_failed',
            'Активный год не настроен; ротация недоступна',
            500,
        )

    source_year = int(active_year)
    target_year = int(now.year)
    request_matches = True

    if requested_source_year is not None and int(requested_source_year) != source_year:
        request_matches = False
    if requested_target_year is not None and int(requested_target_year) != target_year:
        request_matches = False
    if not request_matches:
        raise RotationContractError(
            'invalid_rotation_years',
            'Переданные source_year/target_year не совпадают с server-side инвариантами',
            422,
        )

    return RotationContext(
        source_year=source_year,
        target_year=target_year,
        source_db_path=get_year_database_path(source_year),
        target_db_path=get_year_database_path(target_year),
        request_matches_server_invariants=request_matches,
    )


def assert_active_db_write_allowed(
    operation: str,
    *,
    allow_rotation_commit: bool = False,
) -> None:
    """
    Block active DB writes while year rotation lock is present.

    Raises:
        RotationContractError: when writes are not allowed.
    """
    lock_payload = read_rotation_lock()
    if lock_payload is None:
        return

    now = datetime.now()
    lock_stale = rotation_lock_is_stale(lock_payload, now)
    if lock_stale:
        raise RotationContractError(
            'rotation_in_progress',
            (
                f'Операция "{operation}" заблокирована: обнаружен устаревший lock ротации, '
                'требуется recovery через commit ротации'
            ),
            409,
        )

    if allow_rotation_commit:
        return

    raise RotationContractError(
        'rotation_in_progress',
        f'Операция "{operation}" недоступна: ротация года уже выполняется',
        409,
    )
