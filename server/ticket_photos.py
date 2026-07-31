"""Ticket photo metadata: upsert, stubs recompute (F-08), phase capture orchestration."""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import sqlite_store
from camera_logging import log_capture_result, log_capture_start, log_photo_io_error
from cameras import CameraCaptureService, CaptureResult, mask_url
from photo_storage import PhotoStorage
from year_context import assert_active_db_write_allowed, resolve_active_context

logger = logging.getLogger(__name__)

_MAX_CAPTURE_WORKERS = 4
_VALID_EVENTS = frozenset({'gross', 'tare'})


@dataclass
class CapturePersistInput:
    """
    Per-camera capture outcome ready for sequential persist.

    Attributes:
        camera_id: Camera UUID from registry.
        camera_role: ``entry`` / ``exit`` / ``overview``.
        status: ``success`` or ``failed``.
        jpeg_bytes: JPEG payload on success; ``None`` on failure.
        error_code: Typed error when failed; ``None`` on success.
        captured_at: ISO timestamp of this attempt.
    """

    camera_id: str
    camera_role: str
    status: str
    jpeg_bytes: bytes | None
    error_code: str | None
    captured_at: str


def _now_iso() -> str:
    """Return local ISO datetime without microseconds."""
    return datetime.now().replace(microsecond=0).isoformat()


def _new_capture_token() -> str:
    """Opaque capture-merge marker for client post-capture flush."""
    return uuid.uuid4().hex


def _active_db_path() -> str:
    """Resolve active-year (or legacy) SQLite path."""
    return resolve_active_context().db_path


def _is_truthy_ini(value: str | None) -> bool:
    """Parse config.ini boolean-like string (``true``/``1``/``yes``)."""
    return str(value or '').strip().lower() in ('1', 'true', 'yes', 'on')


