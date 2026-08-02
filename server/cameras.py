"""Photo capture from IP cameras (HTTP snapshot / optional RTSP via OpenCV)."""

from __future__ import annotations

import io
import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime
from typing import Any

import requests

from config_ini import CONFIG_SECTION, read_ini_section
from sqlite_store import (
    connect,
    get_app_root,
    init_schema,
)

logger = logging.getLogger('cameras')

PHOTO_SUBDIR = 'Photo'
JPEG_QUALITY = 85
MAX_WIDTH = 1920
CONNECT_TIMEOUT = 1.0
READ_TIMEOUT = 3.0
PER_CAMERA_TIMEOUT = 3.0
CAPTURE_WALL_CLOCK = 6.0
MAX_WORKERS = 4

CAMERA_ROLES = ('entry', 'exit', 'overview')
PHOTO_PHASES = ('gross', 'tare')


def get_photo_root() -> str:
    return os.path.join(get_app_root(), PHOTO_SUBDIR)


def ensure_photo_dirs() -> str:
    root = get_photo_root()
    os.makedirs(os.path.join(root, 'refs'), exist_ok=True)
    os.makedirs(os.path.join(root, 'tmp'), exist_ok=True)
    return root


def _config_bool(key: str, default: bool = False) -> bool:
    try:
        from year_db import get_config_path
    except ImportError:  # pragma: no cover
        path = os.path.join(get_app_root(), 'config.ini')
    else:
        path = get_config_path()
    values = read_ini_section(path, CONFIG_SECTION)
    raw = values.get(key)
    if raw is None or raw == '':
        return default
    return str(raw).strip().lower() in {'1', 'true', 'yes', 'on'}


def is_video_enabled() -> bool:
    return _config_bool('video_enabled', False)


def _opencv_available() -> bool:
    try:
        import cv2  # noqa: F401
        return True
    except ImportError:
        return False


def is_capture_available() -> bool:
    """True if at least HTTP snapshot works (always) — RTSP needs OpenCV."""
    return True


def capture_backends() -> list[str]:
    backends = ['http_snapshot']
    if _opencv_available():
        backends.append('rtsp')
    return backends


def resolve_safe_photo_path(relative: str) -> str:
    """Resolve relative path under photo root; raises ValueError on traversal."""
    if not relative or not isinstance(relative, str):
        raise ValueError('Путь к фото не указан')
    cleaned = relative.replace('\\', '/').lstrip('/')
    if cleaned.startswith('..') or '/../' in f'/{cleaned}/' or cleaned.startswith('../'):
        raise ValueError('Недопустимый путь к фото')
    # Must be under Photo/
    if not cleaned.startswith(f'{PHOTO_SUBDIR}/') and cleaned != PHOTO_SUBDIR:
        # Allow paths stored as Photo/...
        if not cleaned.startswith(PHOTO_SUBDIR):
            raise ValueError('Путь вне каталога Photo')
    root = os.path.realpath(ensure_photo_dirs())
    # relative includes Photo/ prefix → join with app root
    absolute = os.path.realpath(os.path.join(get_app_root(), cleaned.replace('/', os.sep)))
    if absolute != root and not absolute.startswith(root + os.sep):
        raise ValueError('Путь вне каталога Photo')
    return absolute


def _rel_from_app(absolute: str) -> str:
    return os.path.relpath(absolute, get_app_root()).replace(os.sep, '/')


def _now_iso() -> str:
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def _stamp() -> str:
    return datetime.now().strftime('%Y%m%d%H%M%S')


def _detect_kind(url: str, kind: str | None) -> str:
    if kind and kind != 'auto':
        return kind
    lowered = (url or '').strip().lower()
    if lowered.startswith('rtsp://'):
        return 'rtsp'
    return 'http_snapshot'


