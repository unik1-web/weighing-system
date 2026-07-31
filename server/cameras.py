"""Camera capability gate and JPEG capture (HTTP snapshot / RTSP)."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from urllib.parse import parse_qsl, quote, urlparse, urlunparse

# Minimal valid 1x1 JPEG used by stubs when a fixed payload is needed.
_STUB_JPEG_BYTES = (
    b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c'
    b'\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c'
    b'\x1c \x24.\x27 \x22,\x23\x1c\x1c(7),\x30313434\x1f\'9=82<.344\xff\xc0'
    b'\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14\x00\x01'
    b'\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x08\xff\xc4'
    b'\x00\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
    b'\x00\x00\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00T\xbf\xff\xd9'
)

_SENSITIVE_QUERY_KEYS = frozenset({'password', 'pass', 'token', 'key'})
_JPEG_SOI = b'\xff\xd8\xff'

logger = logging.getLogger(__name__)


def is_camera_module_available() -> bool:
    """
    Probe whether OpenCV (cv2) is importable in this build.

    Lazy import only — never import cv2 at module top-level so basic builds start.
    HTTP snapshot path does not require cv2.
    """
    try:
        import cv2  # noqa: F401
    except ImportError:
        return False
    return True


def get_camera_build_label() -> str:
    """Return build label ``full`` or ``basic`` based on camera module availability."""
    return 'full' if is_camera_module_available() else 'basic'


@dataclass(frozen=True)
class CaptureResult:
    """Result of a single camera capture attempt."""

    ok: bool
    jpeg_bytes: bytes | None
    error_code: str | None


def _is_jpeg_bytes(data: bytes) -> bool:
    """Return True when payload starts with a JPEG Start-Of-Image marker."""
    return bool(data) and data.startswith(_JPEG_SOI)


def _normalize_to_jpeg(raw: bytes, jpeg_quality: int) -> CaptureResult:
    """
    Accept JPEG bytes as-is, or re-encode via OpenCV when available and needed.

    Args:
        raw: Raw HTTP/RTSP frame bytes or encoded image.
        jpeg_quality: Target JPEG quality 1–100 (used only when re-encoding).

    Returns:
        CaptureResult with JPEG bytes or ``decode`` / ``capability_unavailable``.
    """
    if _is_jpeg_bytes(raw):
        return CaptureResult(ok=True, jpeg_bytes=raw, error_code=None)

    if not is_camera_module_available():
        return CaptureResult(
            ok=False,
            jpeg_bytes=None,
            error_code='capability_unavailable',
        )

    try:
        import cv2
        import numpy as np

        array = np.frombuffer(raw, dtype=np.uint8)
        frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if frame is None:
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='decode')
        quality = max(1, min(100, int(jpeg_quality)))
        ok, encoded = cv2.imencode(
            '.jpg',
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), quality],
        )
        if not ok or encoded is None:
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='decode')
        return CaptureResult(ok=True, jpeg_bytes=encoded.tobytes(), error_code=None)
    except Exception:
        logger.exception('Failed to decode/re-encode camera frame')
        return CaptureResult(ok=False, jpeg_bytes=None, error_code='decode')


class CameraCaptureService:
    """
    Capture JPEG frames from HTTP snapshot or RTSP URLs.

    Prefer HTTP snapshot (``requests``) when ``http_snapshot_url`` is set.
    RTSP uses OpenCV ``VideoCapture`` in a worker thread with a hard join timeout.
    """

    def capture(
        self,
        http_snapshot_url: str | None,
        rtsp_url: str | None,
        timeout_sec: float,
        jpeg_quality: int,
    ) -> CaptureResult:
        """
        Capture a frame from the given camera URLs.

        Args:
            http_snapshot_url: Optional HTTP snapshot URL (preferred when non-empty).
            rtsp_url: Optional RTSP URL (used only when HTTP URL is empty).
            timeout_sec: Hard timeout budget for HTTP GET or RTSP worker join.
            jpeg_quality: JPEG quality 1–100 (used when re-encoding via OpenCV).

        Returns:
            CaptureResult with JPEG bytes on success, or typed ``error_code``.
        """
        http_url = (http_snapshot_url or '').strip()
        rtsp = (rtsp_url or '').strip()
        timeout = max(0.1, float(timeout_sec))
        quality = int(jpeg_quality)

        if http_url:
            logger.info('Camera HTTP snapshot from %s', mask_url(http_url))
            return self._capture_http(http_url, timeout, quality)

        if rtsp:
            if not is_camera_module_available():
                logger.warning(
                    'RTSP capture unavailable (no OpenCV) for %s',
                    mask_url(rtsp),
                )
                return CaptureResult(
                    ok=False,
                    jpeg_bytes=None,
                    error_code='capability_unavailable',
                )
            logger.info('Camera RTSP capture from %s', mask_url(rtsp))
            return self._capture_rtsp(rtsp, timeout, quality)

        return CaptureResult(ok=False, jpeg_bytes=None, error_code='unreachable')

    def _capture_http(
        self,
        url: str,
        timeout_sec: float,
        jpeg_quality: int,
    ) -> CaptureResult:
        """
        Fetch a frame via HTTP GET with ``requests`` (no OpenCV required for JPEG).

        Args:
            url: Snapshot URL.
            timeout_sec: ``requests`` timeout in seconds.
            jpeg_quality: Quality used only if non-JPEG body must be re-encoded.
        """
        import requests

        try:
            response = requests.get(url, timeout=timeout_sec)
        except requests.Timeout:
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='timeout')
        except requests.RequestException:
            logger.info('HTTP snapshot unreachable: %s', mask_url(url))
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='unreachable')

        if response.status_code != 200:
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='unreachable')

        body = response.content or b''
        if not body:
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='decode')
        return _normalize_to_jpeg(body, jpeg_quality)

    def _capture_rtsp(
        self,
        url: str,
        timeout_sec: float,
        jpeg_quality: int,
    ) -> CaptureResult:
        """
        Capture one RTSP frame in a worker thread; join with hard timeout.

        Args:
            url: RTSP URL.
            timeout_sec: Maximum seconds to wait for open+read+encode.
            jpeg_quality: JPEG encode quality.
        """
        box: dict[str, CaptureResult] = {}

        def worker() -> None:
            import cv2

            capture = None
            try:
                capture = cv2.VideoCapture(url)
                if capture is None or not capture.isOpened():
                    box['result'] = CaptureResult(
                        ok=False,
                        jpeg_bytes=None,
                        error_code='unreachable',
                    )
                    return
                ok, frame = capture.read()
                if not ok or frame is None:
                    box['result'] = CaptureResult(
                        ok=False,
                        jpeg_bytes=None,
                        error_code='unreachable',
                    )
                    return
                quality = max(1, min(100, int(jpeg_quality)))
                encoded_ok, encoded = cv2.imencode(
                    '.jpg',
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), quality],
                )
                if not encoded_ok or encoded is None:
                    box['result'] = CaptureResult(
                        ok=False,
                        jpeg_bytes=None,
                        error_code='decode',
                    )
                    return
                box['result'] = CaptureResult(
                    ok=True,
                    jpeg_bytes=encoded.tobytes(),
                    error_code=None,
                )
            except Exception:
                logger.exception('RTSP capture failed for %s', mask_url(url))
                box['result'] = CaptureResult(
                    ok=False,
                    jpeg_bytes=None,
                    error_code='unreachable',
                )
            finally:
                if capture is not None:
                    try:
                        capture.release()
                    except Exception:
                        pass

        thread = threading.Thread(target=worker, name='camera-rtsp-capture', daemon=True)
        thread.start()
        thread.join(timeout=timeout_sec)
        if thread.is_alive():
            logger.warning('RTSP capture timed out for %s', mask_url(url))
            return CaptureResult(ok=False, jpeg_bytes=None, error_code='timeout')
        return box.get(
            'result',
            CaptureResult(ok=False, jpeg_bytes=None, error_code='unreachable'),
        )


def mask_url(url: str) -> str:
    """
    Mask credentials in URL userinfo and sensitive query parameters.

    Replaces password in ``user:password@host`` and query keys
    ``password`` / ``pass`` / ``token`` / ``key`` with ``***``.
    """
    if not url:
        return url
    try:
        parsed = urlparse(url)
    except Exception:
        return url

    netloc = parsed.netloc
    if '@' in netloc:
        userinfo, _, hostport = netloc.rpartition('@')
        if ':' in userinfo:
            username, _, _password = userinfo.partition(':')
            userinfo = f'{username}:***'
        netloc = f'{userinfo}@{hostport}'

    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    encoded_parts: list[str] = []
    for key, value in pairs:
        safe_value = '***' if key.lower() in _SENSITIVE_QUERY_KEYS else value
        encoded_parts.append(
            f'{quote(key, safe="")}={quote(safe_value, safe="*")}'
        )
    query = '&'.join(encoded_parts)
    return urlunparse(
        (parsed.scheme, netloc, parsed.path, parsed.params, query, parsed.fragment)
    )


def stub_jpeg_bytes() -> bytes:
    """Return the hardcoded stub JPEG payload (for API preview stubs)."""
    return _STUB_JPEG_BYTES
