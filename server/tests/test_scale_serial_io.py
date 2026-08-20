"""Serial buffer splitting and port listing."""

from scale_io import (
    ScaleBackendSession,
    decode_poll_command,
    list_serial_ports,
    normalize_serial_path,
    parse_microsim_copy,
)


def test_decode_poll_command():
    assert decode_poll_command('$') == b'$'
    assert decode_poll_command('$\\r') == b'$\r'
    assert decode_poll_command('\\x05') == b'\x05'


def test_parse_microsim_copy_stable():
    raw = bytes.fromhex('81 20 20 31 37 32 2E 36 30 20 42 20 20 0D 0A').decode('latin-1')
    reading = parse_microsim_copy(raw)
    assert reading is not None
    assert reading['weight'] == 172.6
    assert reading['stable'] is True


def test_parse_microsim_copy_unstable():
    raw = bytes.fromhex('81 20 20 20 20 30 2E 30 30 3F 4E 20 20 0D 0A').decode('latin-1')
    reading = parse_microsim_copy(raw)
    assert reading is not None
    assert reading['weight'] == 0.0
    assert reading['stable'] is False


def test_normalize_serial_path_com3():
    assert normalize_serial_path('com 3') == 'COM3'


def test_extract_lines_falls_back_to_cr():
    session = ScaleBackendSession()
    session._transport = 'serial'
    session._connection = {'lineTerminator': '\r\n'}
    session._adapter_id = 'microsim-m0601'

    lines, rest = session._extract_lines('ST,+12345.6kg\r')
    assert lines == ['ST,+12345.6kg']
    assert rest == ''


def test_try_parse_tail_without_terminator():
    session = ScaleBackendSession()
    session._transport = 'serial'
    session._connection = {'lineTerminator': '\r'}
    session._adapter_id = 'microsim-m0601'

    rest = session._try_parse_tail('ST,GS,+  12345.6kg')
    assert rest == ''
    assert session._last_reading is not None
    assert session._last_reading['weight'] == 12345.6


def test_list_serial_ports_returns_list():
    ports = list_serial_ports()
    assert isinstance(ports, list)
