"""Backend scale I/O: TCP transport + parser mirror + process singleton session."""

from __future__ import annotations

import json
import logging
import re
import socket
import threading
import time
from typing import Any, Optional

logger = logging.getLogger('weighing-system')

BUILTIN_ADAPTER_IDS = frozenset(
    {'microsim-m0601', 'newton', 'cas', 'midl-mi-vda', 'custom'}
)

DEFAULT_FRAMING = {
    'microsim-m0601': {
        'baudRate': 9600,
        'parity': 'none',
        'dataBits': 8,
        'stopBits': 1,
        'lineTerminator': '\r',
    },
    'newton': {
        'baudRate': 9600,
        'parity': 'none',
        'dataBits': 8,
        'stopBits': 1,
        'lineTerminator': '\r\n',
    },
    'cas': {
        'baudRate': 9600,
        'parity': 'even',
        'dataBits': 7,
        'stopBits': 1,
        'lineTerminator': '\r\n',
    },
    'midl-mi-vda': {
        'baudRate': 9600,
        'parity': 'none',
        'dataBits': 8,
        'stopBits': 1,
        'lineTerminator': '\r\n',
    },
    'custom': {
        'baudRate': 9600,
        'parity': 'none',
        'dataBits': 8,
        'stopBits': 1,
        'lineTerminator': '\r\n',
    },
}


def normalize_adapter_id(raw: Any) -> str:
    if isinstance(raw, str) and raw in BUILTIN_ADAPTER_IDS:
        return raw
    return 'microsim-m0601'


def parse_universal_frame(raw: str) -> Optional[dict[str, Any]]:
    """Mirror of JS parseUniversalFrame — priority = current JS behaviour."""
    original = raw
    s = raw
    stable = True
    negative = False
    upper = s.upper()

    if re.search(r'\b(US|MOT|UNST)\b', upper[:6], re.I):
        stable = False
        s = re.sub(r'^[A-Z]{2,3}\s*,?\s*', '', s, count=1, flags=re.I)
    elif re.search(r'\b(ST|STB|STABLE)\b', upper[:8], re.I):
        stable = True
        s = re.sub(r'^[A-Z]{2,4}\s*,?\s*', '', s, count=1, flags=re.I)

    s = re.sub(r'^(GS|NT|GROSS|NET)\s*,?\s*', '', s, count=1, flags=re.I)

    if '-' in s:
        negative = True
        s = s.replace('-', ' ', 1)
    s = s.replace('+', ' ').strip()

    unit = 'kg'
    unit_match = re.search(r'(kg|g|t|lb|kn|n)$', s, re.I)
    if unit_match:
        unit = unit_match.group(1).lower()
        s = s[: unit_match.start()].strip()

    num_match = re.search(r'-?\d[\d.,\s]*\d|\d', s)
    if not num_match:
        return None

    num_str = num_match.group(0).replace(' ', '').replace(',', '.')
    try:
        weight = float(num_str)
    except ValueError:
        return None

    return {
        'weight': -abs(weight) if negative else weight,
        'unit': unit,
        'stable': stable,
        'negative': negative,
        'raw': original,
    }


def parse_mask_frame(raw: str, mask: str) -> Optional[dict[str, Any]]:
    if not mask or not mask.strip():
        return None
    pattern_parts: list[str] = []
    for ch in mask:
        if ch == '#':
            pattern_parts.append(r'\d')
        elif ch == '*':
            pattern_parts.append(r'\d*')
        elif ch == '.':
            pattern_parts.append(r'[.,]')
        else:
            pattern_parts.append(re.escape(ch))
    pattern = ''.join(pattern_parts)
    try:
        m = re.search(pattern, raw)
    except re.error:
        return None
    if not m:
        return None
    num_match = re.search(r'-?\d[\d.,]*\d|-?\d', m.group(0))
    if not num_match:
        return None
    num_str = num_match.group(0).replace(',', '.')
    try:
        weight = float(num_str)
    except ValueError:
        return None
    return {
        'weight': weight,
        'unit': 'kg',
        'stable': True,
        'negative': weight < 0,
        'raw': raw,
    }


