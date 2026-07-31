"""Contract tests for shared scale adapter registry manifest."""

from __future__ import annotations

from scale_registry import (
    get_adapter_schema,
    list_adapters,
    load_adapter_catalog,
    load_registry_contract_status,
    parse_reading,
    validate_connection,
    validate_draft,
)
from scale_registry_contract import load_catalog_contract, run_builtin_parity_check


def test_frontend_backend_adapter_ids_and_version_match_manifest():
    """TC-UNIT-01: manifest ids/version are stable and complete."""
    listed = list_adapters()
    ids = sorted(item['id'] for item in listed['adapters'])
    assert ids == sorted(
        ['microsim-m0601', 'newton', 'cas', 'midl-mi-vda', 'generic-regex']
    )
    assert listed['adapter_schema_version'] == '1.0'


def test_backend_schema_for_generic_regex_contains_parser_and_serial_fields():
    """TC-UNIT-02: generic-regex schema exposes parser + serial fields."""
    schema = get_adapter_schema('generic-regex', 'serial_backend')
    assert 'serial.port' in schema['transport_fields']
    assert 'parser.pattern' in schema['parser_fields']
    assert 'parser.validation_status' in schema['parser_fields']


def test_catalog_loaders_read_same_manifest():
    """TC-UNIT-03: both loaders read one shared manifest."""
    left = load_adapter_catalog()
    right = load_catalog_contract()
    assert left['adapter_schema_version'] == right['adapter_schema_version']
    assert sorted(item['id'] for item in left['adapters']) == sorted(
        item['id'] for item in right['adapters']
    )


def test_stub_registry_e2e_flow():
    """TC-E2E-01: list -> schema -> validate -> parse returns built-in reading."""
    listed = list_adapters()
    assert listed['adapter_schema_version'] == '1.0'

    schema = get_adapter_schema('cas', 'web_serial')
    assert 'parser.kind' in schema['parser_fields']

    draft = {'transport': 'web_serial', 'device_id': 'cas'}
    validation = validate_draft('cas', draft)
    assert validation['valid'] is True
    assert validation['errors'] == []

    reading = parse_reading('cas', 'ST,GS,+00045.0kg\r\n', {'transport': 'web_serial', 'device_id': 'cas'})
    assert reading is not None
    assert reading['value'] == 45.0
    assert reading['stable'] is True
    assert reading['raw'] == 'ST,GS,+00045.0kg'

    status = load_registry_contract_status()
    assert status['ok'] is True


def test_validate_connection_reports_builtin_mismatch():
    """TC-UNIT: built-in mismatch returns validation errors."""
    errors = validate_connection(
        'newton',
        {'transport': 'web_serial', 'device_id': 'cas'},
    )
    assert errors == [{'code': 'device_id_mismatch:newton'}]


def test_run_builtin_parity_check_green():
    """TC-UNIT-03: frontend/backend built-in parity fixture is green."""
    from pathlib import Path

    fixtures_path = (
        Path(__file__).resolve().parents[2]
        / 'tests'
        / 'fixtures'
        / 'scale-adapters'
        / 'builtin-readings.json'
    )
    mismatches = run_builtin_parity_check(str(fixtures_path))
    assert mismatches == []
