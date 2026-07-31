"""Stage-6 year rotation services."""

from __future__ import annotations

import os
import sqlite3
from hashlib import sha256
from datetime import datetime
from typing import Any

from persistence import (
    create_database_backup,
    create_tmp_copy_from_legacy,
    get_sqlite_path,
    get_year_database_path,
    publish_tmp_database,
    read_rotation_lock,
    read_active_year,
    remove_rotation_lock,
    rotation_lock_is_stale,
    write_rotation_lock,
    write_active_year,
)
from sqlite_store import (
    apply_auto_close_plan,
    backfill_stage6_audit_columns,
    copy_whitelist_data,
    assert_no_forbidden_runtime_keys,
    init_schema,
    count_stage6_tables,
    load_rotation_preview,
    migrate_schema_stage_6,
    read_ticket_year_range,
    validate_new_year_database,
    validate_stage6_database,
)
from stage6_logging import log_stage6_event
from year_context import (
    RotationContractError,
    resolve_active_context,
    resolve_migration_year,
    resolve_rotation_context,
)

STUB_PREVIEW_TOKEN = "stage6-preview-token"

# Explicit test-only hooks for fail/retry and parallel-lock injection.
# Production code never registers callbacks; tests use set_rotation_test_hook().
_ROTATION_TEST_HOOKS: dict[str, Any] = {}


def set_rotation_test_hook(name: str, callback: Any | None) -> None:
    """
    Register or clear an explicit rotation test hook.

    Supported names:
    - ``after_backup`` — after backup phase, before tmp rebuild
    - ``after_tmp_ready`` — after target ``.tmp`` is built/validated
    - ``after_lock_acquired`` — right after commit lock is written
    - ``after_whitelist_copy`` — after whitelist copy into tmp (before assert)

    Args:
        name: Hook identifier.
        callback: Callable invoked with keyword context, or None to clear.
    """
    if callback is None:
        _ROTATION_TEST_HOOKS.pop(name, None)
        return
    _ROTATION_TEST_HOOKS[name] = callback


def clear_rotation_test_hooks() -> None:
    """Remove all rotation test hooks."""
    _ROTATION_TEST_HOOKS.clear()


def _run_rotation_test_hook(name: str, **context: Any) -> None:
    """Invoke a registered test hook when present."""
    callback = _ROTATION_TEST_HOOKS.get(name)
    if callable(callback):
        callback(**context)


def _actor_fields(actor: dict[str, Any] | None) -> dict[str, Any]:
    """Extract operator id/name for structured logs."""
    if not isinstance(actor, dict):
        return {}
    name = (
        actor.get('display_name')
        or actor.get('username')
        or actor.get('name')
        or actor.get('operator_name')
    )
    return {
        'operator_id': actor.get('id') or actor.get('operator_id'),
        'operator_name': name,
    }


def _lock_path() -> str:
    from persistence import get_rotation_lock_path

    return get_rotation_lock_path()


def detect_mixed_legacy_warning(db_path: str, archive_year: int) -> dict[str, Any] | None:
    """
    Detect mixed legacy years inside one archive container.

    Args:
        db_path: Path to migrated stage-6 database.
        archive_year: Year inferred from yearly file name.

    Returns:
        Warning payload for archive UI, or None when years match.
    """
    if not os.path.isfile(db_path):
        return None
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        year_range = read_ticket_year_range(connection)
    years = year_range.get('years', [])
    if not years:
        return None
    if any(int(year) != int(archive_year) for year in years):
        return {
            'code': 'mixed_legacy_year_mismatch',
            'archive_year': int(archive_year),
            'ticket_years': years,
            'message': (
                'В legacy-базе обнаружены тикеты за другие календарные годы; '
                'данные оставлены в одном архивном контейнере года миграции.'
            ),
        }
    return None


