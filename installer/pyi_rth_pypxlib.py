"""PyInstaller runtime hook: make pypxlib native DLL discoverable."""
from __future__ import annotations

import os
import sys


def _add_dll_dir(path: str) -> None:
    if not os.path.isdir(path):
        return
    if hasattr(os, 'add_dll_directory'):
        os.add_dll_directory(path)
    os.environ['PATH'] = path + os.pathsep + os.environ.get('PATH', '')


if getattr(sys, 'frozen', False):
    base_dir = getattr(sys, '_MEIPASS', '')
    candidates = [
        os.path.join(base_dir, 'pypxlib', 'pxlib_ctypes'),
        os.path.join(base_dir, 'pxlib_ctypes'),
        os.path.dirname(sys.executable),
    ]
    for candidate in candidates:
        _add_dll_dir(candidate)
