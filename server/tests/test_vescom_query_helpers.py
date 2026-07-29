import pytest

from vescom import (
    _build_weighing_date_filter,
    _datetime_expression,
    _parse_weighing_target_date,
    _pick_column,
)


class TestPickColumn:
    def test_prefers_first_matching_name_case_insensitively(self):
        columns = {'BRUTTO_DT', 'DATE_TARA', 'WEIGHT'}
        assert _pick_column(columns, 'brutto_dt', 'DATE_BRUTTO') == 'BRUTTO_DT'
        assert _pick_column(columns, 'DATE_BRUTTO', 'brutto_dt') == 'BRUTTO_DT'
        assert _pick_column(columns, 'missing', 'date_tara') == 'DATE_TARA'

    def test_returns_none_when_absent(self):
        assert _pick_column({'FOO'}, 'BAR', 'BAZ') is None
        assert _pick_column(set()) is None


class TestDatetimeExpression:
    def test_uses_combined_datetime_column_without_time_add(self):
        columns = {'BRUTTO_DT', 'DATE_BRUTTO', 'TIME_BRUTTO'}
        assert _datetime_expression(columns, 'BRUTTO_DT', 'DATE_BRUTTO', time_names=('TIME_BRUTTO',)) == 'BRUTTO_DT'

    def test_adds_separate_date_and_time_columns(self):
        columns = {'DATE_BRUTTO', 'TIME_BRUTTO'}
        assert (
            _datetime_expression(columns, 'BRUTTO_DT', 'DATE_BRUTTO', time_names=('TIME_BRUTTO',))
            == 'DATE_BRUTTO + TIME_BRUTTO'
        )

    def test_falls_back_to_date_only(self):
        columns = {'DATE_TARA'}
        assert _datetime_expression(columns, 'TARA_DT', 'DATE_TARA', time_names=('TIME_TARA',)) == 'DATE_TARA'

    def test_returns_none_without_date_column(self):
        assert _datetime_expression({'TIME_BRUTTO'}, 'BRUTTO_DT', 'DATE_BRUTTO', time_names=('TIME_BRUTTO',)) is None


class TestWeighingDateFilter:
    def test_builds_or_filter_when_both_brutto_and_tara_present(self):
        columns = {'BRUTTO_DT', 'TARA_DT'}
        assert _build_weighing_date_filter(columns) == (
            '(CAST(BRUTTO_DT AS DATE) = ? OR CAST(TARA_DT AS DATE) = ?)'
        )

    def test_prefers_dt_over_date_alias(self):
        columns = {'BRUTTO_DT', 'DATE_BRUTTO', 'DATE_TARA'}
        assert _build_weighing_date_filter(columns) == (
            '(CAST(BRUTTO_DT AS DATE) = ? OR CAST(DATE_TARA AS DATE) = ?)'
        )

    def test_single_available_column(self):
        assert _build_weighing_date_filter({'DATE_BRUTTO'}) == 'CAST(DATE_BRUTTO AS DATE) = ?'
        assert _build_weighing_date_filter({'TARA_DT'}) == 'CAST(TARA_DT AS DATE) = ?'

    def test_returns_none_without_weighing_date_columns(self):
        assert _build_weighing_date_filter({'WEIGHT', 'NUMBER'}) is None


class TestParseWeighingTargetDate:
    def test_parses_iso_date(self):
        assert str(_parse_weighing_target_date('2026-07-28')) == '2026-07-28'

    def test_rejects_invalid_format(self):
        with pytest.raises(ValueError):
            _parse_weighing_target_date('28.07.2026')
