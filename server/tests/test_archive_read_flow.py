"""Archive catalog, journal read and reprint isolation."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import persistence
import sqlite_store
from archive_service import (
    build_mixed_legacy_warning,
    get_archive_ticket,
    get_archive_tickets,
    list_archive_years,
)
from year_context import ArchiveContractError, validate_archive_year


def _seed_session(api_client, *, role: str = "user") -> None:
    """Persist active operator session used by archive auth checks."""
    session_payload = json.dumps(
        {
            "user": {"id": "u-archive", "username": "operator"},
            "profile": {
                "username": "operator",
                "display_name": "Оператор",
                "role": role,
            },
        },
        ensure_ascii=False,
    )
    response = api_client.post("/api/database", json={"data": {"app_current_user": session_payload}})
    assert response.status_code == 200


def _create_year_db(path: Path, tickets: list[dict]) -> None:
    """Create yearly SQLite DB with optional weighing tickets."""
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for ticket in tickets:
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, vehicle_number, driver_name, cargo_name,
                    status, reo_status, auto_closed, created_at, gross_datetime, completed_at,
                    gross_weight, tare_weight, net_weight
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticket["id"],
                    ticket.get("ticket_number", 1),
                    ticket.get("vehicle_number", "A111AA56"),
                    ticket.get("driver_name", "Иванов"),
                    ticket.get("cargo_name", "Грунт"),
                    ticket.get("status", "completed"),
                    ticket.get("reo_status", "pending"),
                    1 if ticket.get("auto_closed") else 0,
                    ticket.get("created_at", "2025-06-01T10:00:00"),
                    ticket.get("gross_datetime", ticket.get("created_at", "2025-06-01T10:00:00")),
                    ticket.get("completed_at", ticket.get("created_at", "2025-06-01T10:00:00")),
                    ticket.get("gross_weight", 20000),
                    ticket.get("tare_weight", 5000),
                    ticket.get("net_weight", 15000),
                ),
            )
        connection.commit()


def test_list_archive_years_filters_by_filename(temp_stage6_root):
    """TC-UNIT-01: list_archive_years keeps only published archive years."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])

    for year in range(2006, 2026):
        _create_year_db(bd / f"weighing-{year}.db", [])
    _create_year_db(bd / "weighing-2026.db", [])
    (bd / "weighing-2024.db.tmp").write_bytes(b"tmp")
    (bd / "weighing-bad.db").write_bytes(b"x")
    (bd / "notes.txt").write_text("ignore", encoding="utf-8")

    years = list_archive_years(2026)
    year_values = [item["year"] for item in years]

    assert 2026 not in year_values
    assert year_values == list(range(2025, 2005, -1))
    assert all(item["file_name"] == f"weighing-{item['year']}.db" for item in years)
    assert all(item["label"].startswith("Архив ") for item in years)


def test_validate_archive_year_accepts_only_yyyy():
    """TC-UNIT-02: validate_archive_year accepts only four-digit years."""
    assert validate_archive_year(2025) == 2025
    assert validate_archive_year("2025") == 2025

    for raw in (None, "abc", "25", 25, ""):
        try:
            validate_archive_year(raw)
            assert False, f"expected invalid_archive_year for {raw!r}"
        except ArchiveContractError as exc:
            assert exc.code == "invalid_archive_year"
            assert exc.status == 400


def test_build_mixed_legacy_warning_for_mismatched_ticket_date():
    """TC-UNIT-03: build_mixed_legacy_warning detects ticket/file year mismatch."""
    warning = build_mixed_legacy_warning(
        2026,
        {"created_at": "2025-12-31T23:59:00", "id": "t-1"},
    )
    assert warning is not None
    assert warning["code"] == "mixed_legacy_year_mismatch"
    assert warning["archive_year"] == 2026
    assert warning["ticket_year"] == 2025

    assert build_mixed_legacy_warning(2026, {"created_at": "2026-01-01T00:00:00"}) is None


def test_archive_years_endpoint_lists_by_filename_without_opening_all(api_client, temp_stage6_root):
    """TC-E2E-01: GET /api/archive/years returns archives by filename scan."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    for year in range(2006, 2026):
        _create_year_db(bd / f"weighing-{year}.db", [])
    _create_year_db(bd / "weighing-2026.db", [{"id": "active-1", "created_at": "2026-01-02T00:00:00"}])
    _seed_session(api_client)

    response = api_client.get("/api/archive/years")
    assert response.status_code == 200
    payload = response.get_json()
    years = [item["year"] for item in payload["years"]]
    assert 2026 not in years
    assert years == list(range(2025, 2005, -1))


def test_open_selected_archive_does_not_change_active_year(api_client, temp_stage6_root):
    """TC-E2E-02: opening archive year reads only selected DB and keeps active_year."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    active_path = bd / "weighing-2026.db"
    archive_path = bd / "weighing-2025.db"
    _create_year_db(
        active_path,
        [{"id": "active-1", "ticket_number": 9, "created_at": "2026-02-01T10:00:00"}],
    )
    _create_year_db(
        archive_path,
        [
            {
                "id": "archive-1",
                "ticket_number": 42,
                "vehicle_number": "B222BB56",
                "created_at": "2025-03-01T10:00:00",
                "status": "completed",
                "reo_status": "sent",
                "auto_closed": True,
            }
        ],
    )
    persistence.write_active_year(2026)
    _seed_session(api_client)

    tickets_response = api_client.get("/api/archive/tickets?year=2025")
    assert tickets_response.status_code == 200
    tickets_payload = tickets_response.get_json()
    assert tickets_payload["year"] == 2025
    assert len(tickets_payload["tickets"]) == 1
    assert tickets_payload["tickets"][0]["id"] == "archive-1"

    card_response = api_client.get("/api/archive/tickets/archive-1?year=2025")
    assert card_response.status_code == 200
    card_payload = card_response.get_json()
    assert card_payload["ticket"]["ticket_number"] == 42
    assert card_payload["ticket"]["auto_closed"] is True
    assert card_payload["ticket"]["reo_status"] == "sent"

    assert persistence.read_active_year() == 2026
    with sqlite3.connect(active_path) as connection:
        active_ids = [
            row[0]
            for row in connection.execute("SELECT id FROM weighing_tickets ORDER BY id").fetchall()
        ]
    assert active_ids == ["active-1"]
    assert "archive-1" not in active_ids


