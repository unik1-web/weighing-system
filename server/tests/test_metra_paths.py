"""Metra Paradox DB path resolution (no pypxlib required)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

import metra


def test_resolve_metra_db_dir_empty_and_relative(temp_app_root, monkeypatch):
    monkeypatch.setattr(metra, 'get_app_root', lambda: str(temp_app_root))
    assert metra.resolve_metra_db_dir('  ') == ''
    assert metra.resolve_metra_db_dir('') == ''

    rel_dir = temp_app_root / 'MetraData'
    rel_dir.mkdir()
    resolved = metra.resolve_metra_db_dir('MetraData')
    assert Path(resolved) == rel_dir


def test_resolve_metra_db_dir_from_file_path(temp_app_root):
    db_dir = temp_app_root / 'metra'
    db_dir.mkdir()
    weights = db_dir / 'TWeights.db'
    weights.write_bytes(b'px')
    assert Path(metra.resolve_metra_db_dir(str(weights))) == db_dir


def test_resolve_metra_db_path_finds_case_variants(temp_app_root):
    db_dir = temp_app_root / 'm1'
    db_dir.mkdir()
    (db_dir / 'tweights.db').write_bytes(b'px')
    found = metra.resolve_metra_db_path(str(db_dir))
    assert Path(found).name.lower() == 'tweights.db'
    assert os.path.isfile(found)


def test_resolve_metra_db_path_prefers_explicit_absolute_file(temp_app_root):
    db_dir = temp_app_root / 'm2'
    db_dir.mkdir()
    explicit = db_dir / 'custom.db'
    explicit.write_bytes(b'px')
    (db_dir / 'TWeights.db').write_bytes(b'other')
    found = metra.resolve_metra_db_path(str(explicit))
    assert Path(found) == explicit.resolve()


def test_resolve_metra_db_path_missing_raises(temp_app_root):
    empty = temp_app_root / 'empty-metra'
    empty.mkdir()
    with pytest.raises(FileNotFoundError, match='TWeights\\.db'):
        metra.resolve_metra_db_path(str(empty))
