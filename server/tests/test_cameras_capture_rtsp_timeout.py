"""RTSP capture hard-timeout via worker thread (mocked hung VideoCapture)."""

from __future__ import annotations

import sys
import time
import types

import cameras
from cameras import CameraCaptureService, CaptureResult


def _install_fake_cv2(monkeypatch, *, hang_open: bool = True, hang_seconds: float = 30.0):
    """
    Install a fake ``cv2`` module so RTSP path runs without real OpenCV.

    When ``hang_open`` is True, ``VideoCapture`` blocks in ``__init__`` longer
    than the capture timeout to exercise EC-12 hard-timeout.
    """

    class FakeVideoCapture:
        def __init__(self, _url):
            if hang_open:
                time.sleep(hang_seconds)
            self._opened = not hang_open

        def isOpened(self):  # noqa: N802
            return self._opened

        def read(self):
            return False, None

        def release(self):
            return None

    fake = types.ModuleType('cv2')
    fake.VideoCapture = FakeVideoCapture
    fake.IMWRITE_JPEG_QUALITY = 1
    fake.imencode = lambda *_args, **_kwargs: (False, None)
    monkeypatch.setitem(sys.modules, 'cv2', fake)
    monkeypatch.setattr(cameras, 'is_camera_module_available', lambda: True)


def test_rtsp_hung_open_returns_timeout(temp_app_root, monkeypatch):
    """TC-UNIT-02 / EC-12: hung VideoCapture open → timeout within timeout+ε."""
    _install_fake_cv2(monkeypatch, hang_open=True, hang_seconds=30.0)
    service = CameraCaptureService()
    timeout_sec = 0.4
    started = time.monotonic()
    result = service.capture(None, 'rtsp://user:secret@cam/stream', timeout_sec, 80)
    elapsed = time.monotonic() - started

    assert isinstance(result, CaptureResult)
    assert result.ok is False
    assert result.jpeg_bytes is None
    assert result.error_code == 'timeout'
    assert elapsed <= timeout_sec + 0.8


def test_rtsp_without_cv2_capability_unavailable(temp_app_root, monkeypatch):
    """RTSP path reports capability_unavailable when OpenCV is missing."""
    monkeypatch.setattr(cameras, 'is_camera_module_available', lambda: False)
    service = CameraCaptureService()
    result = service.capture(None, 'rtsp://cam/stream', 1.0, 80)
    assert result.ok is False
    assert result.error_code == 'capability_unavailable'


def test_empty_urls_unreachable(temp_app_root):
    """Both empty URLs → unreachable typed error."""
    service = CameraCaptureService()
    result = service.capture(None, None, 1.0, 80)
    assert result.ok is False
    assert result.error_code == 'unreachable'
