from types import SimpleNamespace

from config_ini import dump_ini, parse_ini, read_ini_section, write_ini_section
from reo_client import (
    build_reo_test_payload,
    format_reo_error,
    is_reo_test_successful,
)
from metra import _to_kg, resolve_metra_db_dir, resolve_metra_db_path
from vescom import _format_datetime, _tara_to_kg, _weight_to_kg


class TestConfigIni:
    def test_dump_and_parse_roundtrip(self):
        text = dump_ini(
            {
                'settings': {'org_name': 'Полигон', 'reo_enabled': True},
                'backup': {'version': 3},
            }
        )
        parsed = parse_ini(text)
        assert parsed['settings']['org_name'] == 'Полигон'
        assert parsed['settings']['reo_enabled'] == 'True'
        assert parsed['backup']['version'] == '3'

    def test_write_and_read_section_preserves_other_sections(self, tmp_path):
        path = tmp_path / 'config.ini'
        write_ini_section(str(path), 'settings', {'a': 1})
        write_ini_section(str(path), 'backup', {'version': 3})
        write_ini_section(str(path), 'settings', {'a': 2, 'b': 'x'})

        assert read_ini_section(str(path), 'settings') == {'a': '2', 'b': 'x'}
        assert read_ini_section(str(path), 'backup') == {'version': '3'}
        assert read_ini_section(str(path), 'missing') == {}
        assert read_ini_section(str(tmp_path / 'absent.ini'), 'settings') == {}


class TestReoClient:
    def test_build_test_payload(self):
        assert build_reo_test_payload('obj-1', 'key-2') == {
            'objectId': 'obj-1',
            'accessKey': 'key-2',
            'weightControls': [],
        }

    def test_connection_check_treats_422_as_success(self):
        assert is_reo_test_successful(SimpleNamespace(status_code=200)) is True
        assert is_reo_test_successful(SimpleNamespace(status_code=422)) is True
        assert is_reo_test_successful(SimpleNamespace(status_code=500)) is False

    def test_format_error_truncates_long_body(self):
        long_body = 'x' * 600
        message = format_reo_error(SimpleNamespace(status_code=500, text=long_body))
        assert message.startswith('HTTP 500:')
        assert message.endswith('...')
        assert len(message) < 550

    def test_format_error_empty_body(self):
        assert format_reo_error(SimpleNamespace(status_code=404, text='')) == 'HTTP 404'


class TestMetraWeightHelpers:
    def test_to_kg_converts_tons_and_rejects_non_positive(self):
        assert _to_kg(12.345) == 12345
        assert _to_kg(0) is None
        assert _to_kg(-1) is None
        assert _to_kg(None) is None

    def test_resolve_metra_paths(self, tmp_path):
        db_dir = tmp_path / 'metra'
        db_dir.mkdir()
        db_file = db_dir / 'TWeights.db'
        db_file.write_bytes(b'')

        assert resolve_metra_db_dir(str(db_dir)) == str(db_dir)
        assert resolve_metra_db_dir(str(db_file)) == str(db_dir)
        assert resolve_metra_db_path(str(db_dir)) == str(db_file)
        assert resolve_metra_db_path(str(db_file)) == str(db_file)
        assert resolve_metra_db_dir('   ') == ''


class TestVescomWeightHelpers:
    def test_weight_to_kg_treats_small_values_as_tons(self):
        assert _weight_to_kg(12.5) == 12500
        assert _weight_to_kg(12500) == 12500
        assert _weight_to_kg(0) is None
        assert _weight_to_kg('bad') is None

    def test_tara_to_kg_matches_weight_conversion(self):
        assert _tara_to_kg(8.2) == 8200
        assert _tara_to_kg(8200) == 8200
        assert _tara_to_kg(None) is None

    def test_format_datetime(self):
        from datetime import datetime

        assert _format_datetime(datetime(2026, 7, 28, 10, 5, 9)) == '2026-07-28 10:05:09'
        assert _format_datetime(None) == ''
        assert _format_datetime('  raw  ') == 'raw'
