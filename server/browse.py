import os
import string
from typing import Any


def _normalize_path(path: str | None) -> str:
    if not path or not path.strip():
        if os.name == 'nt':
            return os.path.expanduser('~')
        return '/'

    cleaned = os.path.abspath(os.path.expandvars(path.strip()))
    if os.path.isfile(cleaned):
        return os.path.dirname(cleaned)
    return cleaned


def list_roots() -> list[dict[str, str]]:
    if os.name == 'nt':
        return [
            {'name': f'{drive}:', 'path': f'{drive}:\\'}
            for drive in string.ascii_uppercase
            if os.path.exists(f'{drive}:\\')
        ]
    return [{'name': '/', 'path': '/'}]


def browse_path(
    path: str | None,
    *,
    mode: str = 'file',
    extensions: list[str] | None = None,
) -> dict[str, Any]:
    current = _normalize_path(path)
    if not os.path.isdir(current):
        raise FileNotFoundError(f'Каталог не найден: {current}')

    parent = os.path.dirname(current.rstrip('\\/'))
    if not parent or parent == current:
        parent = ''

    directories: list[dict[str, str]] = []
    files: list[dict[str, str]] = []
    allowed_ext = {ext.lower() if ext.startswith('.') else f'.{ext.lower()}' for ext in (extensions or [])}

    try:
        entries = os.listdir(current)
    except PermissionError as exc:
        raise PermissionError(f'Нет доступа к каталогу: {current}') from exc

    for entry in sorted(entries, key=lambda value: value.lower()):
        full_path = os.path.join(current, entry)
        try:
            if os.path.isdir(full_path):
                directories.append({'name': entry, 'path': full_path})
                continue

            if mode != 'file':
                continue

            if allowed_ext:
                _, ext = os.path.splitext(entry)
                if ext.lower() not in allowed_ext:
                    continue

            files.append({'name': entry, 'path': full_path})
        except OSError:
            continue

    return {
        'current': current,
        'parent': parent,
        'roots': list_roots(),
        'directories': directories,
        'files': files,
        'mode': mode,
    }
