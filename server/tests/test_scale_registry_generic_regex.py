"""Backend tests for generic-regex portable validation and runtime parse."""

from __future__ import annotations

from copy import deepcopy

from scale_registry import parse_reading, validate_connection
from scale_registry_contract import validate_portable_regex


def _base_connection() -> dict:
    return {
        'transport': 'serial_backend',
        'device_id': None,
        'parser': {
            'kind': 'regex',
            'pattern': r'^(ST|US)\s+(-?\d+[\.,]?\d*)\s*(kg)?$',
            'flags': 'i',
            'weight_group': 2,
            'stability_group': 1,
            'stable_values': ['ST'],
            'unstable_values': ['US'],
            'unit_group': 3,
            'test_frame': 'ST 25340 kg',
        },
    }


def test_validate_portable_regex_preview_validated():
    """TC-E2E-01: config with test_frame is preview_validated."""
    connection = _base_connection()
    result = validate_portable_regex(connection, connection['parser']['test_frame'])
    assert result['valid'] is True
    assert result['validation_status'] == 'preview_validated'
    assert result['preview_reading']['value'] == 25340


def test_validate_portable_regex_pending_runtime_without_test_frame():
    """TC-E2E-02: config without test_frame is pending_runtime."""
    connection = _base_connection()
    connection['parser']['test_frame'] = None
    result = validate_portable_regex(connection, None)
    assert result['valid'] is True
    assert result['validation_status'] == 'pending_runtime'


def test_validate_portable_regex_non_portable_rejected():
    """TC-UNIT-01: named groups are rejected as non-portable."""
    connection = _base_connection()
    connection['parser']['pattern'] = r'^(?<state>ST|US)\s+(\d+)$'
    result = validate_portable_regex(connection, connection['parser']['test_frame'])
    assert result['valid'] is False
    assert result['validation_error_code'] == 'regex_non_portable'


def test_validate_portable_regex_length_limits():
    """TC-UNIT-02: backend returns canonical codes for pattern/test frame limits."""
    connection = _base_connection()
    connection['parser']['pattern'] = f"^{'1' * 513}$"
    pattern_result = validate_portable_regex(connection, connection['parser']['test_frame'])
    assert pattern_result['validation_error_code'] == 'regex_pattern_too_long'

    connection = _base_connection()
    frame_result = validate_portable_regex(connection, '1' * 4097)
    assert frame_result['validation_error_code'] == 'regex_test_frame_too_large'


def test_validate_connection_applies_parser_status():
    """TC-UNIT: validate_connection writes parser validation metadata."""
    connection = _base_connection()
    errors = validate_connection('generic-regex', connection)
    assert errors == []
    assert connection['parser']['validation_status'] == 'preview_validated'
    assert connection['parser']['validation_error_code'] is None
    assert connection['parser']['last_validation_at']


def test_parse_generic_regex_runtime_frame_limit():
    """TC-UNIT-03: runtime frame >1024 is rejected before parsing."""
    connection = _base_connection()
    connection['parser'].pop('test_frame', None)
    parsed = parse_reading('generic-regex', '1' * 1025, connection)
    assert parsed is None
    assert connection['parser']['validation_status'] == 'runtime_failed'
    assert connection['parser']['validation_error_code'] == 'runtime_frame_too_large'


def test_parse_generic_regex_runtime_mismatch():
    """TC-E2E-03: mismatch does not publish reading and marks parser failed."""
    connection = _base_connection()
    connection['parser'].pop('test_frame', None)
    parsed = parse_reading('generic-regex', 'XX invalid frame', connection)
    assert parsed is None
    assert connection['parser']['validation_status'] == 'runtime_failed'
    assert connection['parser']['validation_error_message'] == 'parse_mismatch'


def test_parse_generic_regex_runtime_success():
    """TC-UNIT: runtime parse extracts weight and updates runtime_validated."""
    connection = _base_connection()
    connection['parser'].pop('test_frame', None)
    parsed = parse_reading('generic-regex', 'US 100.5 kg', deepcopy(connection))
    assert parsed is not None
    assert parsed['value'] == 100.5
    assert parsed['stable'] is False
