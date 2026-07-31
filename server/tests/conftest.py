import json
import os
import sys
from typing import Any

import pytest

SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TESTS_DIR = os.path.abspath(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)

# Stage-6 fixture helpers (also available via stage6_fixtures for test imports).
from stage6_fixtures import (  # noqa: E402
    age_stage6_lock,
    build_stage6_active_year_db,
    build_stage6_archive_db,
    build_stage6_legacy_db,
    corrupt_tmp_database,
    freeze_stage6_now,
)


@pytest.fixture
def temp_app_root(tmp_path, monkeypatch):
    """Isolate SQLite/config writes to a temporary application root."""
    import sqlite_store
    import persistence

    root = tmp_path / 'app'
    root.mkdir()
    (root / 'BD').mkdir()

    monkeypatch.setattr(sqlite_store, 'get_app_root', lambda: str(root))
    monkeypatch.setattr(persistence, 'get_app_root', lambda: str(root))
    return root


@pytest.fixture
def api_client(temp_app_root):
    """Flask test client bound to the isolated temp app root."""
    import app as flask_app
    import scale_api

    class DefaultFakeTransport:
        def open(self, _connection):
            return None

        def read_line(self, _timeout_ms):
            return 'ST,GS,+00045.0kg\r\n'

        def close(self):
            return None

    flask_app.app.config['TESTING'] = True
    scale_api.reset_scale_runtime_state()
    scale_api.set_scale_transport_factory(DefaultFakeTransport)
    return flask_app.app.test_client()


@pytest.fixture
def temp_stage6_root(tmp_path, monkeypatch):
    """Create isolated stage-6 app root with configurable BD/config fixtures."""
    import persistence
    import sqlite_store

    root = tmp_path / "stage6_app"
    root.mkdir()
    bd_dir = root / "BD"
    bd_dir.mkdir()
    backup_dir = root / "backup"
    backup_dir.mkdir()
    config_path = root / "config.ini"
    config_path.write_text("[settings]\n", encoding="utf-8")

    monkeypatch.setattr(sqlite_store, "get_app_root", lambda: str(root))
    monkeypatch.setattr(persistence, "get_app_root", lambda: str(root))

    def _prepare(
        *,
        legacy_db_bytes: bytes | None = None,
        yearly_db_by_year: dict[int, bytes] | None = None,
        lock_payload: dict[str, Any] | None = None,
        config_overrides: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        """Populate optional stage-6 artifacts in the temporary root."""
        if legacy_db_bytes is not None:
            (bd_dir / "weighing.db").write_bytes(legacy_db_bytes)

        for year, yearly_bytes in (yearly_db_by_year or {}).items():
            (bd_dir / f"weighing-{int(year)}.db").write_bytes(yearly_bytes)

        lock_path = bd_dir / ".year_rotation.lock"
        if lock_payload is not None:
            lock_path.write_text(json.dumps(lock_payload, ensure_ascii=False), encoding="utf-8")
        elif lock_path.exists():
            lock_path.unlink()

        if config_overrides:
            lines = ["[settings]"]
            for key, value in config_overrides.items():
                lines.append(f"{key} = {value}")
            config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        return {
            "root": str(root),
            "bd_dir": str(bd_dir),
            "backup_dir": str(backup_dir),
            "config_path": str(config_path),
            "legacy_db_path": str(bd_dir / "weighing.db"),
            "lock_path": str(lock_path),
        }

    _prepare()
    return _prepare


@pytest.fixture(autouse=True)
def _clear_stage6_rotation_hooks():
    """Ensure rotation test hooks never leak between tests."""
    import year_rotation

    year_rotation.clear_rotation_test_hooks()
    yield
    year_rotation.clear_rotation_test_hooks()


def make_stage6_ticket_row(
    *,
    ticket_id: str = "stub-ticket-1",
    ticket_number: int = 1,
    status: str = "completed",
    reo_status: str = "pending",
    auto_closed: bool = False,
) -> dict[str, Any]:
    """Build deterministic stage-6 ticket row fixture payload."""
    return {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "status": status,
        "reo_status": reo_status,
        "auto_closed": auto_closed,
    }


def make_stage6_audit_row(
    *,
    event_id: str = "stub-audit-1",
    ticket_id: str = "stub-ticket-1",
    event_type: str = "archive_edit",
    source_year: int = 2025,
) -> dict[str, Any]:
    """Build deterministic stage-6 audit row fixture payload."""
    return {
        "id": event_id,
        "ticket_id": ticket_id,
        "action": event_type,
        "event_type": event_type,
        "source_year": source_year,
        "changed_fields_json": "[]",
        "old_values_json": "{}",
        "new_values_json": "{}",
        "reo_divergence_warning": 0,
        "at": "2026-01-01T00:00:00Z",
        "operator_name": "system",
        "operator_id": None,
    }


__all__ = [
    "age_stage6_lock",
    "build_stage6_active_year_db",
    "build_stage6_archive_db",
    "build_stage6_legacy_db",
    "corrupt_tmp_database",
    "freeze_stage6_now",
    "make_stage6_audit_row",
    "make_stage6_ticket_row",
]