class TicketPhotosService:
    """
    Upsert ``ticket_photos`` rows, recompute ``photo_*`` stubs (F-08), and
    enforce failed-does-not-wipe-success replace policy.
    """

    def __init__(
        self,
        photo_storage: PhotoStorage | None = None,
        capture_service: CameraCaptureService | None = None,
    ) -> None:
        self._photos = photo_storage or PhotoStorage()
        self._capture = capture_service or CameraCaptureService()

    def ticket_exists(self, ticket_id: str) -> bool:
        """
        Return True when ``ticket_id`` exists in active-year ``weighing_tickets``.

        Args:
            ticket_id: Weighing ticket id.

        Returns:
            Whether the ticket row is present.
        """
        if not ticket_id:
            return False
        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)
            row = connection.execute(
                'SELECT 1 FROM weighing_tickets WHERE id = ? LIMIT 1',
                (ticket_id,),
            ).fetchone()
        return row is not None

    def list_enabled_cameras(self, site_id: str | None = None) -> list[dict[str, Any]]:
        """
        Load enabled cameras from SQLite ``cameras`` (``enabled=1``).

        Args:
            site_id: Optional site filter; when set, only that site's cameras.

        Returns:
            Camera rows ordered by ``sort_order``, ``created_at``.
        """
        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)
            if site_id:
                rows = connection.execute(
                    f'''
                    SELECT {", ".join(sqlite_store.CAMERA_COLUMNS)}
                    FROM cameras
                    WHERE enabled = 1 AND site_id = ?
                    ORDER BY sort_order ASC, created_at ASC
                    ''',
                    (site_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    f'''
                    SELECT {", ".join(sqlite_store.CAMERA_COLUMNS)}
                    FROM cameras
                    WHERE enabled = 1
                    ORDER BY sort_order ASC, created_at ASC
                    '''
                ).fetchall()
        return [
            {column: row[column] for column in sqlite_store.CAMERA_COLUMNS}
            for row in rows
        ]

    def get_ticket_site_id(self, ticket_id: str) -> str | None:
        """Return ``site_id`` of the ticket, or ``None`` if missing."""
        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)
            row = connection.execute(
                'SELECT site_id FROM weighing_tickets WHERE id = ? LIMIT 1',
                (ticket_id,),
            ).fetchone()
        if row is None:
            return None
        value = row['site_id']
        return str(value) if value else None

    def resolve_camera_mode(self, site_id: str | None) -> str | None:
        """
        Resolve runtime ``camera_mode`` from ``site_runtime`` for ``site_id``.

        Returns:
            ``primary`` / ``spare`` or ``None`` when unknown.
        """
        if not site_id:
            return None
        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)
            row = connection.execute(
                'SELECT camera_mode FROM site_runtime WHERE site_id = ? LIMIT 1',
                (site_id,),
            ).fetchone()
        if row is None:
            return None
        mode = str(row['camera_mode'] or '').strip()
        return mode if mode in ('primary', 'spare') else None

    def recompute_stubs(self, ticket_id: str) -> tuple[str | None, str | None]:
        """
        Recompute ``photo_entry_path`` / ``photo_exit_path`` from success rows (F-08).

        For each role ``entry`` / ``exit``, pick the success row with the latest
        ``captured_at`` (uses ``idx_ticket_photos_stub``).

        Args:
            ticket_id: Weighing ticket id.

        Returns:
            ``(photo_entry_path, photo_exit_path)`` — ``None`` when no success.
        """
        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)
            return self._recompute_stubs_on_connection(connection, ticket_id)

    def _recompute_stubs_on_connection(
        self,
        connection: Any,
        ticket_id: str,
    ) -> tuple[str | None, str | None]:
        """F-08 stub recompute on an open connection."""
        entry_path: str | None = None
        exit_path: str | None = None
        for role, target in (('entry', 'entry'), ('exit', 'exit')):
            row = connection.execute(
                '''
                SELECT file_path
                FROM ticket_photos
                WHERE ticket_id = ?
                  AND camera_role = ?
                  AND status = 'success'
                  AND file_path IS NOT NULL
                ORDER BY captured_at DESC
                LIMIT 1
                ''',
                (ticket_id, role),
            ).fetchone()
            if row and row['file_path']:
                if target == 'entry':
                    entry_path = str(row['file_path'])
                else:
                    exit_path = str(row['file_path'])
        return entry_path, exit_path

    def list_ticket_photos(self, ticket_id: str) -> list[dict[str, Any]]:
        """
        Load ``ticket_photos`` rows for a single ticket (capture response scope).

        Args:
            ticket_id: Weighing ticket id.

        Returns:
            Metadata rows ordered by ``captured_at``.
        """
        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)
            return self._list_ticket_photos_on_connection(connection, ticket_id)

    def _list_ticket_photos_on_connection(
        self,
        connection: Any,
        ticket_id: str,
    ) -> list[dict[str, Any]]:
        """Load ticket_photos for one ticket on an open connection."""
        rows = connection.execute(
            f'''
            SELECT {", ".join(sqlite_store.TICKET_PHOTO_COLUMNS)}
            FROM ticket_photos
            WHERE ticket_id = ?
            ORDER BY captured_at ASC
            ''',
            (ticket_id,),
        ).fetchall()
        return [
            {column: row[column] for column in sqlite_store.TICKET_PHOTO_COLUMNS}
            for row in rows
        ]

    def _apply_stubs_to_ticket(
        self,
        connection: Any,
        ticket_id: str,
        entry_path: str | None,
        exit_path: str | None,
    ) -> None:
        """
        Write F-08 stubs onto ``weighing_tickets``.

        Preserve-non-null: a ``null`` recompute result does not overwrite an
        existing non-null stub (failed-does-not-wipe-success defense).
        """
        row = connection.execute(
            '''
            SELECT photo_entry_path, photo_exit_path
            FROM weighing_tickets
            WHERE id = ?
            ''',
            (ticket_id,),
        ).fetchone()
        if row is None:
            return
        prev_entry = row['photo_entry_path']
        prev_exit = row['photo_exit_path']
        new_entry = entry_path if entry_path is not None else prev_entry
        new_exit = exit_path if exit_path is not None else prev_exit
        connection.execute(
            '''
            UPDATE weighing_tickets
            SET photo_entry_path = ?, photo_exit_path = ?
            WHERE id = ?
            ''',
            (new_entry, new_exit, ticket_id),
        )

    def replace_capture(
        self,
        ticket_id: str,
        event: str,
        per_camera_results: list[CapturePersistInput] | list[dict[str, Any]],
        camera_mode: str | None = None,
    ) -> dict[str, Any]:
        """
        Persist per-camera capture results and recompute stubs (architecture §5.2).

        Algorithm per camera (UNIQUE ``ticket_id, camera_id, event``):
        1. Find previous row.
        2. New success: write JPEG → upsert success → unlink old file if path
           changed → recompute stubs.
        3. New failed after previous success: keep success row/file/stubs; log.
        4. New failed without previous success: upsert failed, ``file_path=null``.

        Args:
            ticket_id: Weighing ticket id (must already exist).
            event: ``gross`` or ``tare``.
            per_camera_results: Capture outcomes (``CapturePersistInput`` or dicts).
            camera_mode: Runtime ``primary``/``spare`` snapshot (nullable).

        Returns:
            Dict with ``results``, ``photo_entry_path``, ``photo_exit_path``,
            ``ticket_photos`` (only this ticket), ``capture_token``.
        """
        inputs = [
            item if isinstance(item, CapturePersistInput) else self._coerce_persist_input(item)
            for item in per_camera_results
        ]
        results: list[dict[str, Any]] = []
        capture_token = _new_capture_token()

        with sqlite_store.connect(db_path=_active_db_path()) as connection:
            sqlite_store.init_schema(connection)

            for item in inputs:
                result_row = self._persist_one_camera(
                    connection,
                    ticket_id=ticket_id,
                    event=event,
                    item=item,
                    camera_mode=camera_mode,
                )
                results.append(result_row)

            entry_path, exit_path = self._recompute_stubs_on_connection(
                connection, ticket_id
            )
            self._apply_stubs_to_ticket(connection, ticket_id, entry_path, exit_path)
            # Re-read stubs after preserve-non-null apply
            stub_row = connection.execute(
                '''
                SELECT photo_entry_path, photo_exit_path
                FROM weighing_tickets WHERE id = ?
                ''',
                (ticket_id,),
            ).fetchone()
            if stub_row is not None:
                entry_path = stub_row['photo_entry_path']
                exit_path = stub_row['photo_exit_path']
            ticket_photos = self._list_ticket_photos_on_connection(connection, ticket_id)

        return {
            'results': results,
            'photo_entry_path': entry_path,
            'photo_exit_path': exit_path,
            'ticket_photos': ticket_photos,
            'capture_token': capture_token,
        }

    @staticmethod
    def _coerce_persist_input(raw: dict[str, Any]) -> CapturePersistInput:
        """Build ``CapturePersistInput`` from a plain dict (tests / callers)."""
        return CapturePersistInput(
            camera_id=str(raw.get('camera_id') or ''),
            camera_role=str(raw.get('camera_role') or 'overview'),
            status=str(raw.get('status') or 'failed'),
            jpeg_bytes=raw.get('jpeg_bytes'),
            error_code=raw.get('error_code'),
            captured_at=str(raw.get('captured_at') or _now_iso()),
        )

    def _persist_one_camera(
        self,
        connection: Any,
        *,
        ticket_id: str,
        event: str,
        item: CapturePersistInput,
        camera_mode: str | None,
    ) -> dict[str, Any]:
        """Apply replace policy for one camera; return API result entry."""
        previous = connection.execute(
            '''
            SELECT id, file_path, status, camera_role, error_code, captured_at, camera_mode
            FROM ticket_photos
            WHERE ticket_id = ? AND camera_id = ? AND event = ?
            LIMIT 1
            ''',
            (ticket_id, item.camera_id, event),
        ).fetchone()

        prev_status = str(previous['status']) if previous else None
        prev_path = previous['file_path'] if previous else None
        row_id = str(previous['id']) if previous else str(uuid.uuid4())

        is_success = item.status == 'success' and bool(item.jpeg_bytes)

        if is_success:
            assert item.jpeg_bytes is not None
            try:
                new_path = self._photos.write_ticket_photo(
                    ticket_id=ticket_id,
                    event=event,
                    camera_id=item.camera_id,
                    role=item.camera_role,
                    captured_at=item.captured_at,
                    jpeg_bytes=item.jpeg_bytes,
                )
            except OSError as exc:
                log_photo_io_error(
                    operation='write_ticket_photo',
                    ticket_id=ticket_id,
                    camera_id=item.camera_id,
                    error=exc,
                    capture_event=event,
                    role=item.camera_role,
                )
                # Fall through to failed-attempt policy below.
                item = CapturePersistInput(
                    camera_id=item.camera_id,
                    camera_role=item.camera_role,
                    status='failed',
                    jpeg_bytes=None,
                    error_code='io_error',
                    captured_at=item.captured_at,
                )
                is_success = False
            else:
                connection.execute(
                    '''
                    INSERT INTO ticket_photos (
                        id, ticket_id, camera_id, camera_role, event,
                        file_path, status, error_code, captured_at, camera_mode
                    ) VALUES (?, ?, ?, ?, ?, ?, 'success', NULL, ?, ?)
                    ON CONFLICT(ticket_id, camera_id, event) DO UPDATE SET
                        camera_role = excluded.camera_role,
                        file_path = excluded.file_path,
                        status = 'success',
                        error_code = NULL,
                        captured_at = excluded.captured_at,
                        camera_mode = excluded.camera_mode
                    ''',
                    (
                        row_id,
                        ticket_id,
                        item.camera_id,
                        item.camera_role,
                        event,
                        new_path,
                        item.captured_at,
                        camera_mode,
                    ),
                )
                # Delete superseded file only when path differs (after new write).
                if prev_path and str(prev_path) != new_path:
                    try:
                        self._photos.safe_unlink(str(prev_path))
                    except ValueError:
                        logger.warning(
                            'Skipped unlink of invalid previous path for ticket=%s camera=%s',
                            ticket_id,
                            item.camera_id,
                        )
                return {
                    'camera_id': item.camera_id,
                    'camera_role': item.camera_role,
                    'status': 'success',
                    'file_path': new_path,
                    'error_code': None,
                }

        # Failed attempt
        error_code = item.error_code or 'unreachable'
        if prev_status == 'success':
            logger.info(
                'Capture failed after success; preserving success row '
                'ticket=%s camera=%s event=%s error=%s',
                ticket_id,
                item.camera_id,
                event,
                error_code,
            )
            return {
                'camera_id': item.camera_id,
                'camera_role': item.camera_role,
                'status': 'failed',
                'file_path': str(prev_path) if prev_path else None,
                'error_code': error_code,
                'preserved_success': True,
            }

        connection.execute(
            '''
            INSERT INTO ticket_photos (
                id, ticket_id, camera_id, camera_role, event,
                file_path, status, error_code, captured_at, camera_mode
            ) VALUES (?, ?, ?, ?, ?, NULL, 'failed', ?, ?, ?)
            ON CONFLICT(ticket_id, camera_id, event) DO UPDATE SET
                camera_role = excluded.camera_role,
                file_path = NULL,
                status = 'failed',
                error_code = excluded.error_code,
                captured_at = excluded.captured_at,
                camera_mode = excluded.camera_mode
            ''',
            (
                row_id,
                ticket_id,
                item.camera_id,
                item.camera_role,
                event,
                error_code,
                item.captured_at,
                camera_mode,
            ),
        )
        return {
            'camera_id': item.camera_id,
            'camera_role': item.camera_role,
            'status': 'failed',
            'file_path': None,
            'error_code': error_code,
        }


