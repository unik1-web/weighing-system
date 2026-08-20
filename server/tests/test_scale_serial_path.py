from scale_io import normalize_serial_path


def test_normalize_serial_path_windows():
    assert normalize_serial_path('com 3') == 'COM3'
    assert normalize_serial_path('COM3') == 'COM3'
    assert normalize_serial_path(' com 3 ') == 'COM3'
    assert normalize_serial_path('COM 3') == 'COM3'
    assert normalize_serial_path('com3') == 'COM3'


def test_normalize_serial_path_linux_unchanged():
    assert normalize_serial_path('/dev/ttyUSB0') == '/dev/ttyUSB0'