def parse_custom_frame(raw: str, connection: dict[str, Any]) -> Optional[dict[str, Any]]:
    regex_src = (connection.get('parseRegex') or '').strip()
    mask = (connection.get('parseMask') or '').strip()
    if not regex_src and not mask:
        raise ValueError('Задайте regex или маску разбора веса')

    if regex_src:
        try:
            re_obj = re.compile(regex_src)
        except re.error as exc:
            raise ValueError(f'Некорректное регулярное выражение: {exc}') from exc
        m = re_obj.search(raw)
        if not m:
            return None
        groups = m.groupdict() if m.groupdict() else {}
        weight_raw = groups.get('weight')
        if weight_raw is None and m.lastindex:
            weight_raw = m.group(1)
        if weight_raw is None or weight_raw == '':
            return None
        num_str = str(weight_raw).replace(' ', '').replace(',', '.')
        try:
            weight = float(num_str)
        except ValueError:
            return None

        sign_key = connection.get('parseSignGroup') or 'sign'
        sign_group = groups.get(sign_key)
        negative = weight < 0
        if sign_group is not None and '-' in str(sign_group):
            negative = True

        unit_key = connection.get('parseUnitGroup') or 'unit'
        unit = (groups.get(unit_key) or 'kg').lower()

        stable = True
        stable_key = connection.get('parseStableGroup') or 'stable'
        stable_group = groups.get(stable_key)
        if stable_group is not None:
            u = str(stable_group).upper()
            if re.search(r'\b(US|MOT|UNST|UNSTABLE)\b', u) or u in ('US', 'MOT', '0', 'FALSE'):
                stable = False
            elif re.search(r'\b(ST|STB|STABLE)\b', u) or u in ('ST', 'STB'):
                stable = True

        return {
            'weight': -abs(weight) if negative else abs(weight),
            'unit': unit,
            'stable': stable,
            'negative': negative,
            'raw': raw,
        }

    return parse_mask_frame(raw, mask)


def parse_frame(adapter_id: str, line: str, connection: dict[str, Any]) -> Optional[dict[str, Any]]:
    aid = normalize_adapter_id(adapter_id)
    if aid == 'custom':
        return parse_custom_frame(line, connection)
    return parse_universal_frame(line)


