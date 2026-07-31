"""Archive read service for yearly SQLite databases."""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime
from typing import Any

from persistence import read_active_year
from sqlite_store import get_bd_dir, read_archive_ticket, read_archive_tickets
from year_context import (
    ARCHIVE_YEAR_RE,
    YEARLY_DB_NAME_RE,
    ArchiveContractError,
    resolve_db_context,
)
from stage6_logging import log_stage6_event
from year_rotation import detect_mixed_legacy_warning

TICKET_DATE_FIELDS = ("created_at", "gross_datetime", "completed_at")


def _extract_ticket_calendar_year(ticket: dict[str, Any]) -> int | None:
    """Extract calendar year from ticket date fields."""
    for field in TICKET_DATE_FIELDS:
        value = ticket.get(field)
        if not isinstance(value, str) or not value.strip():
            continue
        iso_candidate = value.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(iso_candidate).year
        except ValueError:
            match = re.search(r"(19|20)\d{2}", value)
            if match is not None:
                return int(match.group(0))
    return None


def build_mixed_legacy_warning(year: int, ticket: dict[str, Any]) -> dict[str, Any] | None:
    """
    Build mixed-legacy warning for one archive ticket.

    Compares the calendar year of the ticket date with the archive file year.
    Does not change the selected archive year.
    """
    ticket_year = _extract_ticket_calendar_year(ticket)
    if ticket_year is None or int(ticket_year) == int(year):
        return None
    return {
        "code": "mixed_legacy_year_mismatch",
        "archive_year": int(year),
        "ticket_year": int(ticket_year),
        "message": (
            "Календарный год даты тикета не совпадает с годом имени файла архива; "
            "выбранный архивный год не изменён."
        ),
    }


def list_archive_years(active_year: int | None = None) -> list[dict[str, Any]]:
    """
    List published archive years by filename scan of `BD/`.

    Returns only `weighing-ГГГГ.db` entries, excluding:
    - active year
    - `.tmp` files
    - invalid names

    Does not open yearly databases to build the catalog.
    """
    resolved_active_year = active_year if active_year is not None else read_active_year()
    bd_dir = get_bd_dir()
    if not os.path.isdir(bd_dir):
        return []

    years: list[dict[str, Any]] = []
    for name in os.listdir(bd_dir):
        if name.endswith(".tmp"):
            continue
        match = YEARLY_DB_NAME_RE.fullmatch(name)
        if match is None:
            continue
        year = int(match.group(1))
        if not ARCHIVE_YEAR_RE.fullmatch(str(year)):
            continue
        if resolved_active_year is not None and year >= int(resolved_active_year):
            continue
        years.append(
            {
                "year": year,
                "file_name": name,
                "label": f"Архив {year}",
            }
        )

    years.sort(key=lambda item: int(item["year"]), reverse=True)
    return years


def _resolve_readable_archive_context(year: int):
    """Resolve archive DB context and validate that the yearly file exists."""
    context = resolve_db_context("archive", year=year)
    if not context.exists:
        log_stage6_event(
            "archive_open",
            "error",
            source_year=int(year),
            reason="archive_year_not_found",
        )
        raise ArchiveContractError(
            "archive_year_not_found",
            "Архивный файл за указанный год не найден",
            404,
        )
    active_year = read_active_year()
    if active_year is not None and int(year) >= int(active_year):
        log_stage6_event(
            "archive_open",
            "error",
            source_year=int(year),
            target_year=int(active_year),
            reason="archive_year_not_found",
        )
        raise ArchiveContractError(
            "archive_year_not_found",
            "Архивный файл за указанный год не найден",
            404,
        )
    return context


def get_archive_tickets(year: int, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Open one selected archive DB in read-only mode and return its journal.

    Returns:
        Payload with `year`, `tickets` and optional mixed-legacy `warning`.
    """
    context = _resolve_readable_archive_context(year)
    try:
        tickets = read_archive_tickets(context.db_path, filters or {})
        warning = detect_mixed_legacy_warning(context.db_path, year)
    except sqlite3.Error as exc:
        log_stage6_event(
            "archive_open",
            "error",
            source_year=int(year),
            db_path=context.db_path,
            reason="archive_open_failed",
            error=str(exc),
        )
        raise ArchiveContractError(
            "archive_open_failed",
            f"Не удалось открыть архивную БД: {exc}",
            500,
        ) from exc
    except OSError as exc:
        log_stage6_event(
            "archive_open",
            "error",
            source_year=int(year),
            db_path=context.db_path,
            reason="archive_open_failed",
            error=str(exc),
        )
        raise ArchiveContractError(
            "archive_open_failed",
            f"Не удалось открыть архивную БД: {exc}",
            500,
        ) from exc

    log_stage6_event(
        "archive_open",
        "success",
        source_year=int(year),
        db_path=context.db_path,
        ticket_count=len(tickets),
    )
    payload: dict[str, Any] = {
        "success": True,
        "year": year,
        "tickets": tickets,
    }
    if warning is not None:
        payload["warning"] = warning
        log_stage6_event(
            "archive_mixed_legacy",
            "warning",
            source_year=int(year),
            db_path=context.db_path,
            reason=warning.get("code"),
        )
    return payload


def list_archive_tickets(year: int, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    """Backward-compatible alias for `get_archive_tickets`."""
    return get_archive_tickets(year, filters)


def get_archive_ticket(year: int, ticket_id: str) -> dict[str, Any]:
    """
    Read one archive ticket card from the selected yearly DB.

    Returns:
        Payload with `year`, `ticket` and optional ticket-level mixed-legacy warning.
    """
    context = _resolve_readable_archive_context(year)
    try:
        ticket = read_archive_ticket(context.db_path, ticket_id)
    except sqlite3.Error as exc:
        log_stage6_event(
            "archive_open",
            "error",
            source_year=int(year),
            db_path=context.db_path,
            reason="archive_open_failed",
            error=str(exc),
            ticket_id=ticket_id,
        )
        raise ArchiveContractError(
            "archive_open_failed",
            f"Не удалось открыть архивную БД: {exc}",
            500,
        ) from exc
    except OSError as exc:
        log_stage6_event(
            "archive_open",
            "error",
            source_year=int(year),
            db_path=context.db_path,
            reason="archive_open_failed",
            error=str(exc),
            ticket_id=ticket_id,
        )
        raise ArchiveContractError(
            "archive_open_failed",
            f"Не удалось открыть архивную БД: {exc}",
            500,
        ) from exc

    if ticket is None:
        raise ArchiveContractError(
            "archive_ticket_not_found",
            "Архивный тикет не найден в выбранном году",
            404,
        )

    log_stage6_event(
        "archive_open",
        "success",
        source_year=int(year),
        db_path=context.db_path,
        ticket_id=ticket_id,
    )
    payload: dict[str, Any] = {
        "success": True,
        "year": year,
        "ticket": ticket,
    }
    warning = build_mixed_legacy_warning(year, ticket)
    if warning is not None:
        payload["warning"] = warning
        log_stage6_event(
            "archive_mixed_legacy",
            "warning",
            source_year=int(year),
            db_path=context.db_path,
            reason=warning.get("code"),
            ticket_id=ticket_id,
        )
    return payload