def _try_resume_published_target(migration_year: int, target_path: str) -> dict[str, Any] | None:
    """Resume migration if DB is already published but active_year was not saved."""
    if not os.path.isfile(target_path):
        return None
    try:
        with sqlite3.connect(target_path) as connection:
            connection.row_factory = sqlite3.Row
            validation = validate_stage6_database(connection)
    except sqlite3.DatabaseError:
        return None
    if not validation.get('valid'):
        return None
    write_active_year(migration_year)
    return {
        'status': 'resumed_after_publish',
        'migration_year': migration_year,
        'active_db_path': target_path,
        'backup_path': None,
        'warning': detect_mixed_legacy_warning(target_path, migration_year),
    }


def migrate_legacy_database(now: datetime | None = None) -> dict[str, Any]:
    """
    Migrate legacy `BD/weighing.db` into yearly stage-6 database.

    The migration is copy-on-write: source file is never modified in place.
    """
    current_time = now or datetime.now()
    source_path = get_sqlite_path()
    if not os.path.isfile(source_path):
        log_stage6_event(
            'primary_migration',
            'error',
            db_path=source_path,
            reason='legacy_database_not_found',
        )
        return {
            'status': 'error',
            'code': 'legacy_database_not_found',
            'message': f'Legacy database is missing: {source_path}',
            'migration_year': None,
            'active_db_path': None,
            'backup_path': None,
            'warning': None,
        }

    migration_year = resolve_migration_year(current_time)
    target_path = get_year_database_path(migration_year)
    log_stage6_event(
        'primary_migration',
        'start',
        source_year=migration_year,
        target_year=migration_year,
        db_path=source_path,
    )
    if os.path.isfile(target_path):
        log_stage6_event(
            'primary_migration',
            'error',
            source_year=migration_year,
            target_year=migration_year,
            db_path=target_path,
            reason='migration_target_exists',
        )
        return {
            'status': 'error',
            'code': 'migration_target_exists',
            'message': f'Target yearly database already exists: {target_path}',
            'migration_year': migration_year,
            'active_db_path': target_path,
            'backup_path': None,
            'warning': None,
        }

    tmp_path = f'{target_path}.tmp'
    backup_path: str | None = None
    try:
        backup_path = create_database_backup(source_path, 'legacy-before-stage6')
        log_stage6_event(
            'primary_migration_backup',
            'success',
            source_year=migration_year,
            target_year=migration_year,
            db_path=source_path,
            backup_path=backup_path,
        )
        create_tmp_copy_from_legacy(source_path, tmp_path)

        with sqlite3.connect(source_path) as source_conn:
            source_conn.row_factory = sqlite3.Row
            source_counts = count_stage6_tables(source_conn)

        with sqlite3.connect(tmp_path) as tmp_conn:
            tmp_conn.row_factory = sqlite3.Row
            tmp_conn.execute('BEGIN IMMEDIATE')
            migrate_schema_stage_6(tmp_conn)
            backfill_stage6_audit_columns(tmp_conn, migration_year)
            validation = validate_stage6_database(tmp_conn)
            if not validation.get('valid'):
                raise RuntimeError(f'Stage-6 validation failed: {validation}')
            target_counts = count_stage6_tables(tmp_conn)
            tmp_conn.commit()

        if source_counts != target_counts:
            raise RuntimeError(
                f'Row count mismatch after migration: source={source_counts}, target={target_counts}'
            )

        warning = detect_mixed_legacy_warning(tmp_path, migration_year)
        try:
            publish_tmp_database(tmp_path, target_path)
        except Exception as publish_error:
            log_stage6_event(
                'primary_migration',
                'error',
                source_year=migration_year,
                target_year=migration_year,
                db_path=target_path,
                backup_path=backup_path,
                reason='publish_failed',
                error=str(publish_error),
            )
            raise
        try:
            write_active_year(migration_year)
        except Exception as config_error:
            log_stage6_event(
                'primary_migration',
                'error',
                source_year=migration_year,
                target_year=migration_year,
                db_path=target_path,
                backup_path=backup_path,
                reason='config_update_failed',
                error=str(config_error),
            )
            raise
        log_stage6_event(
            'primary_migration',
            'success',
            source_year=migration_year,
            target_year=migration_year,
            db_path=target_path,
            backup_path=backup_path,
            reason=warning.get('code') if isinstance(warning, dict) else None,
        )
        return {
            'status': 'migrated',
            'migration_year': migration_year,
            'active_db_path': target_path,
            'backup_path': backup_path,
            'warning': warning,
        }
    except Exception as error:
        if os.path.isfile(tmp_path):
            os.unlink(tmp_path)
        log_stage6_event(
            'primary_migration',
            'error',
            source_year=migration_year,
            target_year=migration_year,
            db_path=target_path,
            backup_path=backup_path,
            reason='migration_failed',
            error=str(error),
        )
        return {
            'status': 'error',
            'code': 'migration_failed',
            'message': str(error),
            'migration_year': migration_year,
            'active_db_path': target_path,
            'backup_path': backup_path,
            'warning': None,
        }