def _encode_jpeg(raw: bytes) -> bytes:
    """Re-encode / downscale JPEG if Pillow or OpenCV available; else return as-is."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(raw))
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        w, h = img.size
        if w > MAX_WIDTH:
            ratio = MAX_WIDTH / float(w)
            img = img.resize((MAX_WIDTH, max(1, int(h * ratio))), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()
    except Exception:
        pass

    try:
        import cv2
        import numpy as np

        arr = np.frombuffer(raw, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return raw
        h, w = frame.shape[:2]
        if w > MAX_WIDTH:
            ratio = MAX_WIDTH / float(w)
            frame = cv2.resize(frame, (MAX_WIDTH, max(1, int(h * ratio))))
        ok, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
        if ok:
            return encoded.tobytes()
    except Exception:
        pass
    return raw


def grab_frame_http(url: str) -> bytes:
    response = requests.get(url, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT), stream=True)
    response.raise_for_status()
    content_type = (response.headers.get('Content-Type') or '').lower()
    data = response.content
    if not data:
        raise RuntimeError('Пустой ответ HTTP snapshot')
    if 'jpeg' in content_type or 'jpg' in content_type or data[:2] == b'\xff\xd8':
        return _encode_jpeg(data)
    # Some cameras return multipart or other; try encode anyway
    return _encode_jpeg(data)


def grab_frame_rtsp(url: str) -> bytes:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError(
            'RTSP недоступен: OpenCV не установлен (полная сборка с opencv-python-headless)'
        ) from exc

    cap = cv2.VideoCapture(url)
    try:
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, int(CONNECT_TIMEOUT * 1000))
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, int(READ_TIMEOUT * 1000))
    except Exception:
        pass
    if not cap.isOpened():
        cap.release()
        raise RuntimeError('Не удалось открыть RTSP поток')
    try:
        ok, frame = cap.read()
        if not ok or frame is None:
            raise RuntimeError('Не удалось прочитать кадр RTSP')
        h, w = frame.shape[:2]
        if w > MAX_WIDTH:
            ratio = MAX_WIDTH / float(w)
            frame = cv2.resize(frame, (MAX_WIDTH, max(1, int(h * ratio))))
        ok2, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
        if not ok2:
            raise RuntimeError('Ошибка кодирования JPEG')
        return encoded.tobytes()
    finally:
        cap.release()


def grab_frame(camera: dict[str, Any]) -> bytes:
    url = str(camera.get('capture_url') or '').strip()
    if not url:
        raise RuntimeError('URL камеры пуст')
    kind = _detect_kind(url, camera.get('capture_kind'))
    if kind == 'rtsp':
        return grab_frame_rtsp(url)
    return grab_frame_http(url)


def list_enabled_cameras(site_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        init_schema(connection)
        rows = connection.execute(
            '''
            SELECT id, site_id, role, name, capture_url, capture_kind, enabled,
                   sort_order, roi_json, reference_normal_path, reference_spare_path, created_at
            FROM cameras
            WHERE site_id = ? AND enabled = 1
            ORDER BY sort_order ASC, created_at ASC
            ''',
            (site_id,),
        ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        roi = None
        if row['roi_json']:
            try:
                import json

                roi = json.loads(row['roi_json'])
            except Exception:
                roi = None
        result.append(
            {
                'id': row['id'],
                'site_id': row['site_id'],
                'role': row['role'],
                'name': row['name'],
                'capture_url': row['capture_url'],
                'capture_kind': row['capture_kind'],
                'enabled': bool(row['enabled']),
                'sort_order': int(row['sort_order'] or 0),
                'roi': roi,
                'reference_normal_path': row['reference_normal_path'],
                'reference_spare_path': row['reference_spare_path'],
                'created_at': row['created_at'],
            }
        )
    return result


def _camera_mode_for_site(site_id: str) -> str:
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            'SELECT camera_mode FROM site_runtime WHERE site_id = ?',
            (site_id,),
        ).fetchone()
    if row and row['camera_mode']:
        return str(row['camera_mode'])
    return 'normal'


def _resolve_site_id(ticket_id: str, site_id: str | None) -> str:
    if site_id:
        return site_id
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            'SELECT site_id FROM weighing_tickets WHERE id = ?',
            (ticket_id,),
        ).fetchone()
    if row and row['site_id']:
        return str(row['site_id'])
    # fallback: default site
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            'SELECT id FROM sites ORDER BY is_default DESC, created_at ASC LIMIT 1'
        ).fetchone()
    if row:
        return str(row['id'])
    raise ValueError('Не удалось определить площадку для захвата')


def _ticket_photo_path(ticket_id: str, phase: str, role: str) -> str:
    now = datetime.now()
    day_dir = os.path.join(
        ensure_photo_dirs(),
        f'{now.year:04d}',
        f'{now.month:02d}',
        f'{now.day:02d}',
    )
    os.makedirs(day_dir, exist_ok=True)
    filename = f'{ticket_id}_{phase}_{role}_{_stamp()}.jpg'
    absolute = os.path.join(day_dir, filename)
    return absolute


def _write_photo_row(
    connection: Any,
    photo: dict[str, Any],
) -> None:
    connection.execute(
        '''
        INSERT INTO ticket_photos (
            id, ticket_id, phase, camera_id, camera_role, relative_path,
            status, error_message, camera_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            photo['id'],
            photo['ticket_id'],
            photo['phase'],
            photo.get('camera_id'),
            photo['camera_role'],
            photo.get('relative_path'),
            photo['status'],
            photo.get('error_message'),
            photo['camera_mode'],
            photo['created_at'],
        ),
    )


def _update_ticket_stubs(connection: Any, ticket_id: str, photos: list[dict[str, Any]]) -> dict[str, str | None]:
    row = connection.execute(
        '''
        SELECT photo_entry_path, photo_exit_path, photo_overview_path
        FROM weighing_tickets WHERE id = ?
        ''',
        (ticket_id,),
    ).fetchone()
    stubs: dict[str, str | None] = {
        'photo_entry_path': row['photo_entry_path'] if row else None,
        'photo_exit_path': row['photo_exit_path'] if row else None,
        'photo_overview_path': row['photo_overview_path'] if row else None,
    }
    role_to_field = {
        'entry': 'photo_entry_path',
        'exit': 'photo_exit_path',
        'overview': 'photo_overview_path',
    }
    for photo in photos:
        if photo.get('status') != 'ok' or not photo.get('relative_path'):
            continue
        field = role_to_field.get(photo.get('camera_role'))
        if field:
            stubs[field] = photo['relative_path']
    connection.execute(
        '''
        UPDATE weighing_tickets
        SET photo_entry_path = ?, photo_exit_path = ?, photo_overview_path = ?
        WHERE id = ?
        ''',
        (
            stubs['photo_entry_path'],
            stubs['photo_exit_path'],
            stubs['photo_overview_path'],
            ticket_id,
        ),
    )
    return stubs


def _capture_one(
    camera: dict[str, Any],
    ticket_id: str,
    phase: str,
    camera_mode: str,
    skip_reason: str | None,
) -> dict[str, Any]:
    photo_id = str(uuid.uuid4())
    created = _now_iso()
    base: dict[str, Any] = {
        'id': photo_id,
        'ticket_id': ticket_id,
        'phase': phase,
        'camera_id': camera.get('id'),
        'camera_role': camera.get('role') or 'overview',
        'relative_path': None,
        'status': 'skipped',
        'error_message': skip_reason,
        'camera_mode': camera_mode,
        'created_at': created,
    }
    if skip_reason:
        return base
    try:
        jpeg = grab_frame(camera)
        absolute = _ticket_photo_path(ticket_id, phase, str(camera.get('role') or 'overview'))
        with open(absolute, 'wb') as handle:
            handle.write(jpeg)
        base['relative_path'] = _rel_from_app(absolute)
        base['status'] = 'ok'
        base['error_message'] = None
    except Exception as exc:
        logger.warning(
            'Capture failed ticket=%s camera=%s: %s',
            ticket_id,
            camera.get('id'),
            exc,
        )
        base['status'] = 'failed'
        base['error_message'] = str(exc)
    return base


def _failed_photo(
    camera: dict[str, Any],
    ticket_id: str,
    phase: str,
    camera_mode: str,
    error_message: str,
) -> dict[str, Any]:
    return {
        'id': str(uuid.uuid4()),
        'ticket_id': ticket_id,
        'phase': phase,
        'camera_id': camera.get('id'),
        'camera_role': camera.get('role') or 'overview',
        'relative_path': None,
        'status': 'failed',
        'error_message': error_message,
        'camera_mode': camera_mode,
        'created_at': _now_iso(),
    }


def _capture_parallel(
    cameras: list[dict[str, Any]],
    ticket_id: str,
    phase: str,
    camera_mode: str,
) -> list[dict[str, Any]]:
    """Parallel grab with hard wall-clock timeout (~CAPTURE_WALL_CLOCK seconds)."""
    if not cameras:
        return []
    workers = min(MAX_WORKERS, len(cameras))
    pool = ThreadPoolExecutor(max_workers=workers)
    futures = {
        pool.submit(_capture_one, cam, ticket_id, phase, camera_mode, None): cam
        for cam in cameras
    }
    photos: list[dict[str, Any]] = []
    try:
        done, not_done = wait(set(futures.keys()), timeout=CAPTURE_WALL_CLOCK)
        for fut in done:
            cam = futures[fut]
            try:
                photos.append(fut.result(timeout=0))
            except Exception as exc:
                logger.warning(
                    'Capture future error ticket=%s camera=%s: %s',
                    ticket_id,
                    cam.get('id'),
                    exc,
                )
                photos.append(
                    _failed_photo(cam, ticket_id, phase, camera_mode, str(exc))
                )
        for fut in not_done:
            cam = futures[fut]
            logger.warning(
                'Capture wall-clock timeout ticket=%s camera=%s (%.0fs)',
                ticket_id,
                cam.get('id'),
                CAPTURE_WALL_CLOCK,
            )
            photos.append(
                _failed_photo(
                    cam,
                    ticket_id,
                    phase,
                    camera_mode,
                    f'Таймаут захвата ({CAPTURE_WALL_CLOCK:.0f} с)',
                )
            )
            fut.cancel()
    finally:
        # Do not block HTTP on hung RTSP workers
        pool.shutdown(wait=False, cancel_futures=True)
    return photos


def capture_for_ticket(
    ticket_id: str,
    phase: str,
    site_id: str | None = None,
    camera_mode: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str | None]]:
    if phase not in PHOTO_PHASES:
        raise ValueError(f'Некорректная phase: {phase}')

    resolved_site = _resolve_site_id(ticket_id, site_id)
    mode = camera_mode or _camera_mode_for_site(resolved_site)
    cameras = list_enabled_cameras(resolved_site)

    video_on = is_video_enabled()
    # HTTP always available; RTSP may fail per-camera
    capture_ok = is_capture_available()

    skip_reason: str | None = None
    if not video_on:
        skip_reason = 'Видеофиксация отключена (video_enabled=false)'
    elif not capture_ok:
        skip_reason = 'Модуль захвата недоступен'

    photos: list[dict[str, Any]] = []
    if not cameras:
        # No cameras — nothing to record (empty list is fine)
        stubs = {
            'photo_entry_path': None,
            'photo_exit_path': None,
            'photo_overview_path': None,
        }
        with connect() as connection:
            init_schema(connection)
            row = connection.execute(
                '''
                SELECT photo_entry_path, photo_exit_path, photo_overview_path
                FROM weighing_tickets WHERE id = ?
                ''',
                (ticket_id,),
            ).fetchone()
            if row:
                stubs = {
                    'photo_entry_path': row['photo_entry_path'],
                    'photo_exit_path': row['photo_exit_path'],
                    'photo_overview_path': row['photo_overview_path'],
                }
        return [], stubs

    if skip_reason:
        for cam in cameras:
            photos.append(_capture_one(cam, ticket_id, phase, mode, skip_reason))
    else:
        photos = _capture_parallel(cameras, ticket_id, phase, mode)

    # Stable order by camera sort
    order = {c['id']: i for i, c in enumerate(cameras)}
    photos.sort(key=lambda p: order.get(p.get('camera_id') or '', 999))

    with connect() as connection:
        init_schema(connection)
        for photo in photos:
            _write_photo_row(connection, photo)
        stubs = _update_ticket_stubs(connection, ticket_id, photos)

    return photos, stubs


def save_tmp_snapshot(jpeg: bytes) -> str:
    ensure_photo_dirs()
    name = f'{uuid.uuid4().hex}.jpg'
    absolute = os.path.join(get_photo_root(), 'tmp', name)
    with open(absolute, 'wb') as handle:
        handle.write(jpeg)
    return _rel_from_app(absolute)


def snapshot_camera(camera_id: str | None = None, capture_url: str | None = None, capture_kind: str | None = None) -> str:
    if camera_id:
        with connect() as connection:
            init_schema(connection)
            row = connection.execute(
                '''
                SELECT id, site_id, role, name, capture_url, capture_kind, enabled,
                       sort_order, roi_json, reference_normal_path, reference_spare_path, created_at
                FROM cameras WHERE id = ?
                ''',
                (camera_id,),
            ).fetchone()
        if not row:
            raise ValueError('Камера не найдена')
        camera = {
            'id': row['id'],
            'capture_url': row['capture_url'],
            'capture_kind': row['capture_kind'],
            'role': row['role'],
        }
    elif capture_url:
        camera = {
            'id': None,
            'capture_url': capture_url,
            'capture_kind': capture_kind or 'auto',
            'role': 'overview',
        }
    else:
        raise ValueError('Укажите camera_id или capture_url')
    jpeg = grab_frame(camera)
    return save_tmp_snapshot(jpeg)


def save_reference(camera_id: str, mode: str) -> dict[str, Any]:
    if mode not in ('normal', 'spare'):
        raise ValueError('mode должен быть normal или spare')
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            '''
            SELECT id, site_id, role, name, capture_url, capture_kind, enabled,
                   sort_order, roi_json, reference_normal_path, reference_spare_path, created_at
            FROM cameras WHERE id = ?
            ''',
            (camera_id,),
        ).fetchone()
        if not row:
            raise ValueError('Камера не найдена')
        camera = {
            'id': row['id'],
            'capture_url': row['capture_url'],
            'capture_kind': row['capture_kind'],
            'role': row['role'],
        }
        jpeg = grab_frame(camera)
        ensure_photo_dirs()
        filename = f'{camera_id}_{mode}.jpg'
        absolute = os.path.join(get_photo_root(), 'refs', filename)
        with open(absolute, 'wb') as handle:
            handle.write(jpeg)
        rel = _rel_from_app(absolute)
        if mode == 'normal':
            connection.execute(
                'UPDATE cameras SET reference_normal_path = ? WHERE id = ?',
                (rel, camera_id),
            )
        else:
            connection.execute(
                'UPDATE cameras SET reference_spare_path = ? WHERE id = ?',
                (rel, camera_id),
            )
        updated = connection.execute(
            '''
            SELECT id, site_id, role, name, capture_url, capture_kind, enabled,
                   sort_order, roi_json, reference_normal_path, reference_spare_path, created_at
            FROM cameras WHERE id = ?
            ''',
            (camera_id,),
        ).fetchone()

    import json

    roi = None
    if updated['roi_json']:
        try:
            roi = json.loads(updated['roi_json'])
        except Exception:
            roi = None
    return {
        'id': updated['id'],
        'site_id': updated['site_id'],
        'role': updated['role'],
        'name': updated['name'],
        'capture_url': updated['capture_url'],
        'capture_kind': updated['capture_kind'],
        'enabled': bool(updated['enabled']),
        'sort_order': int(updated['sort_order'] or 0),
        'roi': roi,
        'reference_normal_path': updated['reference_normal_path'],
        'reference_spare_path': updated['reference_spare_path'],
        'created_at': updated['created_at'],
    }


def capabilities() -> dict[str, Any]:
    return {
        'capture_available': is_capture_available(),
        'backends': capture_backends(),
        'video_enabled': is_video_enabled(),
        'photo_root': PHOTO_SUBDIR,
        'opencv_available': _opencv_available(),
    }
