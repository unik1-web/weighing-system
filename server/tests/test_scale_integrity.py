"""Unit tests for runtime integrity audit and logging redaction."""

from __future__ import annotations

import json
import logging

from app import log_scale_runtime_event
from scale_integrity import run_scale_integrity_audit


def _active_session_payload() -> str:
    return json.dumps(
        {
            'user': {'id': 'u-1', 'username': 'operator'},
            'profile': {'role': 'admin'},
        },
        ensure_ascii=False,
    )


def test_scale_integrity_audit_splits_fatal_and_warning_findings():
    """TC-UNIT-01: active contour issues are fatal, historical ones are warning."""
    report = run_scale_integrity_audit(
        {
            'sites': [{'id': 'default-site', 'name': 'Main', 'created_at': '2026-07-31T00:00:00Z'}],
            'scales': [
                {
                    'id': 'scale-primary',
                    'site_id': 'default-site',
                    'role': 'primary',
                    'adapter_id': 'cas',
                    'connection': {'transport': 'serial_backend', 'serial': {'port': 'COM1'}},
                },
                {
                    'id': 'scale-spare',
                    'site_id': 'default-site',
                    'role': 'spare',
                    'adapter_id': 'newton',
                    'connection_json': '{broken-json',
                },
            ],
            'site_runtime': [
                {
                    'site_id': 'default-site',
                    'active_scale_set': 'spare',
                }
            ],
            'current_user': _active_session_payload(),
            'weighing_tickets': [
                {'id': 'ticket-1', 'site_id': 'default-site', 'scale_id': 'scale-missing'},
            ],
        }
    )

    fatal_codes = {finding.code for finding in report.fatal_findings}
    warning_codes = {finding.code for finding in report.warning_findings}

    assert 'scale_connection_json_invalid' in fatal_codes
    assert 'historical_orphan_scale_ticket' in warning_codes
    assert report.aut_read_allowed is False


def test_scale_runtime_logging_redacts_sensitive_values(caplog):
    """TC-UNIT-03: backend logging helper redacts COM/TTY/IP values."""
    with caplog.at_level(logging.INFO, logger='weighing-system-api'):
        log_scale_runtime_event(
            'redaction_probe',
            level=logging.INFO,
            port='COM3',
            tty='/dev/ttyUSB0',
            host='192.168.1.10',
        )

    messages = '\n'.join(record.getMessage() for record in caplog.records)
    assert 'COM3' not in messages
    assert '/dev/ttyUSB0' not in messages
    assert '192.168.1.10' not in messages
    assert 'COM***' in messages
    assert '/dev/tty***' in messages
    assert '***.***.***.***' in messages
