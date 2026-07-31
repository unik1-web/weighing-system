"""Archive edit whitelist, recalculation, REO warning and ticket_audit."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import persistence
import sqlite_store
from archive_edit_service import (
    apply_archive_edit,
    normalize_archive_patch,
    recalculate_archive_ticket,
    validate_archive_patch,
)
from ticket_audit_stage6 import build_archive_edit_audit_event
from year_context import ArchiveContractError


def _seed_session(api_client, *, role: str = "admin") -> None:
    """Persist session used by archive auth checks."""
    session_payload = json.dumps(
        {
            "user": {"id": "u-admin", "username": "admin"},
            "profile": {
                "username": "admin",
                "display_name": "Администратор",
                "role": role,
            },
        },
        ensure_ascii=False,
    )
    response = api_client.post("/api/database", json={"data": {"app_current_user": session_payload}})
    assert response.status_code == 200


def _create_archive_db(path: Path, tickets: list[dict]) -> None:
    """Create yearly archive SQLite with weighing tickets."""
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for ticket in tickets:
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, vehicle_number, vehicle_brand, trailer_number,
                    driver_name, cargo_name, shipper_name, receiver_name, carrier_name,
                    status, reo_status, reo_sent_at, auto_closed, created_at, completed_at,
                    gross_weight, tare_weight, net_weight, total_amount, price, vat_rate, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    ticket.get("completed_at", "2025-06-01T11:00:00"),
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


def _count_audit(db_path: Path, ticket_id: str, event_type: str = "archive_edit") -> int:
    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM ticket_audit
            WHERE ticket_id = ? AND event_type = ?
            """,
            (ticket_id, event_type),
        ).fetchone()
    return int(row[0])


def test_validate_archive_patch_allowlist_and_denylist():
    """TC-UNIT-01: validate_archive_patch accepts only allowlisted fields."""
    assert validate_archive_patch({"driver_name": "Петров"}) == {"driver_name": "Петров"}
    assert validate_archive_patch({"gross_weight": 1, "notes": "x"})["notes"] == "x"

    for forbidden in ("ticket_number", "reo_status", "net_weight", "total_amount", "id", "price"):
        try:
            validate_archive_patch({forbidden: "x"})
            raise AssertionError(f"expected forbidden for {forbidden}")
        except ArchiveContractError as exc:
            assert exc.code == "archive_edit_forbidden_field"
            assert exc.status == 422


def test_recalculate_archive_ticket_updates_net_and_total():
    """TC-UNIT-02: recalculate_archive_ticket recomputes derived fields."""
    ticket = {
        "id": "t-1",
        "gross_weight": 20000,
        "tare_weight": 5000,
        "net_weight": 15000,
        "total_amount": 1500,
        "price": 100,
        "vat_rate": 20,
        "driver_name": "Иванов",
    }
    updated = recalculate_archive_ticket(ticket, normalize_archive_patch({"gross_weight": 22000}))
    assert updated["gross_weight"] == 22000.0
    assert updated["tare_weight"] == 5000
    assert updated["net_weight"] == 17000.0
    assert updated["total_amount"] == 1700.0

    updated_tare = recalculate_archive_ticket(ticket, normalize_archive_patch({"tare_weight": 6000}))
    assert updated_tare["net_weight"] == 14000.0
    assert updated_tare["total_amount"] == 1400.0


def test_build_archive_edit_audit_event_only_changed_fields():
    """TC-UNIT-03: audit event contains only real diffs and REO flag."""
    before = {"id": "t-1", "driver_name": "Иванов", "gross_weight": 20000, "net_weight": 15000}
    after = {"id": "t-1", "driver_name": "Петров", "gross_weight": 21000, "net_weight": 16000}
    event = build_archive_edit_audit_event(
        ticket_before=before,
        ticket_after=after,
        source_year=2025,
        actor={"id": "u-1", "display_name": "Админ"},
        reo_divergence_warning=True,
    )
    assert event["event_type"] == "archive_edit"
    assert event["source_year"] == 2025
    assert event["actor_id"] == "u-1"
    assert event["actor_name"] == "Админ"
    assert event["reo_divergence_warning"] is True
    assert set(event["changed_fields"]) == {"driver_name", "gross_weight", "net_weight"}
    assert event["old_values"]["driver_name"] == "Иванов"
    assert event["new_values"]["driver_name"] == "Петров"
    assert "id" not in event["changed_fields"]