def _load_json_key(data: dict[str, Any], key: str) -> Any:
    raw = data.get(key)
    if raw is None:
        return None
    if isinstance(raw, (list, dict)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
    return None


def get_active_scale_context_from_db() -> dict[str, Any]:
    """Mirror getActiveScaleContext using SQLite app_* keys."""
    from sqlite_store import read_database

    data = read_database()
    sites = _load_json_key(data, 'app_sites') or []
    scales = _load_json_key(data, 'app_scales') or []
    runtimes = _load_json_key(data, 'app_site_runtime') or []

    if not isinstance(sites, list) or not sites:
        raise ValueError('Активный комплект весов не найден')

    site = next((s for s in sites if s.get('is_default')), sites[0])
    site_id = site.get('id')
    runtime = next((r for r in runtimes if r.get('site_id') == site_id), None)
    active_set = (runtime or {}).get('active_scale_set') or 'primary'

    site_scales = [s for s in scales if s.get('site_id') == site_id]
    active = next(
        (s for s in site_scales if s.get('role') == active_set and s.get('enabled')),
        None,
    )
    if active is None:
        active = next((s for s in site_scales if s.get('role') == 'primary'), None)
    if active is None:
        raise ValueError('Активный комплект весов не найден')

    adapter_id = normalize_adapter_id(active.get('adapter_id'))
    connection = active.get('connection') if isinstance(active.get('connection'), dict) else {}
    defaults = DEFAULT_FRAMING.get(adapter_id, DEFAULT_FRAMING['microsim-m0601'])
    merged = {**defaults, **connection}
    if not merged.get('transport'):
        merged['transport'] = 'web_serial'

    return {
        'site_id': site_id,
        'scale_id': active.get('id'),
        'scale_role': active.get('role') or active_set,
        'adapter_id': adapter_id,
        'connection': merged,
        'transport': merged.get('transport') or 'web_serial',
    }


class ScaleBackendSession:
    """Thread-safe process singleton for backend scale transport."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._connected = False
        self._adapter_id: Optional[str] = None
        self._scale_id: Optional[str] = None
        self._transport: Optional[str] = None
        self._connection: dict[str, Any] = {}
        self._last_reading: Optional[dict[str, Any]] = None
        self._error: Optional[str] = None
        self._sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                'connected': self._connected,
                'adapter_id': self._adapter_id,
                'scale_id': self._scale_id,
                'transport': self._transport,
                'last_reading': self._last_reading,
                'error': self._error,
            }

    def reading(self) -> dict[str, Any]:
        with self._lock:
            return {
                'reading': self._last_reading,
                'connected': self._connected,
            }

    def disconnect(self) -> None:
        with self._lock:
            self._stop.set()
            sock = self._sock
            self._sock = None
            self._connected = False
            self._adapter_id = None
            self._scale_id = None
            self._transport = None
            self._connection = {}
            self._last_reading = None
            self._error = None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)
        self._thread = None
        self._stop.clear()

    def connect(self, overrides: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        overrides = overrides or {}
        ctx = get_active_scale_context_from_db()
        transport = ctx['transport'] or 'web_serial'
        if transport == 'web_serial':
            raise ValueError('Транспорт web_serial доступен только в браузере')
        if transport == 'serial':
            # Stub — not implemented in MVP
            err = 'Транспорт serial (COM) пока не реализован'
            raise NotImplementedError(err)

        if transport != 'tcp':
            raise ValueError(f'Неизвестный транспорт: {transport}')

        connection = dict(ctx['connection'])
        if overrides.get('host'):
            connection['host'] = overrides['host']
        if overrides.get('tcpPort') is not None:
            connection['tcpPort'] = overrides['tcpPort']
        if overrides.get('serialPath'):
            connection['serialPath'] = overrides['serialPath']

        host = connection.get('host') or '127.0.0.1'
        port = int(connection.get('tcpPort') or 9001)
        adapter_id = ctx['adapter_id']

        if adapter_id == 'custom':
            regex_src = (connection.get('parseRegex') or '').strip()
            mask = (connection.get('parseMask') or '').strip()
            if not regex_src and not mask:
                raise ValueError('Задайте regex или маску разбора веса')
            if regex_src:
                try:
                    re.compile(regex_src)
                except re.error as exc:
                    raise ValueError(f'Некорректное регулярное выражение: {exc}') from exc

        self.disconnect()

        sock = socket.create_connection((host, port), timeout=5.0)
        sock.settimeout(1.0)

        with self._lock:
            self._sock = sock
            self._connected = True
            self._adapter_id = adapter_id
            self._scale_id = ctx['scale_id']
            self._transport = 'tcp'
            self._connection = connection
            self._last_reading = None
            self._error = None
            self._stop.clear()

        self._thread = threading.Thread(
            target=self._read_loop,
            name='scale-tcp-reader',
            daemon=True,
        )
        self._thread.start()
        logger.info('Scale TCP connected to %s:%s adapter=%s', host, port, adapter_id)
        return {
            'connected': True,
            'adapter_id': adapter_id,
            'transport': 'tcp',
        }

    def _read_loop(self) -> None:
        term = (self._connection.get('lineTerminator') or '\r\n')
        buffer = ''
        sock = self._sock
        if sock is None:
            return
        while not self._stop.is_set():
            try:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buffer += chunk.decode('utf-8', errors='replace')
                while True:
                    idx = buffer.find(term)
                    if idx == -1:
                        break
                    line = buffer[:idx].strip()
                    buffer = buffer[idx + len(term) :]
                    if not line:
                        continue
                    try:
                        reading = parse_frame(self._adapter_id or 'microsim-m0601', line, self._connection)
                    except ValueError as exc:
                        with self._lock:
                            self._error = str(exc)
                        continue
                    if reading:
                        with self._lock:
                            self._last_reading = reading
                            self._error = None
            except socket.timeout:
                continue
            except OSError as exc:
                with self._lock:
                    self._error = f'Ошибка TCP: {exc}'
                    self._connected = False
                break
        with self._lock:
            self._connected = False
        logger.info('Scale TCP read loop ended')


_session = ScaleBackendSession()


def get_scale_session() -> ScaleBackendSession:
    return _session
