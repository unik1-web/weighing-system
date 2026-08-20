"""Serial buffer splitting and port listing."""

from scale_io import ScaleBackendSession, list_serial_ports, normalize_serial_path


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
