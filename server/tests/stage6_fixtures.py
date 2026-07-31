"""Shared stage-6 SQLite fixture builders for backend integration tests."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import pytest


def build_stage6_legacy_db(
    path: str | Path,
    *,
    ticket_dates: list[str] | None = None,
    tickets: list[dict[str, Any]] | None = None,
) -> Path:
    """
    Create a legacy `weighing.db` using production schema helpers.

    Args:
        path: Destination SQLite path.
        ticket_dates: Optional list of ISO datetimes for simple completed tickets.
        tickets: Optional full ticket dicts (overrides ticket_dates when provided).

    Returns:
        Path to the created database file.
    """
    import sqlite_store

    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    rows = tickets
    if rows is None:
        rows = []
        for index, created_at in enumerate(ticket_dates or [], start=1):
            rows.append(
                {
                    "id": f"t-{index}",
                    "ticket_number": index,
                    "created_at": created_at,
                    "gross_datetime": created_at,
                    "completed_at": created_at,
                    "status": "completed",
                    "reo_status": "pending",
                }
            )

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for ticket in rows:
            created_at = ticket.get("created_at", "2026-01-01T00:00:00")
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, created_at, gross_datetime, completed_at,
                    status, reo_status, vehicle_number, driver_name, cargo_name,
                    gross_weight, tare_weight, net_weight
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticket["id"],
                    ticket.get("ticket_number", 1),
                    created_at,
                    ticket.get("gross_datetime", created_at),
                    ticket.get("completed_at", created_at),
                    ticket.get("status", "completed"),
                    ticket.get("reo_status", "pending"),
                    ticket.get("vehicle_number", ""),
                    ticket.get("driver_name", ""),
                    ticket.get("cargo_name", ""),
                    ticket.get("gross_weight"),
                    ticket.get("tare_weight"),
                    ticket.get("net_weight"),
                ),
            )
            connection.execute(
                """
                INSERT INTO ticket_audit (id, ticket_id, action, at, operator_name, event_type, source_year)
                VALUES (?, ?, ?, ?, ?, '', NULL)
                """,
                (f"a-{ticket['id']}", ticket["id"], "created", created_at, "system"),
            )
        connection.commit()
    return db_path


def build_stage6_active_year_db(
    path: str | Path,
    *,
    open_tickets: list[dict[str, Any]] | None = None,
    completed_tickets: list[dict[str, Any]] | None = None,
    include_dictionary_vehicle: bool = True,
    include_session: bool = True,
    extra_app_tables: dict[str, list[tuple[str, ...]]] | None = None,
) -> Path:
    """
    Create an active-year DB with open/pending candidates for rotation fixtures.

    Default fixture mirrors rotation-source: two open tickets (dictionary tare +
    default tare), one pending REO, whitelist users/profiles/vehicles, and session.
    """
    import sqlite_store

    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if open_tickets is None:
        open_tickets = [
            {
                "id": "t-dictionary",
                "ticket_number": 101,
                "vehicle_number": "А001АА",
                "gross_weight": 5000,
                "price": 2,
                "vat_rate": 20,
                "status": "open",
                "reo_status": "sent",
                "operator_id": "u-1",
                "operator_name": "Оператор",
                "created_at": "2025-12-31T21:00:00",
            },
            {
                "id": "t-default",
                "ticket_number": 102,
                "vehicle_number": "В002ВВ",
                "gross_weight": 4000,
                "price": 3,
                "vat_rate": 20,
                "status": "open",
                "reo_status": "pending",
                "operator_id": "u-1",
                "operator_name": "Оператор",
                "created_at": "2025-12-31T22:00:00",
            },
        ]

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            """
            INSERT INTO users (id, email, username, password_hash)
            VALUES ('u-1', 'op@example.com', 'operator', 'hash')
            """
        )
        connection.execute(
            """
            INSERT INTO profiles (user_id, username, display_name, role)
            VALUES ('u-1', 'operator', 'Оператор', 'user')
            """
        )
        if include_dictionary_vehicle:
            connection.execute(
                """
                INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
                VALUES (?, 'vehicles', ?, '', '2025-01-01T00:00:00', ?)
                """,
                (
                    "v-1",
                    "А001АА",
                    '{"vehicle_number":"А001АА","default_tare_weight":1200}',
                ),
            )
        for ticket in open_tickets + (completed_tickets or []):
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, vehicle_number, gross_weight, tare_weight, net_weight,
                    price, vat_rate, status, reo_status, operator_id, operator_name,
                    created_at, completed_at, auto_closed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticket["id"],
                    ticket.get("ticket_number", 1),
                    ticket.get("vehicle_number"),
                    ticket.get("gross_weight"),
                    ticket.get("tare_weight"),
                    ticket.get("net_weight"),
                    ticket.get("price", 0),
                    ticket.get("vat_rate", 0),
                    ticket.get("status", "open"),
                    ticket.get("reo_status", "pending"),
                    ticket.get("operator_id", "u-1"),
                    ticket.get("operator_name", "Оператор"),
                    ticket.get("created_at", "2025-12-31T12:00:00"),
                    ticket.get("completed_at"),
                    1 if ticket.get("auto_closed") else 0,
                ),
            )
        if include_session:
            connection.execute(
                """
                INSERT INTO app_sessions (id, payload)
                VALUES (1, '{"user":{"id":"u-1"}}')
                """
            )
        for table_name, rows in (extra_app_tables or {}).items():
            connection.execute(
                f"CREATE TABLE IF NOT EXISTS {table_name} (id TEXT PRIMARY KEY, payload TEXT)"
            )
            for row in rows:
                connection.execute(
                    f"INSERT INTO {table_name} (id, payload) VALUES (?, ?)",
                    row,
                )
        connection.commit()
    return db_path


def build_stage6_archive_db(
    path: str | Path,
    *,
    tickets: list[dict[str, Any]] | None = None,
) -> Path:
    """
    Create an archive-year DB with completed tickets for read/edit fixtures.

    Supports sent REO tickets, mixed-legacy dates and auto_closed markers.
    """
    import sqlite_store

    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for ticket in tickets or []:
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, vehicle_number, vehicle_brand, trailer_number,
                    driver_name, cargo_name, shipper_name, receiver_name, carrier_name,
                    status, reo_status, reo_sent_at, auto_closed, created_at, completed_at,
                    gross_datetime, tare_datetime,
                    gross_weight, tare_weight, net_weight, total_amount, price, vat_rate, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticket["id"],
                    ticket.get("ticket_number", 1),
                    ticket.get("vehicle_number", "A111AA56"),
                    ticket.get("vehicle_brand", "КАМАЗ"),
                    ticket.get("trailer_number", ""),
                    ticket.get("driver_name", "Иванов"),
                    ticket.get("cargo_name", "Грунт"),
                    ticket.get("shipper_name", "ООО Отправитель"),
                    ticket.get("receiver_name", "ООО Получатель"),
                    ticket.get("carrier_name", "ООО Перевозчик"),
                    ticket.get("status", "completed"),
                    ticket.get("reo_status", "pending"),
                    ticket.get("reo_sent_at"),
                    1 if ticket.get("auto_closed") else 0,
                    ticket.get("created_at", "2025-06-01T10:00:00"),
                    ticket.get("completed_at", ticket.get("created_at", "2025-06-01T11:00:00")),
                    ticket.get("gross_datetime", ticket.get("created_at", "2025-06-01T10:00:00")),
                    ticket.get("tare_datetime"),
                    ticket.get("gross_weight", 20000),
                    ticket.get("tare_weight", 5000),
                    ticket.get("net_weight", 15000),
                    ticket.get("total_amount", 1500),
                    ticket.get("price", 100),
                    ticket.get("vat_rate", 20),
                    ticket.get("notes", ""),
                ),
            )
        connection.commit()
    return db_path


def freeze_stage6_now(
    monkeypatch: pytest.MonkeyPatch,
    frozen: datetime,
) -> Callable[[], datetime]:
    """
    Freeze `datetime.now()` used by stage-6 rotation/migration/preview wrappers.

    Returns a callable that still returns the frozen value for assertions.
    """
    import year_rotation
    import year_context
    import persistence

    def _frozen_now(tz=None):
        if tz is not None:
            return frozen.replace(tzinfo=tz) if frozen.tzinfo is None else frozen.astimezone(tz)
        return frozen

    class _FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return _frozen_now(tz)

    monkeypatch.setattr(year_rotation, "datetime", _FrozenDateTime)
    monkeypatch.setattr(year_context, "datetime", _FrozenDateTime)
    monkeypatch.setattr(persistence, "datetime", _FrozenDateTime)
    return lambda: frozen


def corrupt_tmp_database(path: str | Path) -> Path:
    """Overwrite a SQLite file (or create one) with non-SQLite bytes."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"not-a-sqlite-database-corrupted-by-fixture")
    return target


def age_stage6_lock(
    lock_path: str | Path,
    *,
    minutes: int = 20,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Rewrite rotation lock started_at into the past so TTL marks it stale."""
    path = Path(lock_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    reference = now or datetime.now()
    started = reference - timedelta(minutes=minutes)
    payload["started_at"] = started.isoformat().replace("+00:00", "Z")
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload
