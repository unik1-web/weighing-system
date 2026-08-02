"""Local ANPR: gate, ROI crop, pluggable engine (ONNX full build / stub without model)."""

from __future__ import annotations

import io
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Any, Protocol

from config_ini import CONFIG_SECTION, read_ini_section
from sqlite_store import connect, get_app_root, init_schema

logger = logging.getLogger('anpr')

MODEL_SUBDIR = os.path.join('models', 'anpr')
MODEL_FILENAME = 'plate.onnx'
RECOGNIZE_TIMEOUT_SEC = 5.0
ANPR_STATUS_ENABLED = 'enabled'
ANPR_STATUS_DISABLED = 'disabled_by_configuration'
ANPR_STATUS_FAILED = 'failed'

_engine_override: AnprEngine | None = None
_default_engine: AnprEngine | None = None
_engine_lock = threading.Lock()


class AnprEngine(Protocol):
    def is_available(self) -> bool: ...

    def recognize(self, jpeg: bytes) -> tuple[str, float]:
        """Return (plate_raw, confidence 0..1). Raises on inference failure."""
        ...


class UnavailableAnprEngine:
    """Default when onnxruntime / model weights are missing (basic build)."""

    def is_available(self) -> bool:
        return False

    def recognize(self, jpeg: bytes) -> tuple[str, float]:
        raise RuntimeError('ANPR-движок недоступен: нет модели или onnxruntime')


class OnnxAnprEngine:
    """
    Full-build engine: loads `{app_root}/models/anpr/plate.onnx` via onnxruntime.

    Model weights are NOT in git. Place plate.onnx (and any sidecar files required
    by the chosen spike model) under models/anpr/ next to the executable / app root.
    Basic installer build should exclude onnxruntime (see installer/weighing-system.spec).
    """

    def __init__(self, model_path: str) -> None:
        self._model_path = model_path
        self._session = None
        self._load_error: str | None = None
        try:
            import onnxruntime as ort  # type: ignore

            if not os.path.isfile(model_path):
                self._load_error = f'Файл модели не найден: {model_path}'
                return
            self._session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
        except ImportError:
            self._load_error = 'onnxruntime не установлен (нужна полная сборка)'
        except Exception as exc:  # pragma: no cover - depends on model format
            self._load_error = f'Не удалось загрузить модель ANPR: {exc}'
            logger.warning('ANPR model load failed: %s', exc)

    def is_available(self) -> bool:
        return self._session is not None

    def recognize(self, jpeg: bytes) -> tuple[str, float]:
        if self._session is None:
            raise RuntimeError(self._load_error or 'Модель ANPR не загружена')
        # Concrete I/O tensor mapping is model-specific (chosen at spike).
        # Until a production model is wired, treat loaded session without a known
        # contract as unavailable at call time rather than inventing plates.
        raise RuntimeError(
            'Модель ANPR загружена, но контракт входа/выхода ещё не привязан к весам. '
            'См. docs/implementation/anpr-spike-checklist.md'
        )


def model_dir() -> str:
    return os.path.join(get_app_root(), MODEL_SUBDIR)


def model_path() -> str:
    return os.path.join(model_dir(), MODEL_FILENAME)


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


def is_anpr_enabled() -> bool:
    """Feature flag from config.ini; default False until spike accuracy ≥ 50%."""
    return _config_bool('anpr_enabled', False)


def set_engine_override(engine: AnprEngine | None) -> None:
    """Test hook: inject FakeEngine / clear to restore default."""
    global _engine_override
    _engine_override = engine


def reset_default_engine() -> None:
    global _default_engine
    with _engine_lock:
        _default_engine = None


def get_engine() -> AnprEngine:
    if _engine_override is not None:
        return _engine_override
    global _default_engine
    with _engine_lock:
        if _default_engine is None:
            path = model_path()
            if os.path.isfile(path):
                _default_engine = OnnxAnprEngine(path)
                if not _default_engine.is_available():
                    _default_engine = UnavailableAnprEngine()
            else:
                _default_engine = UnavailableAnprEngine()
        return _default_engine


def is_anpr_available() -> bool:
    return get_engine().is_available()


