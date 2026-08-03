from datetime import datetime
from types import SimpleNamespace

from metra import (
    DEFAULT_LABEL,
    _clean_text,
    _looks_like_driver_name,
    _lookup_name,
    _resolve_cargo_name,
    _resolve_dictionary_path,
    _resolve_driver_name,
    _safe_timestamp,
)


class TestSafeTimestamp:
    def test_formats_valid_datetime(self):
        row = {'DT': datetime(2026, 7, 28, 10, 5, 9)}
        assert _safe_timestamp(row, 'DT') == '2026-07-28 10:05:09'

    def test_rejects_pre_1900_and_empty(self):
        assert _safe_timestamp({'DT': datetime(1899, 1, 1)}, 'DT') is None
        assert _safe_timestamp({'DT': None}, 'DT') is None
        assert _safe_timestamp({'DT': ''}, 'DT') is None

    def test_stringifies_non_datetime_and_swallows_errors(self):
        assert _safe_timestamp({'DT': '  raw  '}, 'DT') == '  raw  '
        assert _safe_timestamp(SimpleNamespace(), 'DT') is None


class TestCleanAndLookup:
    def test_clean_text_drops_undefined_and_keeps_names(self):
        assert _clean_text('Не определено') == ''
        assert _clean_text('  Песок  ') == 'Песок'
        assert _clean_text(None) == ''

    def test_lookup_name_handles_invalid_keys(self):
        mapping = {1: 'Песок', 2: 'не определено'}
        assert _lookup_name(mapping, 1) == 'Песок'
        assert _lookup_name(mapping, 2) == DEFAULT_LABEL
        assert _lookup_name(mapping, None) == DEFAULT_LABEL
        assert _lookup_name(mapping, 'bad') == DEFAULT_LABEL
        assert _lookup_name(mapping, 99, default='X') == 'X'


class TestDriverNameHeuristic:
    def test_accepts_person_like_names(self):
        assert _looks_like_driver_name('Иванов И.И.') is True
        assert _looks_like_driver_name('Петров Петр') is True

    def test_rejects_cargo_invoice_and_short_values(self):
        assert _looks_like_driver_name('груз песок') is False
        assert _looks_like_driver_name('накладная 12') is False
        assert _looks_like_driver_name('Иванов') is False
        assert _looks_like_driver_name('аб') is False
        assert _looks_like_driver_name('не определено') is False


class TestCargoAndDriverResolution:
    def test_cargo_prefers_operation_then_comment_then_merchant(self):
        dictionaries = {
            'operations': {1: 'Ввоз ТКО'},
            'merchants': {2: 'Песок'},
        }
        assert (
            _resolve_cargo_name({'OperNo': 1, 'MerchNo': 2, 'Comment': '', 'Comment2': ''}, dictionaries)
            == 'Ввоз ТКО'
        )
        assert (
            _resolve_cargo_name(
                {'OperNo': None, 'MerchNo': 2, 'Comment': 'Щебень', 'Comment2': ''},
                dictionaries,
            )
            == 'Щебень'
        )
        assert (
            _resolve_cargo_name(
                {'OperNo': None, 'MerchNo': 2, 'Comment': '', 'Comment2': ''},
                dictionaries,
            )
            == 'Песок'
        )
        assert (
            _resolve_cargo_name(
                {'OperNo': None, 'MerchNo': None, 'Comment': '', 'Comment2': ''},
                dictionaries,
            )
            == DEFAULT_LABEL
        )

    def test_driver_prefers_dictionary_then_comment_person(self):
        dictionaries = {'drivers': {7: 'Сидоров С.С.'}}
        fields = {'DriverNo', 'Comment', 'Comment2', 'Name1CID'}

        assert (
            _resolve_driver_name(
                {'DriverNo': 7, 'Comment': 'Иванов И.И.', 'Comment2': '', 'Name1CID': ''},
                fields,
                dictionaries,
            )
            == 'Сидоров С.С.'
        )
        assert (
            _resolve_driver_name(
                {'DriverNo': None, 'Comment': 'груз песок; Иванов И.И.', 'Comment2': '', 'Name1CID': ''},
                fields,
                dictionaries,
            )
            == 'Иванов И.И.'
        )
        assert (
            _resolve_driver_name(
                {'DriverNo': None, 'Comment': 'накладная 1', 'Comment2': '', 'Name1CID': ''},
                fields,
                dictionaries,
            )
            == DEFAULT_LABEL
        )


class TestResolveDictionaryPath:
    def test_case_insensitive_lookup(self, tmp_path):
        db_dir = tmp_path / 'metra'
        db_dir.mkdir()
        (db_dir / 'TypeMerc.db').write_bytes(b'')

        resolved = _resolve_dictionary_path(str(db_dir), 'TypeMerc.DB')
        assert resolved.endswith('TypeMerc.db')
        assert _resolve_dictionary_path(str(db_dir), 'Missing.DB').endswith('Missing.DB')