def ensure_stage6_storage_bootstrap(now: datetime | None = None) -> dict[str, Any]:
    """
    Ensure legacy storage is migrated to yearly stage-6 layout.

    Migration is required only when legacy DB exists and active_year is absent.
    """
    current_time = now or datetime.now()
    active_year = read_active_year()
    source_path = get_sqlite_path()

    if active_year is not None:
        active_path = get_year_database_path(active_year)
        return {
            'status': 'ready',
            'migration_year': active_year,
            'active_db_path': active_path,
            'backup_path': None,
            'warning': detect_mixed_legacy_warning(active_path, active_year),
        }

    if not os.path.isfile(source_path):
        return {
            'status': 'ready',
            'migration_year': None,
            'active_db_path': source_path,
            'backup_path': None,
            'warning': None,
        }

    migration_year = resolve_migration_year(current_time)
    target_path = get_year_database_path(migration_year)
    resumed = _try_resume_published_target(migration_year, target_path)
    if resumed is not None:
        log_stage6_event(
            'primary_migration',
            'success',
            source_year=migration_year,
            target_year=migration_year,
            db_path=target_path,
            backup_path=resumed.get('backup_path'),
            reason='resumed_after_publish',
        )
        return resumed
    return migrate_legacy_database(current_time)


def _parse_tara_default() -> float | None:
    """Read numeric `tara_default` from config.ini."""
    from persistence import read_config

    config = read_config()
    raw = config.get('tara_default')
    if raw in (None, ''):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _calculate_ticket_totals(
    *,
    gross_weight: float | None,
    tare_weight: float | None,
    price: float | None,
    vat_rate: float | None,
) -> tuple[float | None, float | None]:
    """Calculate net and total values for preview/commit output."""
    if gross_weight is None or tare_weight is None:
        return None, None
    net_weight = float(gross_weight) - float(tare_weight)
    total_amount = round(net_weight * float(price or 0) * (1 + float(vat_rate or 0) / 100), 2)
    return net_weight, total_amount


def _build_preview_token(
    source_year: int,
    target_year: int,
    source_db_fingerprint: str,
    open_candidates: list[dict[str, Any]],
    blocking_tickets: list[dict[str, Any]],
    pending_reo_count: int,
) -> str:
    """Build deterministic preview token bound to source DB fingerprint and plan."""
    payload = {
        'source_year': int(source_year),
        'target_year': int(target_year),
        'source_db_fingerprint': source_db_fingerprint,
        'open_candidates': open_candidates,
        'blocking_tickets': blocking_tickets,
        'pending_reo_count': int(pending_reo_count),
    }
    digest = sha256(str(payload).encode('utf-8')).hexdigest()[:12]
    return f'rotprev_{source_year}_{target_year}_{digest}'


