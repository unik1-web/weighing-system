"""Backend parity tests against shared adapter fixture pack."""

from __future__ import annotations

import json
from pathlib import Path

from scale_registry import parse_reading


def _load_cases(file_name: str) -> list[dict]:
    fixtures_root = Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'scale-adapters'
    payload = json.loads((fixtures_root / file_name).read_text(encoding='utf-8'))
    return payload['cases']


def test_scale_adapter_parity_for_builtins():
    """Parity: backend built-in parsers match shared fixture expectations."""
    for case in _load_cases('builtin-readings.json'):
        actual = parse_reading(case['adapter_id'], case['raw'], case['connection'])
        assert actual == case['expected'], case['name']


def test_scale_adapter_parity_for_generic_regex():
    """Parity: backend generic-regex path matches shared fixture expectations."""
    for case in _load_cases('generic-regex.json'):
        actual = parse_reading(case['adapter_id'], case['raw'], case['connection'])
        expected = case['expected']
        if expected is None:
            assert actual is None, case['name']
        else:
            assert actual is not None, case['name']
            for key, value in expected.items():
                assert actual.get(key) == value, case['name']
