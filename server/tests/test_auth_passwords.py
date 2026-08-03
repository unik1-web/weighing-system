"""Unit tests for PBKDF2 password hashing and legacy btoa upgrade."""

import base64

from auth_passwords import (
    DEFAULT_ADMIN_PASSWORD,
    hash_password,
    is_legacy_btoa_hash,
    needs_rehash,
    validate_new_password,
    verify_password,
)


def test_hash_and_verify_roundtrip():
    stored = hash_password('secret-pass')
    assert stored.startswith('pbkdf2_sha256$')
    assert verify_password('secret-pass', stored)
    assert not verify_password('wrong', stored)


def test_legacy_btoa_accept():
    legacy = base64.b64encode(b'admin123').decode('ascii')
    assert is_legacy_btoa_hash(legacy)
    assert verify_password('admin123', legacy)
    assert not verify_password('other', legacy)
    assert needs_rehash(legacy)


def test_validate_new_password():
    assert validate_new_password('12345') is not None
    assert validate_new_password(DEFAULT_ADMIN_PASSWORD) is not None
    assert validate_new_password('secure1') is None
