"""Unit tests for backend scale frame parsers (mirror of frontend parse.ts)."""

from __future__ import annotations

import pytest

from scale_io import (
    normalize_adapter_id,
    parse_custom_frame,
    parse_frame,
    parse_mask_frame,
    parse_universal_frame,
)


def test_normalize_adapter_id_known_and_fallback():
    assert normalize_adapter_id('cas') == 'cas'
    assert normalize_adapter_id('custom') == 'custom'
    assert normalize_adapter_id('unknown') == 'microsim-m0601'
    assert normalize_adapter_id(None) == 'microsim-m0601'
    assert normalize_adapter_id(1) == 'microsim-m0601'


def test_parse_universal_stable_and_unstable():
    stable = parse_universal_frame('ST,GS,+  12345 kg')
    assert stable is not None
    assert stable['weight'] == 12345.0
    assert stable['unit'] == 'kg'
    assert stable['stable'] is True
    assert stable['negative'] is False

    unstable = parse_universal_frame('US,GS,  980.5kg')
    assert unstable is not None
    assert unstable['weight'] == 980.5
    assert unstable['stable'] is False


def test_parse_universal_negative_and_spaces():
    negative = parse_universal_frame('ST,GS,-00123 kg')
    assert negative is not None
    assert negative['weight'] == -123.0
    assert negative['negative'] is True

    spaced = parse_universal_frame('  12 345,5 kg')
    assert spaced is not None
    assert spaced['weight'] == 12345.5


def test_parse_universal_rejects_non_numeric():
    assert parse_universal_frame('ST,GS, ready') is None
    assert parse_universal_frame('') is None


def test_parse_mask_frame():
    parsed = parse_mask_frame('WT:1234.5kg', 'WT:####.#kg')
    assert parsed is not None
    assert parsed['weight'] == 1234.5
    assert parse_mask_frame('WT:1234.5kg', '') is None
    assert parse_mask_frame('nope', 'WT:####') is None


def test_parse_custom_named_group_and_sign():
    connection = {
        'parseRegex': r'(?P<sign>[-+]?)(?P<weight>\d+[.,]?\d*)\s*(?P<unit>kg|t)?',
        'parseSignGroup': 'sign',
        'parseUnitGroup': 'unit',
    }
    parsed = parse_custom_frame('-1500,5 kg', connection)
    assert parsed is not None
    assert parsed['weight'] == -1500.5
    assert parsed['unit'] == 'kg'
    assert parsed['negative'] is True


def test_parse_custom_requires_regex_or_mask():
    with pytest.raises(ValueError, match='regex или маску'):
        parse_custom_frame('1234', {})


def test_parse_frame_routes_custom_vs_builtin():
    universal = parse_frame('cas', 'ST,GS,100 kg', {})
    assert universal is not None
    assert universal['weight'] == 100.0

    custom = parse_frame(
        'custom',
        'W=2500',
        {'parseRegex': r'W=(?P<weight>\d+)'},
    )
    assert custom is not None
    assert custom['weight'] == 2500.0

    # Unknown adapter id falls back to microsim universal parser
    fallback = parse_frame('nope', '500', {})
    assert fallback is not None
    assert fallback['weight'] == 500.0
