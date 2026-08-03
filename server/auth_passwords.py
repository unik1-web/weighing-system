"""Password hashing: PBKDF2-HMAC-SHA256 with transparent legacy btoa upgrade."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Final

PBKDF2_PREFIX: Final = 'pbkdf2_sha256'
PBKDF2_ITERATIONS: Final = 260_000
SALT_BYTES: Final = 16
DK_BYTES: Final = 32

DEFAULT_ADMIN_USERNAME: Final = 'admin'
DEFAULT_ADMIN_PASSWORD: Final = 'admin123'


def hash_password(password: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    if not isinstance(password, str):
        raise TypeError('password must be str')
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations, dklen=DK_BYTES)
    return (
        f'{PBKDF2_PREFIX}${iterations}$'
        f'{base64.b64encode(salt).decode("ascii")}$'
        f'{base64.b64encode(dk).decode("ascii")}'
    )


def is_legacy_btoa_hash(stored: str | None) -> bool:
    if not stored or not isinstance(stored, str):
        return False
    return not stored.startswith(f'{PBKDF2_PREFIX}$')


def needs_rehash(stored: str | None) -> bool:
    if not stored:
        return True
    if is_legacy_btoa_hash(stored):
        return True
    parts = stored.split('$')
    if len(parts) != 4 or parts[0] != PBKDF2_PREFIX:
        return True
    try:
        iterations = int(parts[1])
    except ValueError:
        return True
    return iterations < PBKDF2_ITERATIONS


def _verify_pbkdf2(password: str, stored: str) -> bool:
    parts = stored.split('$')
    if len(parts) != 4 or parts[0] != PBKDF2_PREFIX:
        return False
    try:
        iterations = int(parts[1])
        salt = base64.b64decode(parts[2])
        expected = base64.b64decode(parts[3])
    except (ValueError, TypeError):
        return False
    dk = hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), salt, iterations, dklen=len(expected)
    )
    return hmac.compare_digest(dk, expected)


def _btoa_encode(password: str) -> str:
    """Match browser btoa for ASCII/latin1-compatible passwords."""
    try:
        raw = password.encode('latin-1')
    except UnicodeEncodeError:
        raw = password.encode('utf-8')
    return base64.b64encode(raw).decode('ascii')


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not isinstance(stored, str):
        return False
    if is_legacy_btoa_hash(stored):
        return hmac.compare_digest(_btoa_encode(password), stored)
    return _verify_pbkdf2(password, stored)


def validate_new_password(password: str) -> str | None:
    """Return error message or None if ok."""
    if not isinstance(password, str) or len(password) < 6:
        return 'Пароль должен быть не короче 6 символов'
    if password == DEFAULT_ADMIN_PASSWORD:
        return 'Нельзя использовать пароль по умолчанию'
    return None
