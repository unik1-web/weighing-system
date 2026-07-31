"""Stage-6 structured logging: redaction, required fields and operational trails."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import persistence
import sqlite_store
import year_rotation
from archive_edit_service import apply_archive_edit
from stage6_logging import (
    REDACTED,
    log_stage6_event,
    redact_sensitive_stage6_context,
)
from year_context import ArchiveContractError


def _stage6_payloads(caplog) -> list[dict]:
    """Parse structured JSON payloads from `stage6 ...` log messages."""
    payloads: list[dict] = []
    for record in caplog.records:
        message = record.getMessage()
        if not message.startswith('stage6 '):
            continue
        raw = message[len('stage6 ') :]
        payloads.append(json.loads(raw))
    return payloads


def _build_legacy_db(path: Path, ticket_dates: list[str]) -> None:
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for index, created_at in enumerate(ticket_dates, start=1):
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, created_at, gross_datetime, completed_at, status, reo_status
                )
                VALUES (?, ?, ?, ?, ?, 'completed', 'pending')
                """,
                (f't-{index}', index, created_at, created_at, created_at),
            )
        connection.commit()


def _build_active_year_fixture(db_path: Path) -> None:
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        connection.execute(
            """
            INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
            VALUES (?, 'vehicles', ?, '', '2025-01-01T00:00:00', ?)
            """,
            (
                'v-1',
                'А001АА',
                '{"vehicle_number":"А001АА","default_tare_weight":1200}',
            ),
        )
        connection.execute(
            """
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, gross_weight, price, vat_rate,
                status, reo_status, operator_id, operator_name, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'u-1', 'Оператор', ?)
            """,
            ('t-open', 101, 'А001АА', 5000, 2, 20, 'pending', '2025-12-31T21:00:00'),
        )
        connection.commit()


