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


@pytest.fixture
def api_client(temp_app_root):
    """Flask test client bound to the isolated temp app root."""
    import app as flask_app
    import scale_api

    class DefaultFakeTransport:
        def open(self, _connection):
            return None

        def read_line(self, _timeout_ms):
            return 'ST,GS,+00045.0kg\r\n'

        def close(self):
            return None

    flask_app.app.config['TESTING'] = True
    scale_api.reset_scale_runtime_state()
    scale_api.set_scale_transport_factory(DefaultFakeTransport)
    return flask_app.app.test_client()