def test_admin_archive_edit_persists_ticket_and_audit(api_client, temp_stage6_root):
    """TC-E2E-01: admin edits allowlisted fields and creates archive_edit audit."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    _create_archive_db(
        archive_path,
        [{"id": "archive-1", "driver_name": "Иванов", "gross_weight": 20000, "tare_weight": 5000}],
    )
    _create_archive_db(bd / "weighing-2026.db", [])
    _seed_session(api_client, role="admin")

    response = api_client.patch(
        "/api/archive/tickets/archive-1",
        json={
            "year": 2025,
            "patch": {"driver_name": "Петров П.П.", "gross_weight": 21000},
            "acknowledge_reo_sent_warning": False,
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["success"] is True
    assert payload["ticket"]["driver_name"] == "Петров П.П."
    assert payload["ticket"]["gross_weight"] == 21000.0
    assert payload["ticket"]["net_weight"] == 16000.0
    assert payload["ticket"]["total_amount"] == 1600.0
    assert payload["audit_event"]["event_type"] == "archive_edit"
    assert "driver_name" in payload["audit_event"]["changed_fields"]
    assert "gross_weight" in payload["audit_event"]["changed_fields"]
    assert "net_weight" in payload["audit_event"]["changed_fields"]
    assert _count_audit(archive_path, "archive-1") == 1

    card = api_client.get("/api/archive/tickets/archive-1?year=2025").get_json()
    assert card["ticket"]["driver_name"] == "Петров П.П."


def test_non_admin_archive_edit_blocked(api_client, temp_stage6_root):
    """TC-E2E-02: non-admin PATCH is rejected with insufficient_permissions."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    _create_archive_db(bd / "weighing-2025.db", [{"id": "archive-1"}])
    _create_archive_db(bd / "weighing-2026.db", [])
    _seed_session(api_client, role="user")

    response = api_client.patch(
        "/api/archive/tickets/archive-1",
        json={"year": 2025, "patch": {"driver_name": "Хакеров"}},
    )
    assert response.status_code == 403
    assert response.get_json()["code"] == "insufficient_permissions"
    assert _count_audit(bd / "weighing-2025.db", "archive-1") == 0


