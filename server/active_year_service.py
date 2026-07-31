"""Helpers for read/write operations scoped to active year database."""

from __future__ import annotations

import sqlite3
from typing import Any

from persistence import read_database as read_persistence_database
from persistence import write_database as write_persistence_database
import sqlite_store
from year_context import assert_active_db_write_allowed, resolve_db_context


def read_active_storage() -> dict[str, str]:
    """
    Read storage snapshot from active-year SQLite database.

    Returns:
        Storage payload with `app_*` keys.
    """
    context = resolve_db_context(mode="active", year=None)
    return read_persistence_database(db_path=context.db_path)


def write_active_storage(data: dict[str, Any], operation: str) -> None:
    """
    Write storage payload into active-year SQLite database.

    Args:
        data: Storage payload with `app_*` keys.
        operation: API operation name for write-gate diagnostics.
    """
    assert_active_db_write_allowed(operation=operation)
    context = resolve_db_context(mode="active", year=None)
    write_persistence_database(data, db_path=context.db_path)


def get_active_ticket_numbering_state() -> dict[str, Any]:
    """
    Return current ticket numbering diagnostics for active year.

    Returns:
        Dictionary with active year and current max ticket number.
    """
    context = resolve_db_context(mode="active", year=None)
    max_ticket_number = 0
    with sqlite_store.connect(db_path=context.db_path) as connection:
        sqlite_store.init_schema(connection)
        row = connection.execute(
            "SELECT MAX(ticket_number) AS max_ticket_number FROM weighing_tickets"
        ).fetchone()
        if row and row["max_ticket_number"] is not None:
            max_ticket_number = int(row["max_ticket_number"])
    return {
        "active_year": context.year,
        "max_ticket_number": max_ticket_number,
    }
