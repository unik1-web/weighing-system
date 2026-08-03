"""Regression: logout must clear the persisted SQLite session row."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from unittest import mock

SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import sqlite_store  # noqa: E402


class SessionClearTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self._bd_dir = os.path.join(self._tmpdir.name, 'BD')
        os.makedirs(self._bd_dir, exist_ok=True)

        patcher = mock.patch.object(sqlite_store, 'get_bd_dir', return_value=self._bd_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_empty_session_tombstone_removes_persisted_session(self) -> None:
        session = json.dumps(
            {
                'user': {'id': '1', 'email': 'admin@example.com', 'username': 'admin'},
                'profile': {'username': 'admin', 'display_name': 'Admin', 'role': 'admin'},
            },
            ensure_ascii=False,
        )
        users = json.dumps(
            [
                {
                    'id': '1',
                    'email': 'admin@example.com',
                    'username': 'admin',
                    'passwordHash': 'YWRtaW4=',
                }
            ],
            ensure_ascii=False,
        )

        sqlite_store.write_database(
            {
                sqlite_store.STORAGE_KEYS['users']: users,
                sqlite_store.STORAGE_KEYS['session']: session,
            }
        )
        loaded = sqlite_store.read_database()
        self.assertIn(sqlite_store.STORAGE_KEYS['session'], loaded)

        # Old logout path: sync without the session key left the row intact.
        sqlite_store.write_database({sqlite_store.STORAGE_KEYS['users']: users})
        still_present = sqlite_store.read_database()
        self.assertIn(sqlite_store.STORAGE_KEYS['session'], still_present)

        # Fixed logout path: empty tombstone clears app_sessions.
        sqlite_store.write_database({sqlite_store.STORAGE_KEYS['session']: ''})
        cleared = sqlite_store.read_database()
        self.assertNotIn(sqlite_store.STORAGE_KEYS['session'], cleared)


if __name__ == '__main__':
    unittest.main()