def test_archive_edit_reo_sent_requires_ack(api_client, temp_stage6_root):
    """TC-E2E-03: reo_status=sent requires ack; status stays sent with warning."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    _create_archive_db(
        archive_path,
        [
            {
                "id": "reo-1",
                "reo_status": "sent",
                "reo_sent_at": "2025-06-02T12:00:00Z",
                "driver_name": "Иванов",
            }
        ],
    )
    _create_archive_db(bd / "weighing-2026.db", [])
    _seed_session(api_client, role="admin")

    denied = api_client.patch(
        "/api/archive/tickets/reo-1",
        json={"year": 2025, "patch": {"driver_name": "Сидоров"}, "acknowledge_reo_sent_warning": False},
    )
    assert denied.status_code == 409
    assert denied.get_json()["code"] == "archive_reo_ack_required"
    assert _count_audit(archive_path, "reo-1") == 0

    accepted = api_client.patch(
        "/api/archive/tickets/reo-1",
        json={"year": 2025, "patch": {"driver_name": "Сидоров"}, "acknowledge_reo_sent_warning": True},
    )
    assert accepted.status_code == 200
    payload = accepted.get_json()
    assert payload["ticket"]["reo_status"] == "sent"
    assert payload["ticket"]["reo_sent_at"] == "2025-06-02T12:00:00Z"
    assert payload["warning"]["code"] == "archive_reo_sent_warning"
    assert payload["audit_event"]["reo_divergence_warning"] is True
    assert _count_audit(archive_path, "reo-1") == 1


def test_archive_edit_forbidden_field_keeps_data(api_client, temp_stage6_root):
    """TC-E2E-04: forbidden PATCH fields are rejected without side effects."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    _create_archive_db(archive_path, [{"id": "archive-1", "ticket_number": 42, "reo_status": "pending"}])
    _create_archive_db(bd / "weighing-2026.db", [])
    _seed_session(api_client, role="admin")

    for field, value in (("ticket_number", 99), ("reo_status", "sent")):
        response = api_client.patch(
            "/api/archive/tickets/archive-1",
            json={"year": 2025, "patch": {field: value}},
        )
        assert response.status_code == 422
        assert response.get_json()["code"] == "archive_edit_forbidden_field"

    card = api_client.get("/api/archive/tickets/archive-1?year=2025").get_json()
    assert card["ticket"]["ticket_number"] == 42
    assert card["ticket"]["reo_status"] == "pending"
    assert _count_audit(archive_path, "archive-1") == 0


def test_archive_edit_noop_diff_skips_audit(api_client, temp_stage6_root):
    """TC-E2E-05: no-op after normalization does not write ticket_audit."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    _create_archive_db(archive_path, [{"id": "archive-1", "driver_name": "Иванов"}])
    _create_archive_db(bd / "weighing-2026.db", [])
    _seed_session(api_client, role="admin")

    response = api_client.patch(
        "/api/archive/tickets/archive-1",
        json={"year": 2025, "patch": {"driver_name": "  Иванов  "}},
    )
    assert response.status_code == 422
    assert response.get_json()["code"] == "archive_edit_validation_failed"
    assert _count_audit(archive_path, "archive-1") == 0


def test_apply_archive_edit_does_not_touch_active_db(api_client, temp_stage6_root):
    """Manual smoke: active journal unchanged after archive edit."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    _create_archive_db(bd / "weighing-2025.db", [{"id": "archive-1", "driver_name": "Иванов"}])
    active_path = bd / "weighing-2026.db"
    _create_archive_db(active_path, [{"id": "active-1", "driver_name": "Активный", "ticket_number": 7}])
    _seed_session(api_client, role="admin")

    before = api_client.get("/api/database").get_json()["data"]
    active_tickets_before = json.loads(before["app_weighing_tickets"])

    patched = api_client.patch(
        "/api/archive/tickets/archive-1",
        json={"year": 2025, "patch": {"driver_name": "Архивный"}},
    )
    assert patched.status_code == 200

    after = api_client.get("/api/database").get_json()["data"]
    active_tickets_after = json.loads(after["app_weighing_tickets"])
    assert active_tickets_after == active_tickets_before
    assert persistence.read_active_year() == 2026

    # Reprint payload still available from archive card.
    card = api_client.get("/api/archive/tickets/archive-1?year=2025")
    assert card.status_code == 200
    assert card.get_json()["ticket"]["status"] == "completed"
    assert card.get_json()["ticket"]["driver_name"] == "Архивный"


def test_apply_archive_edit_service_transactional(temp_stage6_root):
    """Service-level happy path writes ticket and audit in one DB file."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    _create_archive_db(archive_path, [{"id": "svc-1", "notes": "old"}])

    result = apply_archive_edit(
        2025,
        "svc-1",
        {"notes": "new note"},
        {"id": "u-1", "role": "admin", "display_name": "Админ"},
        False,
    )
    assert result["ticket"]["notes"] == "new note"
    assert result["audit_event"]["changed_fields"] == ["notes"]
    assert _count_audit(archive_path, "svc-1") == 1