def _noop_response() -> dict[str, Any]:
    """Build a successful noop capture payload."""
    return {
        'success': True,
        'noop': True,
        'results': [],
        'ticket_photos': [],
        'photo_entry_path': None,
        'photo_exit_path': None,
        'capture_token': _new_capture_token(),
    }


def run_phase_capture(
    ticket_id: str,
    event: str,
    *,
    service: TicketPhotosService | None = None,
    video_enabled: bool | None = None,
    timeout_sec: float | None = None,
    jpeg_quality: int | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Orchestrate phase capture: noop gates → parallel capture → sequential persist.

    Caller maps returned ``error`` codes to HTTP:
    - ``ticket_not_found`` → 404 (no files written)
    - ``rotation_in_progress`` is raised as ``RotationContractError`` by write-gate
      before this function when caller checks the gate
    - Per-camera failures stay in ``results`` with HTTP 200 ``success: true``

    Args:
        ticket_id: Persisted weighing ticket id.
        event: ``gross`` or ``tare``.
        service: Optional service instance (tests inject mocks/fakes).
        video_enabled: Override for config flag.
        timeout_sec: Per-camera capture timeout override.
        jpeg_quality: JPEG quality override.
        config: Optional pre-loaded config dict (``video_enabled``, timeouts).

    Returns:
        Capture response dict (``success``, ``noop``, ``results``, stubs,
        ``ticket_photos``, ``capture_token``) or ``{'error': code, ...}``.
    """
    svc = service or TicketPhotosService()
    cfg = config or {}

    if video_enabled is None:
        video_enabled = _is_truthy_ini(
            str(cfg.get('video_enabled')) if cfg.get('video_enabled') is not None else None
        )
    if timeout_sec is None:
        try:
            timeout_sec = float(cfg.get('camera_capture_timeout_sec') or 3)
        except (TypeError, ValueError):
            timeout_sec = 3.0
    if jpeg_quality is None:
        try:
            jpeg_quality = int(cfg.get('camera_jpeg_quality') or 80)
        except (TypeError, ValueError):
            jpeg_quality = 80

    # 1) video_enabled=false → noop before ticket check (no orphan files).
    # Basic/OpenCV absence is not a blanket noop: HTTP snapshot cameras still
    # capture; RTSP without cv2 fails per-camera with capability_unavailable.
    if not video_enabled:
        return _noop_response()

    if event not in _VALID_EVENTS:
        return {
            'error': 'invalid_request',
            'message': 'event должен быть gross или tare',
            'http_status': 400,
        }

    if not ticket_id:
        return {
            'error': 'ticket_not_found',
            'message': 'Тикет не найден',
            'http_status': 404,
        }

    if not svc.ticket_exists(ticket_id):
        return {
            'error': 'ticket_not_found',
            'message': 'Тикет не найден в активной базе',
            'http_status': 404,
        }

    site_id = svc.get_ticket_site_id(ticket_id)
    cameras = svc.list_enabled_cameras(site_id=site_id)
    if not cameras and site_id is not None:
        # Ticket site has no enabled cameras — still noop (do not steal other sites).
        return _noop_response()
    if not cameras:
        return _noop_response()

    # Write-gate after noop/ticket checks — same mechanism as write_active_storage.
    assert_active_db_write_allowed(operation='POST /api/cameras/capture')

    camera_mode = svc.resolve_camera_mode(site_id)
    captured_at = _now_iso()

    # 4) Parallel frame capture (ThreadPoolExecutor, max_workers ≤ 4)
    def _capture_one(cam: dict[str, Any]) -> CapturePersistInput:
        role = str(cam.get('role') or 'overview')
        cam_id = str(cam.get('id') or '')
        http_url = str(cam.get('http_snapshot_url') or '').strip()
        rtsp = str(cam.get('rtsp_url') or '').strip()
        target_url = http_url or rtsp or None
        masked = mask_url(target_url) if target_url else None

        log_capture_start(
            ticket_id,
            event,
            cam_id,
            role,
            masked_url=masked,
        )

        result: CaptureResult = svc._capture.capture(
            http_snapshot_url=cam.get('http_snapshot_url'),
            rtsp_url=cam.get('rtsp_url'),
            timeout_sec=float(timeout_sec),
            jpeg_quality=int(jpeg_quality),
        )
        if result.ok and result.jpeg_bytes:
            log_capture_result(
                ticket_id,
                event,
                cam_id,
                role,
                status='success',
                error_code=None,
                masked_url=masked,
            )
            return CapturePersistInput(
                camera_id=cam_id,
                camera_role=role,
                status='success',
                jpeg_bytes=result.jpeg_bytes,
                error_code=None,
                captured_at=captured_at,
            )

        error_code = result.error_code or 'unreachable'
        # Surface timeout as status=timeout for observability (TZ §3.5).
        result_status = 'timeout' if error_code == 'timeout' else 'failed'
        log_capture_result(
            ticket_id,
            event,
            cam_id,
            role,
            status=result_status,
            error_code=error_code,
            masked_url=masked,
        )
        return CapturePersistInput(
            camera_id=cam_id,
            camera_role=role,
            status='failed',
            jpeg_bytes=None,
            error_code=error_code,
            captured_at=captured_at,
        )

    workers = min(_MAX_CAPTURE_WORKERS, max(1, len(cameras)))
    persist_inputs: list[CapturePersistInput] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_capture_one, cam): cam for cam in cameras}
        for future in as_completed(futures):
            try:
                persist_inputs.append(future.result())
            except Exception:
                cam = futures[future]
                cam_id = str(cam.get('id') or '')
                role = str(cam.get('role') or 'overview')
                logger.exception(
                    'Unexpected capture worker failure camera=%s',
                    cam_id,
                )
                log_capture_result(
                    ticket_id,
                    event,
                    cam_id,
                    role,
                    status='failed',
                    error_code='unreachable',
                )
                persist_inputs.append(
                    CapturePersistInput(
                        camera_id=cam_id,
                        camera_role=role,
                        status='failed',
                        jpeg_bytes=None,
                        error_code='unreachable',
                        captured_at=captured_at,
                    )
                )

    # Preserve camera list order in results (as_completed is unordered)
    order = {str(cam.get('id')): index for index, cam in enumerate(cameras)}
    persist_inputs.sort(key=lambda item: order.get(item.camera_id, 10_000))

    # 5) Sequential persist in request thread (no parallel SQLite writers)
    payload = svc.replace_capture(
        ticket_id=ticket_id,
        event=event,
        per_camera_results=persist_inputs,
        camera_mode=camera_mode,
    )
    return {
        'success': True,
        'noop': False,
        'results': payload['results'],
        'photo_entry_path': payload['photo_entry_path'],
        'photo_exit_path': payload['photo_exit_path'],
        'ticket_photos': payload['ticket_photos'],
        'capture_token': payload['capture_token'],
    }
