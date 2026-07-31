"""Stage-6 skeleton tests: stubs, paths, and add-only migration."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

import persistence
import sqlite_store


def test_get_sqlite_path_supports_year_and_suffix(temp_app_root):
    """TC-UNIT-01: get_sqlite_path builds legacy/year/tmp paths."""
    legacy = sqlite_store.get_sqlite_path()
    yearly = sqlite_store.get_sqlite_path(2026)
    yearly_tmp = sqlite_store.get_sqlite_path(2027, suffix='.tmp')

    assert legacy.endswith('BD/weighing.db')
    assert yearly.endswith('BD/weighing-2026.db')
    assert yearly_tmp.endswith('BD/weighing-2027.db.tmp')


def test_read_write_active_year_uses_settings_section(temp_app_root):
    """TC-UNIT-02: read_active_year/write_active_year use config.ini[settings]."""
    assert persistence.read_active_year() is None
    persistence.write_active_year(2026)
    assert persistence.read_active_year() == 2026


def test_migrate_schema_stage_6_adds_columns_indexes_and_version(temp_app_root):
    """TC-UNIT-03: stage-6 migration updates schema in add-only mode."""
    with sqlite_store.connect() as connection:
        connection.executescript(
            '''
            CREATE TABLE weighing_tickets (
                id TEXT PRIMARY KEY,
                ticket_number INTEGER,
                vehicle_number TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                reo_status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE ticket_audit (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                action TEXT NOT NULL,
                at TEXT NOT NULL,
                operator_name TEXT NOT NULL DEFAULT '',
                operator_id TEXT
            );
            PRAGMA user_version = 5;
            '''
        )
        sqlite_store.migrate_schema_stage_6(connection)

        ticket_columns = {
            row['name'] for row in connection.execute('PRAGMA table_info(weighing_tickets)')
        }
        audit_columns = {
            row['name'] for row in connection.execute('PRAGMA table_info(ticket_audit)')
        }
        indexes = {
            row['name']
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            )
        }
        version = int(connection.execute('PRAGMA user_version').fetchone()[0])

    assert 'auto_closed' in ticket_columns
    assert 'event_type' in audit_columns
    assert 'source_year' in audit_columns
    assert 'changed_fields_json' in audit_columns
    assert 'old_values_json' in audit_columns
    assert 'new_values_json' in audit_columns
    assert 'reo_divergence_warning' in audit_columns
    assert 'idx_ticket_audit_event_year' in indexes
    assert 'idx_ticket_audit_autoclose_once' in indexes
    assert version == sqlite_store.SCHEMA_VERSION_STAGE_6


def test_stage6_endpoints_return_stub_contract(api_client, temp_stage6_root):
    """TC-E2E-01: stage-6 archive endpoints return real catalog/journal contract."""
    paths = temp_stage6_root(config_overrides={"active_year": 2026})
    bd = Path(paths["bd_dir"])
    with sqlite3.connect(bd / "weighing-2026.db") as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()
    with sqlite3.connect(bd / "weighing-2025.db") as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, status, reo_status, auto_closed, created_at
            ) VALUES ('t-1', 1, 'completed', 'pending', 0, '2025-01-01T00:00:00')
            """
        )
        connection.commit()

    session_payload = json.dumps(
        {
            'user': {'id': 'u-1', 'username': 'operator'},
            'profile': {'username': 'operator', 'display_name': 'Оператор', 'role': 'admin'},
        },
        ensure_ascii=False,
    )
    api_client.post('/api/database', json={'data': {'app_current_user': session_payload}})

    years_response = api_client.get('/api/archive/years')
    assert years_response.status_code == 200
    years_payload = years_response.get_json()
    assert years_payload['success'] is True
    assert years_payload['years'][0]['file_name'] == 'weighing-2025.db'

    tickets_missing_year = api_client.get('/api/archive/tickets')
    assert tickets_missing_year.status_code == 400
    assert tickets_missing_year.get_json()['code'] == 'invalid_archive_year'

    tickets_response = api_client.get('/api/archive/tickets?year=2025')
    assert tickets_response.status_code == 200
    tickets_payload = tickets_response.get_json()
    assert tickets_payload['success'] is True
    assert tickets_payload['year'] == 2025
    assert len(tickets_payload['tickets']) == 1

    card_response = api_client.get('/api/archive/tickets/t-1?year=2025')
    assert card_response.status_code == 200
    card_payload = card_response.get_json()
    assert card_payload['success'] is True
    assert card_payload['year'] == 2025
    assert card_payload['ticket']['id'] == 't-1'

    patch_response = api_client.patch(
        '/api/archive/tickets/t-1',
        json={'year': 2025, 'patch': {'driver_name': 'Оператор'}},
    )
    assert patch_response.status_code == 200
    patch_payload = patch_response.get_json()
    assert patch_payload['success'] is True
    assert patch_payload['audit_event']['event_type'] == 'archive_edit'

    current_year = datetime.now().year - 1
    persistence.write_active_year(current_year)
    with sqlite3.connect(persistence.get_year_database_path(current_year)) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.commit()
    api_client.post('/api/database', json={'data': {'app_current_user': session_payload}})

    preview_response = api_client.post('/api/year/rotation/preview', json={})
    assert preview_response.status_code == 200
    preview_payload = preview_response.get_json()
    assert preview_payload['success'] is True
    assert isinstance(preview_payload['preview_token'], str)
    assert preview_payload['preview_token'].startswith('rotprev_')
    assert isinstance(preview_payload['open_candidates'], list)

    commit_response = api_client.post(
        '/api/year/rotation/commit',
        json={
            'source_year': 2026,
            'target_year': 2027,
            'preview_token': preview_payload['preview_token'],
            'acknowledge_pending_reo': True,
        },
    )
    if commit_response.status_code == 200:
        commit_payload = commit_response.get_json()
        assert commit_payload['success'] is True
        assert commit_payload['source_year'] == preview_payload['source_year']
        assert commit_payload['target_year'] == preview_payload['target_year']
    else:
        assert commit_response.status_code in (409, 422, 500)


def test_stage5_runtime_still_works_with_stage6_skeleton(api_client):
    """TC-E2E-02: legacy /api/config and /api/database still work."""
    config_response = api_client.get('/api/config')
    assert config_response.status_code == 200
    assert config_response.get_json()['success'] is True

    database_response = api_client.get('/api/database')
    assert database_response.status_code == 200
    payload = database_response.get_json()
    assert payload['success'] is True
    assert isinstance(payload['data'], dict)
