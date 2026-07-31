"""Backend integration coverage for archive read contracts (UC-04)."""

from __future__ import annotations

import json
from pathlib import Path

import persistence
from stage6_fixtures import build_stage6_archive_db, corrupt_tmp_database


def _seed_session(api_client, *, role: str = "user") -> None:
    """Persist operator session for archive auth checks."""
    session_payload = json.dumps(
        {
            "user": {"id": "u-arch", "username": "operator"},
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


def _prepare_active_and_archive(temp_stage6_root, *, active_year: int = 2026):
    """Create active year DB plus one archive year with a completed ticket."""
    paths = temp_stage6_root(config_overrides={"active_year": active_year})
    bd = Path(paths["bd_dir"])
    build_stage6_archive_db(bd / f"weighing-{active_year}.db", tickets=[])
    archive_year = active_year - 1
    build_stage6_archive_db(
        bd / f"weighing-{archive_year}.db",
        tickets=[
            {
                "id": "archive-1",
                "ticket_number": 42,
                "created_at": f"{archive_year}-03-01T10:00:00",
                "status": "completed",
                "reo_status": "sent",
                "auto_closed": True,
            }
        ],
    )
    persistence.write_active_year(active_year)
    return paths, archive_year


def test_archive_error_matrix(api_client, temp_stage6_root):
    """TC-UNIT-01: archive error matrix for year validation and open failures."""
    paths, archive_year = _prepare_active_and_archive(temp_stage6_root)
    bd = Path(paths["bd_dir"])
    corrupt_tmp_database(bd / "weighing-2024.db")
    _seed_session(api_client)

    missing_year = api_client.get("/api/archive/tickets")
    assert missing_year.status_code == 400
    assert missing_year.get_json()["code"] == "invalid_archive_year"

    non_numeric = api_client.get("/api/archive/tickets?year=abcd")
    assert non_numeric.status_code == 400
    assert non_numeric.get_json()["code"] == "invalid_archive_year"

    too_short = api_client.get("/api/archive/tickets?year=25")
    assert too_short.status_code == 400
    assert too_short.get_json()["code"] == "invalid_archive_year"

    missing_file = api_client.get("/api/archive/tickets?year=2010")
    assert missing_file.status_code == 404
    assert missing_file.get_json()["code"] == "archive_year_not_found"

    corrupted = api_client.get("/api/archive/tickets?year=2024")
    assert corrupted.status_code == 500
    assert corrupted.get_json()["code"] == "archive_open_failed"

    # Active year and other archives remain usable.
    assert persistence.read_active_year() == 2026
    ok = api_client.get(f"/api/archive/tickets?year={archive_year}")
    assert ok.status_code == 200
    assert ok.get_json()["year"] == archive_year
    assert len(ok.get_json()["tickets"]) == 1


def test_archive_read_keeps_active_year_and_mixed_legacy_warning(api_client, temp_stage6_root):
    """Archive journal/card stay on filename year; mixed legacy emits warning."""
    paths = temp_stage6_root(config_overrides={"active_year": 2027})
    bd = Path(paths["bd_dir"])
    build_stage6_archive_db(bd / "weighing-2027.db", tickets=[])
    build_stage6_archive_db(
        bd / "weighing-2026.db",
        tickets=[
            {
                "id": "mixed-1",
                "ticket_number": 7,
                "created_at": "2025-12-31T12:00:00",
                "gross_datetime": "2025-12-31T12:00:00",
                "completed_at": "2025-12-31T12:30:00",
            }
        ],
    )
    persistence.write_active_year(2027)
    _seed_session(api_client)

    tickets = api_client.get("/api/archive/tickets?year=2026")
    assert tickets.status_code == 200
    payload = tickets.get_json()
    assert payload["year"] == 2026
    assert payload["warning"]["code"] == "mixed_legacy_year_mismatch"

    card = api_client.get("/api/archive/tickets/mixed-1?year=2026")
    assert card.status_code == 200
    card_payload = card.get_json()
    assert card_payload["year"] == 2026
    assert card_payload["warning"]["ticket_year"] == 2025
    assert persistence.read_active_year() == 2027
