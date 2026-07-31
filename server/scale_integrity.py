"""Integrity audit for persisted scale runtime contour."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

_ALLOWED_ACTIVE_SETS = {'primary', 'spare'}
_ALLOWED_TRANSPORTS = {'web_serial', 'serial_backend', 'tcp_client'}


@dataclass(frozen=True)
class AuditFinding:
    """Single integrity finding for runtime contour."""

    severity: str
    code: str
    message: str
    details: dict[str, Any]


@dataclass(frozen=True)
class AuditReport:
    """Structured integrity-audit result."""

    findings: list[AuditFinding]

    @property
    def fatal_findings(self) -> list[AuditFinding]:
        return [finding for finding in self.findings if finding.severity == 'fatal']

    @property
    def warning_findings(self) -> list[AuditFinding]:
        return [finding for finding in self.findings if finding.severity == 'warning']

    @property
    def aut_read_allowed(self) -> bool:
        return len(self.fatal_findings) == 0


def _finding(severity: str, code: str, message: str, **details: Any) -> AuditFinding:
    return AuditFinding(severity=severity, code=code, message=message, details=details)


def _normalized_connection(row: dict[str, Any]) -> tuple[dict[str, Any] | None, bool]:
    connection = row.get('connection')
    if isinstance(connection, dict):
        return connection, True

    raw_json = row.get('connection_json')
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError:
            return None, False
        if isinstance(parsed, dict):
            return parsed, True
        return None, False

    return None, False


def _has_valid_operator_session(current_user_blob: Any) -> bool:
    if not isinstance(current_user_blob, str) or not current_user_blob.strip():
        return False
    try:
        parsed = json.loads(current_user_blob)
    except json.JSONDecodeError:
        return False
    if not isinstance(parsed, dict):
        return False

    user = parsed.get('user')
    profile = parsed.get('profile')
    if not isinstance(user, dict) or not isinstance(profile, dict):
        return False

    return bool(user.get('id')) and bool(user.get('username')) and bool(profile.get('role'))


def _append_historical_warnings(
    findings: list[AuditFinding],
    snapshot: dict[str, Any],
    *,
    known_site_ids: set[str],
    known_scale_ids: set[str],
) -> None:
    tickets = snapshot.get('weighing_tickets')
    if not isinstance(tickets, list):
        return
    for ticket in tickets:
        if not isinstance(ticket, dict):
            continue
        site_id = ticket.get('site_id')
        scale_id = ticket.get('scale_id')
        ticket_id = ticket.get('id')
        if site_id and str(site_id) not in known_site_ids:
            findings.append(
                _finding(
                    'warning',
                    'historical_orphan_site_ticket',
                    'Исторический талон ссылается на отсутствующую площадку.',
                    ticket_id=ticket_id,
                    site_id=site_id,
                )
            )
        if scale_id and str(scale_id) not in known_scale_ids:
            findings.append(
                _finding(
                    'warning',
                    'historical_orphan_scale_ticket',
                    'Исторический талон ссылается на отсутствующий комплект весов.',
                    ticket_id=ticket_id,
                    scale_id=scale_id,
                )
            )


def run_scale_integrity_audit(connection: dict[str, Any]) -> AuditReport:
    """
    Validate runtime-critical persisted contour before connect/read.

    Args:
        connection: Runtime snapshot with `sites/scales/site_runtime/current_user`.

    Returns:
        AuditReport with fatal and warning findings.
    """

    findings: list[AuditFinding] = []
    snapshot = connection if isinstance(connection, dict) else {}
    sites = snapshot.get('sites') if isinstance(snapshot.get('sites'), list) else []
    scales = snapshot.get('scales') if isinstance(snapshot.get('scales'), list) else []
    site_runtime = snapshot.get('site_runtime') if isinstance(snapshot.get('site_runtime'), list) else []

    if not site_runtime:
        findings.append(
            _finding(
                'fatal',
                'site_runtime_missing',
                'Не найден runtime-контур site_runtime.',
            )
        )
        return AuditReport(findings=findings)

    runtime_rows = [row for row in site_runtime if isinstance(row, dict)]
    if not runtime_rows:
        findings.append(
            _finding(
                'fatal',
                'site_runtime_invalid',
                'site_runtime содержит некорректные записи.',
            )
        )
        return AuditReport(findings=findings)

    runtime = runtime_rows[0]
    site_id = str(runtime.get('site_id') or '')
    if not site_id:
        findings.append(
            _finding(
                'fatal',
                'site_runtime_site_id_missing',
                'У active runtime отсутствует site_id.',
            )
        )

    active_scale_set = runtime.get('active_scale_set')
    if active_scale_set not in _ALLOWED_ACTIVE_SETS:
        findings.append(
            _finding(
                'fatal',
                'active_scale_set_invalid',
                'active_scale_set должен быть primary или spare.',
                active_scale_set=active_scale_set,
            )
        )

    known_site_ids = {str(row.get('id')) for row in sites if isinstance(row, dict) and row.get('id')}
    known_scale_ids = {
        str(row.get('id'))
        for row in scales
        if isinstance(row, dict) and row.get('id')
    }
    if site_id and site_id not in known_site_ids:
        findings.append(
            _finding(
                'fatal',
                'active_site_missing',
                'site_runtime ссылается на отсутствующую площадку.',
                site_id=site_id,
            )
        )

    active_scales: list[dict[str, Any]] = []
    for row in scales:
        if not isinstance(row, dict):
            continue
        row_site_id = str(row.get('site_id') or '')
        row_role = str(row.get('role') or '')
        if row_site_id == site_id and row_role == active_scale_set:
            active_scales.append(row)

    if active_scale_set in _ALLOWED_ACTIVE_SETS and len(active_scales) != 1:
        findings.append(
            _finding(
                'fatal',
                'active_scale_missing_or_duplicate',
                'Для active_scale_set должен существовать ровно один active scale.',
                site_id=site_id,
                active_scale_set=active_scale_set,
                count=len(active_scales),
            )
        )

    for row in scales:
        if not isinstance(row, dict):
            continue
        _, valid_json = _normalized_connection(row)
        if valid_json:
            continue
        role = str(row.get('role') or '')
        row_site_id = str(row.get('site_id') or '')
        is_active = row_site_id == site_id and role == active_scale_set
        findings.append(
            _finding(
                'fatal' if is_active else 'warning',
                'scale_connection_json_invalid',
                'Некорректный JSON/объект connection для комплекта весов.',
                scale_id=row.get('id'),
                scale_role=role,
            )
        )

    if active_scales:
        active_scale = active_scales[0]
        adapter_id = str(active_scale.get('adapter_id') or '').strip()
        if not adapter_id:
            findings.append(
                _finding(
                    'fatal',
                    'active_adapter_missing',
                    'У активного комплекта отсутствует adapter_id.',
                    scale_id=active_scale.get('id'),
                )
            )

        active_connection, valid_json = _normalized_connection(active_scale)
        if valid_json and isinstance(active_connection, dict):
            transport = str(active_connection.get('transport') or '').strip()
            if transport not in _ALLOWED_TRANSPORTS:
                findings.append(
                    _finding(
                        'fatal',
                        'active_transport_invalid',
                        'У активного комплекта указан неподдерживаемый transport.',
                        transport=transport,
                        scale_id=active_scale.get('id'),
                    )
                )
            if transport == 'serial_backend':
                serial = active_connection.get('serial')
                serial_port = serial.get('port') if isinstance(serial, dict) else None
                if not isinstance(serial_port, str) or not serial_port.strip():
                    findings.append(
                        _finding(
                            'fatal',
                            'active_serial_port_missing',
                            'Для serial_backend требуется serial.port.',
                            scale_id=active_scale.get('id'),
                        )
                    )

    if not _has_valid_operator_session(snapshot.get('current_user')):
        findings.append(
            _finding(
                'fatal',
                'operator_session_invalid',
                'Активная operator-session отсутствует или неконсистентна.',
            )
        )

    _append_historical_warnings(
        findings,
        snapshot,
        known_site_ids=known_site_ids,
        known_scale_ids=known_scale_ids,
    )

    return AuditReport(findings=findings)