def crop_roi(jpeg: bytes, roi: dict[str, Any] | None) -> bytes:
    """Crop normalized ROI (x,y,w,h ∈ [0..1]). None / full frame → original JPEG."""
    if not jpeg:
        return jpeg
    if not roi or not isinstance(roi, dict):
        return jpeg
    try:
        x = float(roi.get('x', 0))
        y = float(roi.get('y', 0))
        w = float(roi.get('w', 1))
        h = float(roi.get('h', 1))
    except (TypeError, ValueError):
        return jpeg
    # Treat near-full ROI as no-op
    if x <= 0.001 and y <= 0.001 and w >= 0.999 and h >= 0.999:
        return jpeg
    if w <= 0 or h <= 0:
        return jpeg

    try:
        from PIL import Image

        img = Image.open(io.BytesIO(jpeg))
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        iw, ih = img.size
        left = max(0, min(iw - 1, int(round(x * iw))))
        top = max(0, min(ih - 1, int(round(y * ih))))
        right = max(left + 1, min(iw, int(round((x + w) * iw))))
        bottom = max(top + 1, min(ih, int(round((y + h) * ih))))
        cropped = img.crop((left, top, right, bottom))
        buf = io.BytesIO()
        cropped.save(buf, format='JPEG', quality=90)
        return buf.getvalue()
    except Exception:
        pass

    try:
        import cv2
        import numpy as np

        arr = np.frombuffer(jpeg, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return jpeg
        ih, iw = frame.shape[:2]
        left = max(0, min(iw - 1, int(round(x * iw))))
        top = max(0, min(ih - 1, int(round(y * ih))))
        right = max(left + 1, min(iw, int(round((x + w) * iw))))
        bottom = max(top + 1, min(ih, int(round((y + h) * ih))))
        cropped = frame[top:bottom, left:right]
        ok, encoded = cv2.imencode('.jpg', cropped, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        if ok:
            return encoded.tobytes()
    except Exception:
        pass

    return jpeg


def _resolve_site_id(site_id: str | None) -> str:
    if site_id:
        return site_id
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            'SELECT id FROM sites WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1'
        ).fetchone()
        if row:
            return str(row['id'])
        row = connection.execute('SELECT id FROM sites ORDER BY created_at ASC LIMIT 1').fetchone()
        if row:
            return str(row['id'])
    raise ValueError('Площадка не найдена')


def _anpr_mode_for_site(site_id: str) -> str:
    with connect() as connection:
        init_schema(connection)
        row = connection.execute(
            'SELECT anpr_mode FROM site_runtime WHERE site_id = ?',
            (site_id,),
        ).fetchone()
    if row and row['anpr_mode']:
        return str(row['anpr_mode'])
    return ANPR_STATUS_ENABLED


def _find_overview_camera(site_id: str, camera_id: str | None = None) -> dict[str, Any] | None:
    import cameras as cameras_mod

    cameras = cameras_mod.list_enabled_cameras(site_id)
    overview = [
        c
        for c in cameras
        if c.get('role') == 'overview' and str(c.get('capture_url') or '').strip()
    ]
    if camera_id:
        for cam in overview:
            if cam.get('id') == camera_id:
                return cam
        return None
    return overview[0] if overview else None


def evaluate_gate(site_id: str, camera_id: str | None = None) -> dict[str, Any]:
    """
    Returns:
      allowed, anpr_status, reason, camera?, anpr_enabled, video_enabled, anpr_mode, anpr_available
    """
    import cameras as cameras_mod

    anpr_enabled = is_anpr_enabled()
    video_enabled = cameras_mod.is_video_enabled()
    anpr_mode = _anpr_mode_for_site(site_id)
    anpr_available = is_anpr_available()
    camera = _find_overview_camera(site_id, camera_id)

    if not anpr_enabled:
        return {
            'allowed': False,
            'anpr_status': ANPR_STATUS_DISABLED,
            'reason': 'anpr_enabled=false',
            'camera': None,
            'anpr_enabled': anpr_enabled,
            'video_enabled': video_enabled,
            'anpr_mode': anpr_mode,
            'anpr_available': anpr_available,
        }
    if not video_enabled:
        return {
            'allowed': False,
            'anpr_status': ANPR_STATUS_DISABLED,
            'reason': 'video_enabled=false',
            'camera': None,
            'anpr_enabled': anpr_enabled,
            'video_enabled': video_enabled,
            'anpr_mode': anpr_mode,
            'anpr_available': anpr_available,
        }
    if anpr_mode != ANPR_STATUS_ENABLED:
        return {
            'allowed': False,
            'anpr_status': ANPR_STATUS_DISABLED,
            'reason': f'anpr_mode={anpr_mode}',
            'camera': None,
            'anpr_enabled': anpr_enabled,
            'video_enabled': video_enabled,
            'anpr_mode': anpr_mode,
            'anpr_available': anpr_available,
        }
    if camera is None:
        return {
            'allowed': False,
            'anpr_status': ANPR_STATUS_DISABLED,
            'reason': 'no_overview_camera',
            'camera': None,
            'anpr_enabled': anpr_enabled,
            'video_enabled': video_enabled,
            'anpr_mode': anpr_mode,
            'anpr_available': anpr_available,
        }
    if not anpr_available:
        return {
            'allowed': False,
            'anpr_status': ANPR_STATUS_DISABLED,
            'reason': 'anpr_unavailable',
            'camera': camera,
            'anpr_enabled': anpr_enabled,
            'video_enabled': video_enabled,
            'anpr_mode': anpr_mode,
            'anpr_available': anpr_available,
        }
    return {
        'allowed': True,
        'anpr_status': ANPR_STATUS_ENABLED,
        'reason': None,
        'camera': camera,
        'anpr_enabled': anpr_enabled,
        'video_enabled': video_enabled,
        'anpr_mode': anpr_mode,
        'anpr_available': anpr_available,
    }


def capabilities() -> dict[str, Any]:
    engine = get_engine()
    available = engine.is_available()
    backends: list[str] = []
    engine_name = 'unavailable'
    if available:
        if isinstance(engine, OnnxAnprEngine) or type(engine).__name__ == 'OnnxAnprEngine':
            engine_name = 'onnx'
            backends.append('onnxruntime')
        else:
            engine_name = type(engine).__name__
            backends.append(engine_name)
    else:
        try:
            import onnxruntime  # noqa: F401

            backends.append('onnxruntime')
            engine_name = 'onnx_not_loaded'
        except ImportError:
            pass
    return {
        'anpr_available': available,
        'anpr_enabled': is_anpr_enabled(),
        'video_enabled': _config_bool('video_enabled', False),
        'engine': engine_name,
        'model_loaded': available,
        'backends': backends,
        'model_path': MODEL_SUBDIR.replace('\\', '/') + '/' + MODEL_FILENAME,
    }


def _recognize_inner(site_id: str, camera_id: str | None) -> dict[str, Any]:
    import cameras as cameras_mod

    gate = evaluate_gate(site_id, camera_id)
    if not gate['allowed']:
        return {
            'success': True,
            'engine_invoked': False,
            'anpr_status': gate['anpr_status'],
            'plate_raw': None,
            'confidence': None,
            'camera_id': (gate['camera'] or {}).get('id') if gate.get('camera') else None,
            'error': None,
            'reason': gate['reason'],
        }

    camera = gate['camera']
    assert camera is not None
    cam_id = str(camera.get('id') or '')

    try:
        jpeg = cameras_mod.grab_frame(camera)
    except Exception as exc:
        logger.warning('ANPR grab_frame failed: %s', exc)
        return {
            'success': True,
            'engine_invoked': True,
            'anpr_status': ANPR_STATUS_FAILED,
            'plate_raw': None,
            'confidence': None,
            'camera_id': cam_id,
            'error': str(exc) or 'Ошибка захвата overview',
            'reason': None,
        }

    try:
        cropped = crop_roi(jpeg, camera.get('roi'))
        plate_raw, confidence = get_engine().recognize(cropped)
    except Exception as exc:
        logger.warning('ANPR recognize failed: %s', exc)
        return {
            'success': True,
            'engine_invoked': True,
            'anpr_status': ANPR_STATUS_FAILED,
            'plate_raw': None,
            'confidence': None,
            'camera_id': cam_id,
            'error': str(exc) or 'Ошибка распознавания',
            'reason': None,
        }

    conf: float | None
    try:
        conf = float(confidence)
        if conf < 0:
            conf = 0.0
        elif conf > 1:
            # Allow engines that return 0..100
            if conf <= 100:
                conf = conf / 100.0
            else:
                conf = 1.0
    except (TypeError, ValueError):
        conf = None

    plate = str(plate_raw).strip() if plate_raw is not None else ''
    if not plate:
        return {
            'success': True,
            'engine_invoked': True,
            'anpr_status': ANPR_STATUS_FAILED,
            'plate_raw': None,
            'confidence': conf,
            'camera_id': cam_id,
            'error': 'Номер не распознан',
            'reason': None,
        }

    return {
        'success': True,
        'engine_invoked': True,
        'anpr_status': ANPR_STATUS_ENABLED,
        'plate_raw': plate,
        'confidence': conf,
        'camera_id': cam_id,
        'error': None,
        'reason': None,
    }


def recognize(site_id: str | None = None, camera_id: str | None = None) -> dict[str, Any]:
    """Capture overview (+ ROI crop) and run ANPR. Wall-clock timeout 5s. Does not write tickets."""
    try:
        resolved_site = _resolve_site_id(site_id)
    except ValueError as exc:
        return {
            'success': True,
            'engine_invoked': False,
            'anpr_status': ANPR_STATUS_DISABLED,
            'plate_raw': None,
            'confidence': None,
            'camera_id': None,
            'error': None,
            'reason': str(exc),
        }

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_recognize_inner, resolved_site, camera_id)
        try:
            return future.result(timeout=RECOGNIZE_TIMEOUT_SEC)
        except FuturesTimeout:
            return {
                'success': True,
                'engine_invoked': True,
                'anpr_status': ANPR_STATUS_FAILED,
                'plate_raw': None,
                'confidence': None,
                'camera_id': camera_id,
                'error': 'Таймаут распознавания ANPR',
                'reason': None,
            }
        except Exception as exc:
            logger.exception('ANPR recognize unexpected error')
            return {
                'success': True,
                'engine_invoked': True,
                'anpr_status': ANPR_STATUS_FAILED,
                'plate_raw': None,
                'confidence': None,
                'camera_id': camera_id,
                'error': str(exc) or 'Ошибка ANPR',
                'reason': None,
            }