def build_rotation_preview(now: datetime, actor: dict[str, Any]) -> dict[str, Any]:
    """Build canonical stage-6 preview without writing to databases."""
    actor_ctx = _actor_fields(actor)
    log_stage6_event('rotation_preview', 'start', **actor_ctx)
    context = resolve_rotation_context(None, None, now)
    sqlite_preview = load_rotation_preview(
        context.source_db_path,
        context.source_year,
        context.target_year,
    )
    tare_default = _parse_tara_default()

    open_candidates: list[dict[str, Any]] = []
    blocking_tickets: list[dict[str, Any]] = []
    for candidate in sqlite_preview.get('open_candidates', []):
        tare_weight = candidate.get('tare_from_dictionary')
        tare_source = 'dictionary'
        if tare_weight is None and tare_default is not None:
            tare_weight = tare_default
            tare_source = 'default'

        net_weight, total_amount = _calculate_ticket_totals(
            gross_weight=candidate.get('gross_weight'),
            tare_weight=tare_weight,
            price=candidate.get('price'),
            vat_rate=candidate.get('vat_rate'),
        )
        if tare_weight is None:
            blocking_tickets.append(
                {
                    'ticket_id': candidate.get('ticket_id'),
                    'ticket_number': candidate.get('ticket_number'),
                    'vehicle_number': candidate.get('vehicle_number'),
                    'reason': 'missing_tare_dictionary_and_default',
                }
            )
            continue

        open_candidates.append(
            {
                'ticket_id': candidate.get('ticket_id'),
                'ticket_number': candidate.get('ticket_number'),
                'vehicle_number': candidate.get('vehicle_number'),
                'tare_weight': tare_weight,
                'tare_source': tare_source,
                'gross_weight': candidate.get('gross_weight'),
                'net_weight': net_weight,
                'total_amount': total_amount,
                'status': 'completed',
                'auto_closed': True,
                'source_year': context.source_year,
            }
        )

    pending_reo_count = int(sqlite_preview.get('pending_reo_count', 0))
    source_db_fingerprint = str(sqlite_preview.get('source_db_fingerprint') or '')
    preview_token = _build_preview_token(
        context.source_year,
        context.target_year,
        source_db_fingerprint,
        open_candidates,
        blocking_tickets,
        pending_reo_count,
    )
    result = {
        'success': True,
        'source_year': context.source_year,
        'target_year': context.target_year,
        'source_db_path': context.source_db_path,
        'target_db_path': context.target_db_path,
        'source_db_fingerprint': source_db_fingerprint,
        'preview_token': preview_token,
        'open_candidates': open_candidates,
        'blocking_tickets': blocking_tickets,
        'pending_reo_count': pending_reo_count,
        'rotation_required': context.target_year > context.source_year,
    }
    log_stage6_event(
        'rotation_preview',
        'success',
        source_year=context.source_year,
        target_year=context.target_year,
        db_path=context.source_db_path,
        open_count=len(open_candidates) + len(blocking_tickets),
        pending_reo_count=pending_reo_count,
        blocking_count=len(blocking_tickets),
        **actor_ctx,
    )
    return result


def recover_rotation_if_needed(now: datetime) -> dict[str, Any]:
    """
    Recover stale lock by choosing `resume_tmp` or `rebuild_target`.

    Fresh lock is not changed and returns `mode=in_progress`.
    """
    lock_payload = read_rotation_lock()
    if lock_payload is None:
        return {'mode': 'none', 'lock_present': False}
    if not rotation_lock_is_stale(lock_payload, now):
        return {'mode': 'in_progress', 'lock_present': True, 'lock': lock_payload}

    tmp_db_path = str(lock_payload.get('tmp_db_path') or '')
    mode = 'rebuild_target'
    if tmp_db_path and os.path.isfile(tmp_db_path):
        try:
            with sqlite3.connect(tmp_db_path) as target_conn:
                target_conn.row_factory = sqlite3.Row
                validation = validate_new_year_database(target_conn)
            if validation.get('valid'):
                mode = 'resume_tmp'
            else:
                os.unlink(tmp_db_path)
        except Exception:
            if os.path.isfile(tmp_db_path):
                os.unlink(tmp_db_path)
            mode = 'rebuild_target'

    remove_rotation_lock()
    recovered = dict(lock_payload)
    recovered['phase'] = 'started'
    recovered['recovery_mode'] = mode
    recovered['started_at'] = now.isoformat().replace('+00:00', 'Z')
    write_rotation_lock(recovered)
    log_stage6_event(
        'rotation_stale_recovery',
        'success',
        source_year=recovered.get('source_year'),
        target_year=recovered.get('target_year'),
        lock_path=_lock_path(),
        lock_phase=recovered.get('phase'),
        reason=mode,
        recovery_mode=mode,
        db_path=tmp_db_path or None,
        backup_path=recovered.get('backup_path'),
    )
    return {
        'mode': mode,
        'lock_present': True,
        'lock': recovered,
    }


