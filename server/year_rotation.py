"""Year rotation: preview, auto-close open tickets, backup, copy entities, switch active_year."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime
from typing import Any

import year_db
from config_ini import CONFIG_SECTION, read_ini_section
from sqlite_store import (
    TICKET_COLUMNS,
    connect,
    init_schema,
)

_rotate_lock = threading.Lock()

COPY_TABLES = (
    'users',
    'profiles',
    'dictionary_entries',
    'vehicle_drivers',
    'sites',
    'scales',
    'site_runtime',
    'site_scale_switches',
)

ATTENTION_NOTE = '[автозакрытие: тара не определена]'


def _now_iso() -> str:
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def _tara_default_from_config() -> float:
    config = read_ini_section(year_db.get_config_path(), CONFIG_SECTION)
    raw = config.get('tara_default', '0')
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.0
    return value if value > 0 else 0.0


def _net_weight(gross: float, tare: float) -> float:
    return max(0.0, float(gross) - float(tare))


def _total_amount(net: float, price: float) -> float:
    return (float(net) / 1000.0) * float(price or 0)


def _vehicle_default_tare(connection: sqlite3.Connection, vehicle_number: str) -> float | None:
    rows = connection.execute(
        '''
        SELECT payload FROM dictionary_entries
        WHERE category = 'vehicles' AND name = ?
        ''',
        (vehicle_number,),
    ).fetchall()
    for row in rows:
        try:
            payload = json.loads(row['payload'] or '{}')
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        tare = payload.get('default_tare_weight')
        if tare is None or tare == '':
            continue
        try:
            value = float(tare)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return None


def _last_completed_tare(connection: sqlite3.Connection, vehicle_number: str) -> float | None:
    row = connection.execute(
        '''
        SELECT tare_weight FROM weighing_tickets
        WHERE vehicle_number = ?
          AND status = 'completed'
          AND tare_weight IS NOT NULL
        ORDER BY COALESCE(completed_at, created_at) DESC
        LIMIT 1
        ''',
        (vehicle_number,),
    ).fetchone()
    if not row or row['tare_weight'] is None:
        return None
    try:
        value = float(row['tare_weight'])
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def resolve_tare_for_ticket(
    connection: sqlite3.Connection,
    vehicle_number: str,
    tara_default: float,
) -> tuple[float | None, str]:
    """Return (tare_weight, tare_source_label) where label is dictionary|default|none."""
    dict_tare = _vehicle_default_tare(connection, vehicle_number)
    if dict_tare is not None:
        return dict_tare, 'dictionary'
    last_tare = _last_completed_tare(connection, vehicle_number)
    if last_tare is not None:
        return last_tare, 'dictionary'
    if tara_default > 0:
        return tara_default, 'default'
    return None, 'none'


def profile_role(operator_id: str | None) -> str | None:
    if not operator_id:
        return None
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            'SELECT role FROM profiles WHERE user_id = ?',
            (str(operator_id),),
        ).fetchone()
        return str(row['role']) if row else None


def require_admin(operator_id: str | None) -> None:
    role = profile_role(operator_id)
    if role != 'admin':
        raise PermissionError('Требуется роль администратора')


def count_open_and_reo_pending(connection: sqlite3.Connection) -> tuple[int, int]:
    open_count = connection.execute(
        "SELECT COUNT(*) AS c FROM weighing_tickets WHERE status = 'open'"
    ).fetchone()['c']
    reo_pending = connection.execute(
        "SELECT COUNT(*) AS c FROM weighing_tickets WHERE reo_status = 'pending'"
    ).fetchone()['c']
    return int(open_count), int(reo_pending)


def preview_rotation() -> dict[str, Any]:
    active_year = year_db.resolve_active_year()
    with connect() as connection:
        init_schema(connection)
        open_count, reo_pending = count_open_and_reo_pending(connection)
    suggested = year_db.calendar_year()
    if suggested <= active_year:
        suggested = active_year + 1
    return {
        'active_year': active_year,
        'open_count': open_count,
        'reo_pending_count': reo_pending,
        'suggested_new_year': suggested,
    }


def auto_close_open_tickets(
    connection: sqlite3.Connection,
    *,
    operator_id: str | None,
    operator_name: str,
    tara_default: float,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets WHERE status = ?',
        ('open',),
    ).fetchall()
    closed: list[dict[str, Any]] = []
    now = _now_iso()

    for row in rows:
        ticket = {column: row[column] for column in TICKET_COLUMNS}
        vehicle_number = str(ticket.get('vehicle_number') or '')
        tare_weight, tare_label = resolve_tare_for_ticket(
            connection, vehicle_number, tara_default
        )
        attention = tare_weight is None
        notes = str(ticket.get('notes') or '')
        updates: dict[str, Any] = {
            'status': 'completed',
            'auto_closed': 1,
            'completed_at': now,
            'version': int(ticket.get('version') or 1) + 1,
        }

        if tare_weight is not None:
            updates['tare_weight'] = tare_weight
            updates['tare_source'] = 'dictionary' if tare_label == 'dictionary' else 'default'
            if ticket.get('tare_datetime') in (None, ''):
                updates['tare_datetime'] = now
            gross = ticket.get('gross_weight')
            if gross is not None:
                try:
                    gross_f = float(gross)
                    net = _net_weight(gross_f, tare_weight)
                    price = float(ticket.get('price') or 0)
                    updates['net_weight'] = net
                    updates['total_amount'] = _total_amount(net, price)
                except (TypeError, ValueError):
                    pass
        else:
            if ATTENTION_NOTE not in notes:
                updates['notes'] = f'{notes} {ATTENTION_NOTE}'.strip() if notes else ATTENTION_NOTE

        set_parts = []
        values: list[Any] = []
        for key, value in updates.items():
            set_parts.append(f'{key} = ?')
            values.append(value)
        values.append(ticket['id'])
        connection.execute(
            f'UPDATE weighing_tickets SET {", ".join(set_parts)} WHERE id = ?',
            values,
        )

        audit_id = str(uuid.uuid4())
        connection.execute(
            '''
            INSERT INTO ticket_audit (id, ticket_id, action, at, operator_name, operator_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (
                audit_id,
                ticket['id'],
                'auto_closed',
                now,
                operator_name or 'system',
                operator_id,
            ),
        )

        closed.append(
            {
                'id': ticket['id'],
                'ticket_number': ticket.get('ticket_number'),
                'vehicle_number': vehicle_number,
                'tare_source': tare_label,
                'tare_weight': tare_weight,
                'attention': attention,
            }
        )
    return closed


def _table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(f'PRAGMA table_info({table})').fetchall()
    return [str(row['name']) for row in rows]


def copy_entities_to_new_year(source_path: str, target_path: str) -> None:
    with connect(target_path) as connection:
        init_schema(connection)
        # Finish schema txn before ATTACH so DETACH is not blocked.
        connection.commit()
        connection.execute('ATTACH DATABASE ? AS src', (source_path,))
        try:
            for table in COPY_TABLES:
                columns = _table_columns(connection, table)
                if not columns:
                    continue
                col_list = ', '.join(columns)
                connection.execute(f'DELETE FROM main.{table}')
                connection.execute(
                    f'INSERT INTO main.{table} ({col_list}) SELECT {col_list} FROM src.{table}'
                )
            connection.commit()
        finally:
            connection.execute('DETACH DATABASE src')


def rotate_year(
    target_year: int,
    *,
    operator_id: str | None,
    operator_name: str,
    confirm_reo_pending: bool = False,
) -> dict[str, Any]:
    if not _rotate_lock.acquire(blocking=False):
        raise RuntimeError('Ротация уже выполняется')

    try:
        require_admin(operator_id)
        preview = preview_rotation()
        active_year = int(preview['active_year'])
        target = int(target_year)

        if target <= active_year:
            raise ValueError('Целевой год должен быть больше активного')
        if os_path_exists_year(target):
            raise ValueError(f'Файл базы года {target} уже существует')

        reo_pending = int(preview['reo_pending_count'])
        if reo_pending > 0 and not confirm_reo_pending:
            raise ReoPendingConfirmRequired(reo_pending)

        tara_default = _tara_default_from_config()
        source_path = year_db.year_db_path(active_year)

        with connect(source_path) as connection:
            init_schema(connection)
            auto_closed = auto_close_open_tickets(
                connection,
                operator_id=operator_id,
                operator_name=operator_name or 'system',
                tara_default=tara_default,
            )
            _, reo_pending_after = count_open_and_reo_pending(connection)

        backup_path = year_db.make_rotation_backup(active_year)
        target_path = year_db.year_db_path(target)
        copy_entities_to_new_year(source_path, target_path)
        year_db.write_active_year(target)

        return {
            'ok': True,
            'previous_year': active_year,
            'active_year': target,
            'backup_path': backup_path,
            'auto_closed': auto_closed,
            'reo_pending_count': reo_pending_after,
        }
    finally:
        _rotate_lock.release()


def os_path_exists_year(year: int) -> bool:
    return os.path.isfile(year_db.year_db_path(year))


class ReoPendingConfirmRequired(Exception):
    def __init__(self, count: int):
        super().__init__('reo_pending_confirm_required')
        self.count = count
        self.error = 'reo_pending_confirm_required'


class ReoSentConfirmRequired(Exception):
    def __init__(self):
        super().__init__('reo_sent_confirm_required')
        self.error = 'reo_sent_confirm_required'


class VersionConflict(Exception):
    def __init__(self, expected: int, actual: int):
        super().__init__('version_conflict')
        self.expected = expected
        self.actual = actual
        self.error = 'version_conflict'


ARCHIVE_EDITABLE_FIELDS = (
    'vehicle_number',
    'vehicle_brand',
    'trailer_number',
    'driver_name',
    'cargo_name',
    'shipper_name',
    'receiver_name',
    'carrier_name',
    'price',
    'vat_rate',
    'gross_weight',
    'tare_weight',
    'net_weight',
    'total_amount',
    'gross_source',
    'tare_source',
    'gross_raw',
    'tare_raw',
    'gross_datetime',
    'tare_datetime',
    'scale_device',
    'status',
    'reo_status',
    'reo_sent_at',
    'notes',
    'created_at',
    'completed_at',
    'weighing_mode',
    'plate_source',
    'site_id',
    'scale_id',
    'scale_role',
    'manual_weight_reason',
)


def _stringify_revision_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def update_archive_ticket(
    year: int,
    ticket_patch: dict[str, Any],
    *,
    operator_id: str | None,
    operator_name: str,
    confirm_reo_sent: bool = False,
) -> dict[str, Any]:
    require_admin(operator_id)

    path = year_db.year_db_path(year)
    if not os.path.isfile(path):
        raise FileNotFoundError(f'Архив года {year} не найден')

    ticket_id = str(ticket_patch.get('id') or '')
    if not ticket_id:
        raise ValueError('Не указан id тикета')

    expected_version = ticket_patch.get('version')
    if expected_version is None:
        raise ValueError('Не указан version тикета')
    try:
        expected_version_int = int(expected_version)
    except (TypeError, ValueError) as exc:
        raise ValueError('Некорректный version') from exc

    with connect(path) as connection:
        init_schema(connection)
        row = connection.execute(
            f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets WHERE id = ?',
            (ticket_id,),
        ).fetchone()
        if not row:
            raise LookupError('Тикет не найден')

        current = {column: row[column] for column in TICKET_COLUMNS}
        actual_version = int(current.get('version') or 1)
        if actual_version != expected_version_int:
            raise VersionConflict(expected_version_int, actual_version)

        if str(current.get('reo_status') or '') == 'sent' and not confirm_reo_sent:
            raise ReoSentConfirmRequired()

        now = _now_iso()
        revisions: list[dict[str, Any]] = []
        set_parts: list[str] = []
        values: list[Any] = []

        for field in ARCHIVE_EDITABLE_FIELDS:
            if field not in ticket_patch:
                continue
            new_value = ticket_patch[field]
            old_value = current.get(field)
            if _stringify_revision_value(old_value) == _stringify_revision_value(new_value):
                continue
            set_parts.append(f'{field} = ?')
            values.append(new_value)
            revision = {
                'id': str(uuid.uuid4()),
                'ticket_id': ticket_id,
                'at': now,
                'operator_id': operator_id,
                'operator_name': operator_name or '',
                'field': field,
                'old_value': _stringify_revision_value(old_value),
                'new_value': _stringify_revision_value(new_value),
            }
            revisions.append(revision)
            connection.execute(
                f'''
                INSERT INTO ticket_revisions ({", ".join(['id', 'ticket_id', 'at', 'operator_id', 'operator_name', 'field', 'old_value', 'new_value'])})
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    revision['id'],
                    revision['ticket_id'],
                    revision['at'],
                    revision['operator_id'],
                    revision['operator_name'],
                    revision['field'],
                    revision['old_value'],
                    revision['new_value'],
                ),
            )

        new_version = actual_version + 1
        set_parts.append('version = ?')
        values.append(new_version)
        values.append(ticket_id)

        if set_parts:
            connection.execute(
                f'UPDATE weighing_tickets SET {", ".join(set_parts)} WHERE id = ?',
                values,
            )

        connection.execute(
            '''
            INSERT INTO ticket_audit (id, ticket_id, action, at, operator_name, operator_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (
                str(uuid.uuid4()),
                ticket_id,
                'updated',
                now,
                operator_name or '',
                operator_id,
            ),
        )

        updated_row = connection.execute(
            f'SELECT {", ".join(TICKET_COLUMNS)} FROM weighing_tickets WHERE id = ?',
            (ticket_id,),
        ).fetchone()
        ticket = {column: updated_row[column] for column in TICKET_COLUMNS}
        ticket['auto_closed'] = bool(ticket.get('auto_closed'))

    return {'ticket': ticket, 'revisions': revisions}