def _create_archive_db(path: Path, tickets: list[dict]) -> None:
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        sqlite_store.init_schema(connection)
        for ticket in tickets:
            connection.execute(
                """
                INSERT INTO weighing_tickets (
                    id, ticket_number, vehicle_number, driver_name, cargo_name,
                    status, reo_status, reo_sent_at, auto_closed, created_at, completed_at,
                    gross_weight, tare_weight, net_weight, total_amount, price, vat_rate, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticket['id'],
                    ticket.get('ticket_number', 1),
                    ticket.get('vehicle_number', 'A111AA56'),
                    ticket.get('driver_name', 'Иванов'),
                    ticket.get('cargo_name', 'Грунт'),
                    ticket.get('status', 'completed'),
                    ticket.get('reo_status', 'pending'),
                    ticket.get('reo_sent_at'),
                    1 if ticket.get('auto_closed') else 0,
                    ticket.get('created_at', '2025-06-01T10:00:00'),
                    ticket.get('completed_at', '2025-06-01T11:00:00'),
                    ticket.get('gross_weight', 20000),
                    ticket.get('tare_weight', 5000),
                    ticket.get('net_weight', 15000),
                    ticket.get('total_amount', 1500),
                    ticket.get('price', 100),
                    ticket.get('vat_rate', 20),
                    ticket.get('notes', ''),
                ),
            )
        connection.commit()


def test_redact_sensitive_stage6_context_masks_config_secrets():
    """TC-UNIT-01: redact_sensitive_stage6_context masks integration secrets."""
    redacted = redact_sensitive_stage6_context(
        {
            'reo_access_key': 'super-secret-key',
            'wa_db_password': 'wa-pass',
            'vescom_db_password': 'vescom-pass',
            'source_year': 2025,
            'connection': {'host': '10.0.0.1', 'port': 'COM3'},
            'token': 'abc',
            'pending_reo_count': 2,
        }
    )
    assert redacted['reo_access_key'] == REDACTED
    assert redacted['wa_db_password'] == REDACTED
    assert redacted['vescom_db_password'] == REDACTED
    assert redacted['connection'] == REDACTED
    assert redacted['token'] == REDACTED
    assert redacted['source_year'] == 2025
    assert redacted['pending_reo_count'] == 2


def test_log_stage6_event_includes_required_fields(caplog):
    """TC-UNIT-02: every stage6 log has event/status plus applicable fields."""
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        log_stage6_event(
            'rotation_commit',
            'success',
            source_year=2025,
            target_year=2026,
            db_path='/tmp/weighing-2026.db',
            backup_path='/tmp/backup.db',
            operator_id='u-1',
            operator_name='Оператор',
            open_count=3,
            auto_closed_count=2,
            pending_reo_count=1,
            lock_path='/tmp/.year_rotation.lock',
            lock_phase='published',
            reason='none',
            reo_access_key='must-not-leak',
        )

    payloads = _stage6_payloads(caplog)
    assert len(payloads) == 1
    payload = payloads[0]
    assert payload['event'] == 'rotation_commit'
    assert payload['status'] == 'success'
    assert payload['source_year'] == 2025
    assert payload['target_year'] == 2026
    assert payload['db_path'] == '/tmp/weighing-2026.db'
    assert payload['backup_path'] == '/tmp/backup.db'
    assert payload['operator_id'] == 'u-1'
    assert payload['operator_name'] == 'Оператор'
    assert payload['open_count'] == 3
    assert payload['auto_closed_count'] == 2
    assert payload['pending_reo_count'] == 1
    assert payload['lock_path'] == '/tmp/.year_rotation.lock'
    assert payload['lock_phase'] == 'published'
    assert payload['reason'] == 'none'
    assert payload['reo_access_key'] == REDACTED
    assert 'must-not-leak' not in caplog.text


def test_primary_migration_logs_start_result_and_backup(temp_stage6_root, caplog):
    """TC-E2E-01: successful UC-01 emits start, result, backup and years."""
    paths = temp_stage6_root()
    _build_legacy_db(Path(paths['legacy_db_path']), ['2026-03-01T10:00:00'])

    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        result = year_rotation.ensure_stage6_storage_bootstrap(datetime(2026, 6, 1, 10, 0, 0))

    assert result['status'] == 'migrated'
    payloads = _stage6_payloads(caplog)
    events = [(item['event'], item['status']) for item in payloads]
    assert ('primary_migration', 'start') in events
    assert ('primary_migration', 'success') in events
    assert ('primary_migration_backup', 'success') in events

    success = next(item for item in payloads if item['event'] == 'primary_migration' and item['status'] == 'success')
    assert success['source_year'] == 2026
    assert success['target_year'] == 2026
    assert success.get('backup_path')
    assert Path(success['backup_path']).is_file()


def test_rotation_commit_and_stale_recovery_logs(temp_stage6_root, caplog):
    """TC-E2E-02: commit and stale-recovery emit lock/backup/auto_closed/publish logs."""
    paths = temp_stage6_root(config_overrides={'tara_default': '900'})
    source_year = 2025
    target_year = 2026
    persistence.write_active_year(source_year)
    source_db = Path(paths['bd_dir']) / f'weighing-{source_year}.db'
    _build_active_year_fixture(source_db)

    # Fail path: fresh lock blocks commit.
    fresh_lock = {
        'source_year': source_year,
        'target_year': target_year,
        'preview_token': 'preview-token',
        'source_db_fingerprint': 'fingerprint',
        'started_at': datetime.now().isoformat(),
        'phase': 'started',
        'recovery_mode': 'none',
        'backup_path': None,
        'tmp_db_path': str(Path(paths['bd_dir']) / f'weighing-{target_year}.db.tmp'),
        'lock_ttl_seconds': 900,
    }
    persistence.write_rotation_lock(fresh_lock)
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        try:
            year_rotation.commit_year_rotation(
                preview_token='any',
                acknowledge_pending_reo=True,
                actor={'id': 'u-1', 'display_name': 'Оператор', 'role': 'user'},
                now=datetime(2026, 1, 1, 10, 0, 0),
            )
        except Exception as exc:
            assert getattr(exc, 'code', None) == 'rotation_in_progress'
        else:
            raise AssertionError('Expected rotation_in_progress')

    blocked_payloads = _stage6_payloads(caplog)
    assert any(
        item['event'] == 'rotation_commit'
        and item['status'] == 'error'
        and item.get('reason') == 'rotation_in_progress'
        for item in blocked_payloads
    )
    persistence.remove_rotation_lock()
    caplog.clear()

    # Stale-recovery path (separate from successful publish).
    tmp_db = Path(paths['bd_dir']) / f'weighing-{target_year}.db.tmp'
    with sqlite3.connect(tmp_db) as target_conn:
        target_conn.row_factory = sqlite3.Row
        sqlite_store.init_schema(target_conn)
        target_conn.commit()
    stale_lock = dict(fresh_lock)
    stale_lock['started_at'] = (datetime.now() - timedelta(minutes=20)).isoformat()
    stale_lock['tmp_db_path'] = str(tmp_db)
    persistence.write_rotation_lock(stale_lock)

    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        recovery = year_rotation.recover_rotation_if_needed(datetime.now())
    assert recovery['mode'] == 'resume_tmp'
    recovery_payloads = _stage6_payloads(caplog)
    assert any(
        item['event'] == 'rotation_stale_recovery'
        and item['status'] == 'success'
        and item.get('recovery_mode') == 'resume_tmp'
        for item in recovery_payloads
    )
    persistence.remove_rotation_lock()
    if tmp_db.exists():
        tmp_db.unlink()
    caplog.clear()

    # Successful commit path: lock acquisition, backup, auto_closed, publish.
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        preview = year_rotation.build_rotation_preview(
            datetime(2026, 1, 1, 10, 0, 0),
            actor={'id': 'u-1', 'display_name': 'Оператор'},
        )
        result = year_rotation.commit_year_rotation(
            preview_token=preview['preview_token'],
            acknowledge_pending_reo=True,
            actor={'id': 'u-1', 'display_name': 'Оператор', 'role': 'user'},
            now=datetime(2026, 1, 1, 10, 1, 0),
        )

    assert result['success'] is True
    payloads = _stage6_payloads(caplog)
    events = {(item['event'], item['status']) for item in payloads}
    assert ('rotation_lock', 'acquired') in events
    assert ('rotation_backup', 'success') in events
    assert ('rotation_commit', 'success') in events

    commit_success = next(
        item for item in payloads if item['event'] == 'rotation_commit' and item['status'] == 'success'
    )
    assert commit_success['source_year'] == 2025
    assert commit_success['target_year'] == 2026
    assert commit_success['auto_closed_count'] == 1
    assert commit_success.get('backup_path')
    assert commit_success.get('lock_phase') == 'published'


def test_archive_edit_logs_success_and_forbidden_without_full_diff(temp_stage6_root, caplog):
    """TC-E2E-03 + TC-UNIT-03: archive edit logs summary; ticket_audit keeps full diff."""
    paths = temp_stage6_root(config_overrides={'active_year': 2026})
    bd = Path(paths['bd_dir'])
    archive_path = bd / 'weighing-2025.db'
    _create_archive_db(
        archive_path,
        [
            {
                'id': 'archive-1',
                'driver_name': 'Иванов',
                'reo_status': 'sent',
                'reo_sent_at': '2025-06-02T12:00:00Z',
            }
        ],
    )
    _create_archive_db(bd / 'weighing-2026.db', [])
    actor = {
        'id': 'u-admin',
        'username': 'admin',
        'display_name': 'Администратор',
        'role': 'admin',
    }

    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        try:
            apply_archive_edit(
                2025,
                'archive-1',
                {'ticket_number': 99},
                actor,
                acknowledge_reo_sent_warning=True,
            )
        except ArchiveContractError as exc:
            assert exc.code == 'archive_edit_forbidden_field'
        else:
            raise AssertionError('Expected archive_edit_forbidden_field')

        result = apply_archive_edit(
            2025,
            'archive-1',
            {'driver_name': 'Петров'},
            actor,
            acknowledge_reo_sent_warning=True,
        )

        try:
            apply_archive_edit(
                2025,
                'archive-1',
                {'driver_name': 'Петров'},
                actor,
                acknowledge_reo_sent_warning=True,
            )
        except ArchiveContractError as exc:
            assert exc.code == 'archive_edit_validation_failed'
        else:
            raise AssertionError('Expected noop validation failure')

    assert result['success'] is True
    payloads = _stage6_payloads(caplog)

    forbidden = next(
        item
        for item in payloads
        if item['event'] == 'archive_edit' and item['status'] == 'forbidden'
    )
    assert forbidden['source_year'] == 2025
    assert forbidden.get('operator_id') == 'u-admin'
    assert forbidden.get('reason') == 'archive_edit_forbidden_field'

    success = next(
        item for item in payloads if item['event'] == 'archive_edit' and item['status'] == 'success'
    )
    assert success['source_year'] == 2025
    assert success.get('operator_name') == 'Администратор'
    assert success.get('changed_fields_count') >= 1
    assert 'old_values' not in success
    assert 'new_values' not in success
    assert 'Иванов' not in json.dumps(success, ensure_ascii=False)
    assert 'Петров' not in json.dumps(success, ensure_ascii=False)

    warning = next(
        item
        for item in payloads
        if item['event'] == 'archive_edit'
        and item['status'] == 'warning'
        and item.get('reason') == 'reo_divergence_warning'
    )
    assert warning['source_year'] == 2025

    noop = next(item for item in payloads if item['event'] == 'archive_edit' and item['status'] == 'noop')
    assert noop.get('reason') == 'archive_edit_noop'

    # Functional audit still stores the full field-level diff.
    with sqlite3.connect(archive_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT changed_fields_json, old_values_json, new_values_json, reo_divergence_warning
            FROM ticket_audit
            WHERE ticket_id = ? AND event_type = 'archive_edit'
            """,
            ('archive-1',),
        ).fetchone()
    assert row is not None
    changed_fields = json.loads(row['changed_fields_json'])
    old_values = json.loads(row['old_values_json'])
    new_values = json.loads(row['new_values_json'])
    assert 'driver_name' in changed_fields
    assert old_values['driver_name'] == 'Иванов'
    assert new_values['driver_name'] == 'Петров'
    assert int(row['reo_divergence_warning']) == 1