def _build_lock_payload(preview: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Build canonical lock payload from preview state."""
    return {
        'source_year': int(preview['source_year']),
        'target_year': int(preview['target_year']),
        'preview_token': str(preview['preview_token']),
        'source_db_fingerprint': str(preview['source_db_fingerprint']),
        'started_at': now.isoformat().replace('+00:00', 'Z'),
        'phase': 'started',
        'recovery_mode': 'none',
        'backup_path': None,
        'tmp_db_path': f"{preview['target_db_path']}.tmp",
        'lock_ttl_seconds': 15 * 60,
    }


def _rebuild_target_database(source_db_path: str, tmp_db_path: str) -> dict[str, int]:
    """Build fresh target DB from whitelist entities."""
    if os.path.isfile(tmp_db_path):
        os.unlink(tmp_db_path)
    with sqlite3.connect(source_db_path) as source_conn:
        source_conn.row_factory = sqlite3.Row
        with sqlite3.connect(tmp_db_path) as target_conn:
            target_conn.row_factory = sqlite3.Row
            init_schema(target_conn)
            copied = copy_whitelist_data(source_conn, target_conn)
            _run_rotation_test_hook(
                'after_whitelist_copy',
                source_db_path=source_db_path,
                tmp_db_path=tmp_db_path,
                target_conn=target_conn,
            )
            assert_no_forbidden_runtime_keys(target_conn)
            validation = validate_new_year_database(target_conn)
            if not validation.get('valid'):
                raise RuntimeError(f'Target validation failed: {validation}')
            target_conn.commit()
    return copied


def commit_year_rotation(
    preview_token: str,
    acknowledge_pending_reo: bool,
    actor: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    """Commit stage-6 rotation under lock, backup, tmp build and publish."""
    actor_ctx = _actor_fields(actor)
    log_stage6_event('rotation_commit', 'start', **actor_ctx)
    recovery = recover_rotation_if_needed(now)
    if recovery.get('mode') == 'in_progress':
        log_stage6_event(
            'rotation_commit',
            'error',
            lock_path=_lock_path(),
            lock_phase='in_progress',
            reason='rotation_in_progress',
            **actor_ctx,
        )
        raise RotationContractError(
            'rotation_in_progress',
            'Ротация уже выполняется в другой сессии',
            409,
        )

    preview = build_rotation_preview(now, actor)
    if str(preview.get('preview_token')) != str(preview_token):
        log_stage6_event(
            'rotation_commit',
            'error',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            reason='rotation_preview_stale',
            **actor_ctx,
        )
        raise RotationContractError(
            'rotation_preview_stale',
            'Preview устарел; требуется заново запросить preview перед commit',
            409,
        )
    if preview.get('blocking_tickets'):
        log_stage6_event(
            'rotation_commit',
            'error',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            open_count=len(preview.get('open_candidates', [])) + len(preview.get('blocking_tickets', [])),
            pending_reo_count=preview.get('pending_reo_count'),
            reason='blocking_tickets',
            **actor_ctx,
        )
        raise RotationContractError(
            'rotation_failed',
            'Есть блокирующие open-тикеты без тары; ротация невозможна',
            500,
        )
    if preview.get('pending_reo_count', 0) > 0 and not acknowledge_pending_reo:
        log_stage6_event(
            'rotation_commit',
            'error',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            pending_reo_count=preview.get('pending_reo_count'),
            reason='pending_reo_ack_required',
            **actor_ctx,
        )
        raise RotationContractError(
            'rotation_failed',
            'Нужно подтвердить продолжение при наличии pending РЭО',
            500,
        )

    lock_payload = _build_lock_payload(preview, now)
    if recovery.get('mode') in ('resume_tmp', 'rebuild_target'):
        # recover_rotation_if_needed already holds a refreshed lock; replace it.
        lock_payload['recovery_mode'] = recovery['mode']
        if recovery.get('lock', {}).get('backup_path'):
            lock_payload['backup_path'] = recovery['lock'].get('backup_path')
        if recovery.get('lock', {}).get('tmp_db_path'):
            lock_payload['tmp_db_path'] = recovery['lock'].get('tmp_db_path')
        remove_rotation_lock()
    try:
        write_rotation_lock(lock_payload)
    except FileExistsError as exc:
        log_stage6_event(
            'rotation_commit',
            'error',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            lock_path=_lock_path(),
            reason='rotation_in_progress',
            **actor_ctx,
        )
        raise RotationContractError(
            'rotation_in_progress',
            'Ротация уже выполняется в другой сессии',
            409,
        ) from exc

    log_stage6_event(
        'rotation_lock',
        'acquired',
        source_year=preview.get('source_year'),
        target_year=preview.get('target_year'),
        lock_path=_lock_path(),
        lock_phase=lock_payload.get('phase'),
        reason=recovery.get('mode', 'none'),
        **actor_ctx,
    )
    _run_rotation_test_hook(
        'after_lock_acquired',
        source_year=preview.get('source_year'),
        target_year=preview.get('target_year'),
        lock_path=_lock_path(),
    )

    source_db_path = str(preview['source_db_path'])
    target_db_path = str(preview['target_db_path'])
    tmp_db_path = str(lock_payload.get('tmp_db_path') or f'{target_db_path}.tmp')
    backup_path: str | None = lock_payload.get('backup_path')
    copied_counts: dict[str, int] = {}
    completed = False
    try:
        with sqlite3.connect(source_db_path) as source_conn:
            source_conn.row_factory = sqlite3.Row
            source_conn.execute('BEGIN IMMEDIATE')
            auto_close_plan = [
                {**item, 'actor_name': 'system', 'actor_id': None}
                for item in preview.get('open_candidates', [])
            ]
            apply_result = apply_auto_close_plan(source_conn, auto_close_plan)
            source_conn.execute('DELETE FROM app_sessions')
            source_conn.commit()

        lock_payload['phase'] = 'source_committed'
        remove_rotation_lock()
        write_rotation_lock(lock_payload)

        if not backup_path or not os.path.isfile(str(backup_path)):
            backup_path = create_database_backup(
                source_db_path,
                f"before-rotation-{preview['target_year']}",
            )
        lock_payload['backup_path'] = backup_path
        lock_payload['phase'] = 'backup_done'
        remove_rotation_lock()
        write_rotation_lock(lock_payload)
        log_stage6_event(
            'rotation_backup',
            'success',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            db_path=source_db_path,
            backup_path=backup_path,
            lock_path=_lock_path(),
            lock_phase='backup_done',
            auto_closed_count=int(apply_result.get('auto_closed_count', 0)),
            open_count=len(preview.get('open_candidates', [])),
            pending_reo_count=preview.get('pending_reo_count'),
            **actor_ctx,
        )
        _run_rotation_test_hook(
            'after_backup',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            backup_path=backup_path,
            tmp_db_path=tmp_db_path,
        )

        if recovery.get('mode') == 'resume_tmp' and os.path.isfile(tmp_db_path):
            with sqlite3.connect(tmp_db_path) as target_conn:
                target_conn.row_factory = sqlite3.Row
                validation = validate_new_year_database(target_conn)
            if not validation.get('valid'):
                copied_counts = _rebuild_target_database(source_db_path, tmp_db_path)
            else:
                copied_counts = {}
        else:
            copied_counts = _rebuild_target_database(source_db_path, tmp_db_path)

        lock_payload['phase'] = 'tmp_ready'
        lock_payload['tmp_db_path'] = tmp_db_path
        remove_rotation_lock()
        write_rotation_lock(lock_payload)
        _run_rotation_test_hook(
            'after_tmp_ready',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            backup_path=backup_path,
            tmp_db_path=tmp_db_path,
        )

        try:
            publish_tmp_database(tmp_db_path, target_db_path)
        except Exception as publish_error:
            log_stage6_event(
                'rotation_commit',
                'error',
                source_year=preview.get('source_year'),
                target_year=preview.get('target_year'),
                db_path=target_db_path,
                backup_path=backup_path,
                lock_path=_lock_path(),
                lock_phase='publish_failed',
                reason='publish_failed',
                error=str(publish_error),
                **actor_ctx,
            )
            raise
        try:
            write_active_year(int(preview['target_year']))
        except Exception as config_error:
            log_stage6_event(
                'rotation_commit',
                'error',
                source_year=preview.get('source_year'),
                target_year=preview.get('target_year'),
                db_path=target_db_path,
                backup_path=backup_path,
                lock_path=_lock_path(),
                lock_phase='config_update_failed',
                reason='config_update_failed',
                error=str(config_error),
                **actor_ctx,
            )
            raise
        lock_payload['phase'] = 'published'
        remove_rotation_lock()
        completed = True
        result = {
            'success': True,
            'source_year': preview['source_year'],
            'target_year': preview['target_year'],
            'auto_closed_count': int(apply_result.get('auto_closed_count', 0)),
            'backup_path': backup_path or '',
            'new_db_path': target_db_path,
            'recovery': {
                'mode': recovery.get('mode', 'none'),
                'copied_counts': copied_counts,
            },
        }
        log_stage6_event(
            'rotation_commit',
            'success',
            source_year=result['source_year'],
            target_year=result['target_year'],
            db_path=target_db_path,
            backup_path=backup_path,
            auto_closed_count=result['auto_closed_count'],
            open_count=len(preview.get('open_candidates', [])),
            pending_reo_count=preview.get('pending_reo_count'),
            lock_path=_lock_path(),
            lock_phase='published',
            reason=recovery.get('mode', 'none'),
            **actor_ctx,
        )
        return result
    except RotationContractError:
        raise
    except Exception as exc:
        log_stage6_event(
            'rotation_commit',
            'error',
            source_year=preview.get('source_year'),
            target_year=preview.get('target_year'),
            db_path=target_db_path,
            backup_path=backup_path,
            lock_path=_lock_path(),
            lock_phase=lock_payload.get('phase'),
            reason='rotation_failed',
            error=str(exc),
            **actor_ctx,
        )
        raise RotationContractError(
            'rotation_failed',
            f'Ротация не завершена; active_year не переключён: {exc}',
            500,
        ) from exc
    finally:
        if completed:
            try:
                remove_rotation_lock()
            except OSError:
                pass


def preview_rotation(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """HTTP wrapper for rotation preview contract."""
    body = payload or {}
    now = datetime.now()
    context = resolve_rotation_context(
        body.get('source_year'),
        body.get('target_year'),
        now,
    )
    actor = body.get('actor') if isinstance(body.get('actor'), dict) else {'id': None, 'name': 'system'}
    preview = build_rotation_preview(now, actor=actor)
    preview['source_year'] = context.source_year
    preview['target_year'] = context.target_year
    return preview


def commit_rotation(payload: dict[str, Any]) -> dict[str, Any]:
    """HTTP wrapper for rotation commit contract."""
    now = datetime.now()
    resolve_rotation_context(payload.get('source_year'), payload.get('target_year'), now)
    preview_token = str(payload.get('preview_token') or '').strip()
    if not preview_token:
        raise RotationContractError(
            'rotation_preview_stale',
            'Preview токен обязателен для commit ротации',
            409,
        )
    actor = payload.get('actor') if isinstance(payload.get('actor'), dict) else {'id': None, 'name': 'system'}
    return commit_year_rotation(
        preview_token=preview_token,
        acknowledge_pending_reo=bool(payload.get('acknowledge_pending_reo', False)),
        actor=actor,
        now=now,
    )
