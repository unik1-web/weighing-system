import os
import sys

import pytest

SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)


@pytest.fixture
def temp_app_root(tmp_path, monkeypatch):
    """Isolate SQLite/config writes to a temporary application root."""
    import sqlite_store
    import persistence

    root = tmp_path / 'app'
    root.mkdir()
    (root / 'BD').mkdir()

    monkeypatch.setattr(sqlite_store, 'get_app_root', lambda: str(root))
    monkeypatch.setattr(persistence, 'get_app_root', lambda: str(root))
    return root
