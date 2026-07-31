"""Serial transport driver for backend runtime sessions."""

from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Any

try:  # pragma: no cover - import error path covered by tests via monkeypatch
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None


@dataclass
class SerialBackendError(Exception):
    """Typed transport exception with API error metadata."""

    code: str
    message: str
    http_status: int


class SerialBackendTransport:
    """Read line-delimited frames from COM/TTY via `pyserial`."""

    def __init__(self) -> None:
        self._handle: Any | None = None
        self._line_terminator = '\n'
        self._default_timeout_ms = 1000

    def open(self, connection: dict[str, Any]) -> None:
        """Open serial port using runtime connection config."""
        serial_cfg = connection.get('serial') if isinstance(connection.get('serial'), dict) else {}
        port = str(serial_cfg.get('port') or '').strip()
        if not port:
            raise SerialBackendError('invalid_connection_config', 'Не задан serial.port', 422)
        if serial is None:
            raise SerialBackendError('transport_unavailable', 'Модуль pyserial не установлен', 503)

        baud_rate = int(serial_cfg.get('baud_rate') or 9600)
        data_bits = int(serial_cfg.get('data_bits') or 8)
        stop_bits = int(serial_cfg.get('stop_bits') or 1)
        parity = str(serial_cfg.get('parity') or 'none').lower()
        self._line_terminator = str(serial_cfg.get('line_terminator') or '\n')
        self._default_timeout_ms = int(serial_cfg.get('read_timeout_ms') or 1000)

        bytesize_map = {
            7: serial.SEVENBITS,
            8: serial.EIGHTBITS,
        }
        stop_bits_map = {
            1: serial.STOPBITS_ONE,
            2: serial.STOPBITS_TWO,
        }
        parity_map = {
            'none': serial.PARITY_NONE,
            'even': serial.PARITY_EVEN,
            'odd': serial.PARITY_ODD,
        }
        if data_bits not in bytesize_map or stop_bits not in stop_bits_map or parity not in parity_map:
            raise SerialBackendError('invalid_connection_config', 'Некорректные serial параметры', 422)

        try:
            self._handle = serial.Serial(
                port=port,
                baudrate=baud_rate,
                bytesize=bytesize_map[data_bits],
                stopbits=stop_bits_map[stop_bits],
                parity=parity_map[parity],
                timeout=max(self._default_timeout_ms, 1) / 1000.0,
            )
        except Exception as exc:
            raise SerialBackendError('transport_unavailable', 'Не удалось открыть serial порт', 503) from exc

    def read_line(self, timeout_ms: int) -> str:
        """Read one terminated text frame within timeout."""
        if self._handle is None:
            raise SerialBackendError('transport_unavailable', 'Serial порт не открыт', 503)

        effective_timeout_ms = timeout_ms if timeout_ms > 0 else self._default_timeout_ms
        deadline = monotonic() + (effective_timeout_ms / 1000.0)
        buffer = bytearray()
        terminator = self._line_terminator.encode('utf-8')

        try:
            while monotonic() < deadline:
                if hasattr(self._handle, 'timeout'):
                    self._handle.timeout = max(deadline - monotonic(), 0.001)
                chunk = self._handle.read(1)
                if not chunk:
                    continue
                buffer.extend(chunk)
                if terminator and buffer.endswith(terminator):
                    frame = bytes(buffer[: -len(terminator)]).decode('utf-8', errors='replace').strip()
                    if frame:
                        return frame
                    buffer.clear()
                elif not terminator and chunk in (b'\n', b'\r'):
                    frame = bytes(buffer).decode('utf-8', errors='replace').strip()
                    if frame:
                        return frame
                    buffer.clear()
        except Exception as exc:
            raise SerialBackendError('transport_unavailable', 'Ошибка чтения serial порта', 503) from exc

        raise SerialBackendError('read_timeout', 'За отведённое время не получено валидное показание.', 504)

    def close(self) -> None:
        """Close serial handle if opened."""
        if self._handle is None:
            return
        try:
            self._handle.close()
        finally:
            self._handle = None
