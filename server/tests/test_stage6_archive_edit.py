"""Backend integration coverage for archive edit contracts and audit (UC-05)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import persistence
from archive_edit_service import ARCHIVE_EDIT_ALLOWLIST
from stage6_fixtures import build_stage6_archive_db


# Explicit denylist from architecture / UC-05 — each field is patched alone.
ARCHIVE_EDIT_FORBIDDEN_FIELDS: tuple[str, ...] = (
    "id",
    "ticket_number",
    "created_at",
    "completed_at",
    "version",
    "status",
    "auto_closed",
    "weighing_mode",
    "price",
    "vat_rate",
    "gross_datetime",
    "tare_datetime",
    "manual_weight_reason",
    "gross_source",
    "tare_source",
    "gross_raw",
    "tare_raw",
    "scale_device",
    "plate_source",
    "site_id",
    "scale_id",
    "scale_role",
    "reo_status",
    "reo_sent_at",
    "photo_entry_path",
    "photo_exit_path",
    "operator_id",
    "operator_name",
    "ticket_audit",
    "net_weight",
    "total_amount",
)


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


def _forbidden_sample_value(field: str):
    """Return a plausible PATCH value for a forbidden field."""
    if field in {"ticket_number", "version", "price", "vat_rate", "net_weight", "total_amount"}:
        return 99
    if field in {"auto_closed"}:
        return True
    if field.endswith("_at") or field.endswith("_datetime"):
        return "2025-01-01T00:00:00"
    return "forbidden-value"


def test_tf03_archive_edit_with_sent_reo(api_client, temp_stage6_root):
    """TC-E2E-03 / TF-03: sent REO edit keeps status, writes reo_divergence_warning."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    build_stage6_archive_db(
        archive_path,
        tickets=[
            {
                "id": "reo-1",
                "reo_status": "sent",
                "reo_sent_at": "2025-06-02T12:00:00Z",
                "driver_name": "Иванов",
            }
        ],
    )
    build_stage6_archive_db(bd / "weighing-2026.db", tickets=[])
    persistence.write_active_year(2026)
    _seed_session(api_client, role="admin")

    denied = api_client.patch(
        "/api/archive/tickets/reo-1",
        json={
            "year": 2025,
            "patch": {"driver_name": "Сидоров"},
            "acknowledge_reo_sent_warning": False,
        },
    )
    assert denied.status_code == 409
    assert denied.get_json()["code"] == "archive_reo_ack_required"
    assert _count_audit(archive_path, "reo-1") == 0

    accepted = api_client.patch(
        "/api/archive/tickets/reo-1",
        json={
            "year": 2025,
            "patch": {"driver_name": "Сидоров"},
            "acknowledge_reo_sent_warning": True,
        },
    )
    assert accepted.status_code == 200
    payload = accepted.get_json()
    assert payload["ticket"]["reo_status"] == "sent"
    assert payload["ticket"]["reo_sent_at"] == "2025-06-02T12:00:00Z"
    assert payload["warning"]["code"] == "archive_reo_sent_warning"
    assert payload["audit_event"]["reo_divergence_warning"] is True
    assert _count_audit(archive_path, "reo-1") == 1


def test_archive_edit_forbidden_field_matrix(api_client, temp_stage6_root):
    """TC-UNIT-03: PATCH of each forbidden field returns archive_edit_forbidden_field."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    build_stage6_archive_db(
        archive_path,
        tickets=[{"id": "archive-1", "ticket_number": 42, "reo_status": "pending", "driver_name": "Иванов"}],
    )
    build_stage6_archive_db(bd / "weighing-2026.db", tickets=[])
    persistence.write_active_year(2026)
    _seed_session(api_client, role="admin")

    for field in ARCHIVE_EDIT_FORBIDDEN_FIELDS:
        assert field not in ARCHIVE_EDIT_ALLOWLIST
        response = api_client.patch(
            "/api/archive/tickets/archive-1",
            json={"year": 2025, "patch": {field: _forbidden_sample_value(field)}},
        )
        assert response.status_code == 422, field
        assert response.get_json()["code"] == "archive_edit_forbidden_field", field

    card = api_client.get("/api/archive/tickets/archive-1?year=2025").get_json()
    assert card["ticket"]["ticket_number"] == 42
    assert card["ticket"]["driver_name"] == "Иванов"
    assert card["ticket"]["reo_status"] == "pending"
    assert _count_audit(archive_path, "archive-1") == 0


def test_archive_edit_allowlist_happy_path(api_client, temp_stage6_root):
    """Admin allowlist PATCH recalculates derived fields and writes audit."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    archive_path = bd / "weighing-2025.db"
    build_stage6_archive_db(
        archive_path,
        tickets=[{"id": "archive-1", "driver_name": "Иванов", "gross_weight": 20000, "tare_weight": 5000}],
    )
    build_stage6_archive_db(bd / "weighing-2026.db", tickets=[])
    persistence.write_active_year(2026)
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
    assert payload["ticket"]["driver_name"] == "Петров П.П."
    assert payload["ticket"]["gross_weight"] == 21000.0
    assert payload["ticket"]["net_weight"] == 16000.0
    assert payload["audit_event"]["event_type"] == "archive_edit"
    assert _count_audit(archive_path, "archive-1") == 1
