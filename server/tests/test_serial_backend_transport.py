"""Unit tests for `SerialBackendTransport` error mapping."""

from __future__ import annotations

from scale_transports.serial_backend import SerialBackendError, SerialBackendTransport


class _FakeSerialHandle:
    def __init__(self, chunks: list[bytes] | None = None) -> None:
        self._chunks = list(chunks or [])
        self.timeout = 1.0
        self.closed = False

    def read(self, _size: int) -> bytes:
        if self.closed:
            raise RuntimeError('closed')
        if self._chunks:
            return self._chunks.pop(0)
        return b''

    def close(self) -> None:
        self.closed = True


class _FakeSerialModule:
    SEVENBITS = 7
    EIGHTBITS = 8
    STOPBITS_ONE = 1
    STOPBITS_TWO = 2
    PARITY_NONE = 'N'
    PARITY_EVEN = 'E'
    PARITY_ODD = 'O'

    def __init__(self, *, should_open_fail: bool = False, chunks: list[bytes] | None = None) -> None:
        self._should_open_fail = should_open_fail
        self._chunks = chunks or []

    def Serial(self, **_kwargs):  # noqa: N802 - pyserial compatibility
        if self._should_open_fail:
            raise RuntimeError('busy')
        return _FakeSerialHandle(self._chunks)


def _connection() -> dict:
    return {
        'transport': 'serial_backend',
        'serial': {
            'port': 'COM_TEST',
            'baud_rate': 9600,
            'data_bits': 7,
            'stop_bits': 1,
            'parity': 'even',
            'line_terminator': '\r\n',
            'read_timeout_ms': 20,
        },
    }


def test_serial_backend_read_line_maps_timeout(monkeypatch):
    """TC-UNIT-03: empty stream returns canonical read_timeout."""
    import scale_transports.serial_backend as transport_module

    monkeypatch.setattr(transport_module, 'serial', _FakeSerialModule(chunks=[]))
    transport = SerialBackendTransport()
    transport.open(_connection())
    try:
        transport.read_line(10)
        raise AssertionError('Expected SerialBackendError(read_timeout)')
    except SerialBackendError as exc:
        assert exc.code == 'read_timeout'


def test_serial_backend_open_maps_transport_unavailable(monkeypatch):
    """TC-UNIT-03: open errors map to transport_unavailable."""
    import scale_transports.serial_backend as transport_module

    monkeypatch.setattr(transport_module, 'serial', _FakeSerialModule(should_open_fail=True))
    transport = SerialBackendTransport()
    try:
        transport.open(_connection())
        raise AssertionError('Expected SerialBackendError(transport_unavailable)')
    except SerialBackendError as exc:
        assert exc.code == 'transport_unavailable'


def test_serial_backend_read_line_on_closed_handle(monkeypatch):
    """TC-UNIT-03: closed handle maps to transport_unavailable."""
    import scale_transports.serial_backend as transport_module

    monkeypatch.setattr(transport_module, 'serial', _FakeSerialModule(chunks=[b'S', b'T', b'\r', b'\n']))
    transport = SerialBackendTransport()
    transport.open(_connection())
    transport.close()
    try:
        transport.read_line(10)
        raise AssertionError('Expected SerialBackendError(transport_unavailable)')
    except SerialBackendError as exc:
        assert exc.code == 'transport_unavailable'