def test_mixed_legacy_warning_keeps_selected_archive_year(api_client, temp_stage6_root):
    """TC-E2E-03: mixed legacy warning keeps selected archive year = filename year."""
    paths = temp_stage6_root(config_overrides={"active_year": 2027})
    bd = Path(paths["bd_dir"])
    _create_year_db(bd / "weighing-2027.db", [])
    _create_year_db(
        bd / "weighing-2026.db",
        [
            {
                "id": "mixed-1",
                "ticket_number": 7,
                "created_at": "2025-12-31T12:00:00",
                "gross_datetime": "2025-12-31T12:00:00",
                "completed_at": "2025-12-31T12:30:00",
            }
        ],
    )
    _seed_session(api_client)

    tickets_response = api_client.get("/api/archive/tickets?year=2026")
    assert tickets_response.status_code == 200
    tickets_payload = tickets_response.get_json()
    assert tickets_payload["year"] == 2026
    assert tickets_payload["warning"]["code"] == "mixed_legacy_year_mismatch"

    card_response = api_client.get("/api/archive/tickets/mixed-1?year=2026")
    assert card_response.status_code == 200
    card_payload = card_response.get_json()
    assert card_payload["year"] == 2026
    assert card_payload["warning"]["code"] == "mixed_legacy_year_mismatch"
    assert card_payload["warning"]["ticket_year"] == 2025


def test_archive_reprint_does_not_copy_into_active_year(api_client, temp_stage6_root):
    """TC-E2E-04: archive ticket read/print path does not create active-year rows."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    active_path = bd / "weighing-2026.db"
    _create_year_db(active_path, [])
    _create_year_db(
        bd / "weighing-2025.db",
        [
            {
                "id": "print-1",
                "ticket_number": 15,
                "status": "completed",
                "created_at": "2025-04-01T09:00:00",
            }
        ],
    )
    persistence.write_active_year(2026)
    _seed_session(api_client)

    card_response = api_client.get("/api/archive/tickets/print-1?year=2025")
    assert card_response.status_code == 200
    assert card_response.get_json()["ticket"]["status"] == "completed"

    with sqlite3.connect(active_path) as connection:
        count = connection.execute("SELECT COUNT(*) FROM weighing_tickets").fetchone()[0]
    assert count == 0
    assert persistence.read_active_year() == 2026


def test_corrupted_archive_returns_open_failed_and_keeps_active(api_client, temp_stage6_root):
    """TC-E2E-05: damaged archive returns archive_open_failed without touching active DB."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    active_path = bd / "weighing-2026.db"
    _create_year_db(active_path, [{"id": "active-ok", "created_at": "2026-01-01T00:00:00"}])
    (bd / "weighing-2024.db").write_bytes(b"not-a-sqlite-database")
    _create_year_db(
        bd / "weighing-2025.db",
        [{"id": "ok-2025", "created_at": "2025-01-01T00:00:00"}],
    )
    persistence.write_active_year(2026)
    _seed_session(api_client)
    with sqlite3.connect(active_path) as connection:
        before_count = connection.execute("SELECT COUNT(*) FROM weighing_tickets").fetchone()[0]
        before_ids = [
            row[0]
            for row in connection.execute("SELECT id FROM weighing_tickets ORDER BY id").fetchall()
        ]

    broken = api_client.get("/api/archive/tickets?year=2024")
    assert broken.status_code == 500
    assert broken.get_json()["code"] == "archive_open_failed"
    assert persistence.read_active_year() == 2026
    with sqlite3.connect(active_path) as connection:
        after_count = connection.execute("SELECT COUNT(*) FROM weighing_tickets").fetchone()[0]
        after_ids = [
            row[0]
            for row in connection.execute("SELECT id FROM weighing_tickets ORDER BY id").fetchall()
        ]
    assert after_count == before_count
    assert after_ids == before_ids

    other = api_client.get("/api/archive/tickets?year=2025")
    assert other.status_code == 200
    assert other.get_json()["year"] == 2025
    assert len(other.get_json()["tickets"]) == 1


def test_get_archive_tickets_service_opens_selected_year_only(temp_stage6_root):
    """Service-level check that selected archive year is returned with tickets."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    _create_year_db(bd / "weighing-2026.db", [])
    _create_year_db(
        bd / "weighing-2025.db",
        [{"id": "a1", "ticket_number": 3, "created_at": "2025-05-05T00:00:00"}],
    )

    payload = get_archive_tickets(2025, filters={})
    assert payload["year"] == 2025
    assert payload["tickets"][0]["id"] == "a1"
    card = get_archive_ticket(2025, "a1")
    assert card["ticket"]["ticket_number"] == 3
