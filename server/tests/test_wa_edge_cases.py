"""WA import edge cases: deleted rows, net derivation, dictionaries, table scoring."""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

import pytest

from wa import (
    _find_weighing_table,
    _is_deleted,
    _pick_column,
    _row_matches_date,
    _fetch_sqlite_items,
    fetch_wa_dictionary_names,
    fetch_wa_items,
)


class TestWaDeletedAndDateHelpers:
    def test_is_deleted_truthy_variants(self):
        assert _is_deleted(1) is True
        assert _is_deleted('True') is True
        assert _is_deleted('YES') is True
        assert _is_deleted('удалён') is True
        assert _is_deleted('удален') is True
        assert _is_deleted(0) is False
        assert _is_deleted(None) is False
        assert _is_deleted('no') is False

    def test_row_matches_date_on_brutto_or_tara(self):
        target = date(2026, 7, 28)
        assert _row_matches_date('2026-07-28 10:00:00', '', target) is True
        assert _row_matches_date('', '2026-07-28 11:00:00', target) is True
        assert _row_matches_date('2026-07-27 10:00:00', '2026-07-26 11:00:00', target) is False
        assert _row_matches_date('bad', '', target) is False

    def test_pick_column_is_case_insensitive(self):
        columns = {'Nomerts', 'massa_brutto', 'OTHER'}
        assert _pick_column(columns, 'NOMERTS', 'NOMER') == 'NOMERTS'
        assert _pick_column(columns, 'MASSA_BRUTTO') == 'MASSA_BRUTTO'
        assert _pick_column(columns, 'missing') is None


class _FakeCursor:
    """Minimal Firebird-like cursor for _find_weighing_table scoring."""

    def __init__(self, tables: dict[str, set[str]]):
        self.tables = {name.upper(): {c.upper() for c in cols} for name, cols in tables.items()}
        self._last_sql = ''
        self._result: list = []

    def execute(self, sql: str, params=None):
        self._last_sql = ' '.join(sql.split()).upper()
        if 'FROM RDB$RELATIONS' in self._last_sql:
            self._result = [(name,) for name in sorted(self.tables)]
        elif 'FROM RDB$RELATION_FIELDS' in self._last_sql:
            # table name is bound as parameter in real code; parse FROM ... WHERE RDB$RELATION_NAME
            table = None
            if params:
                table = str(params[0]).strip().upper()
            else:
                for name in self.tables:
                    if name in self._last_sql:
                        table = name
                        break
            self._result = [(col,) for col in sorted(self.tables.get(table or '', set()))]
        else:
            self._result = []
        return self

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None


def test_find_weighing_table_picks_highest_scoring_schema(monkeypatch):
    import wa as wa_module

    cursor = _FakeCursor(
        {
            'OTHER': {'ID', 'NAME'},
            'JOURNAL': {
                'NOMERTS',
                'MASSA_BRUTTO',
                'MASSA_TARA',
                'MASSA_NETTO',
                'DATE_BRUTTO',
            },
            'SP_DOC': {
                'NOMERTS',
                'MASSA_BRUTTO',
            },
        }
    )

    # Drive existence/columns through our fake without real Firebird metadata helpers.
    monkeypatch.setattr(
        wa_module,
        '_table_exists',
        lambda cur, name: name.upper() in cur.tables,
    )
    monkeypatch.setattr(
        wa_module,
        '_table_columns',
        lambda cur, name: cur.tables.get(name.upper(), set()),
    )
    monkeypatch.setattr(
        wa_module,
        '_list_user_tables',
        lambda cur: sorted(cur.tables),
    )

    table, columns = _find_weighing_table(cursor)
    assert table == 'JOURNAL'
    assert 'NOMERTS' in columns
    assert 'MASSA_BRUTTO' in columns


def test_find_weighing_table_raises_when_no_candidate_scores(monkeypatch):
    import wa as wa_module

    cursor = _FakeCursor({'MISC': {'ID', 'NOTE'}})
    monkeypatch.setattr(wa_module, '_table_exists', lambda cur, name: name.upper() in cur.tables)
    monkeypatch.setattr(wa_module, '_table_columns', lambda cur, name: cur.tables.get(name.upper(), set()))
    monkeypatch.setattr(wa_module, '_list_user_tables', lambda cur: sorted(cur.tables))

    with pytest.raises(FileNotFoundError, match='таблиц'):
        _find_weighing_table(cursor)


def _seed_sqlite(path: Path, rows: list[tuple]) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            '''
            CREATE TABLE SP_DOC (
                GUIDDOC TEXT,
                NOMERTS TEXT,
                REGIONTS TEXT,
                MARKATS TEXT,
                VODITEL TEXT,
                GRUZ TEXT,
                OTPRAVITEL TEXT,
                POLUCHATEL TEXT,
                PEREVOZCHIK TEXT,
                NOMERPRICEP TEXT,
                MASSA_BRUTTO REAL,
                MASSA_TARA REAL,
                MASSA_NETTO REAL,
                USERNAME TEXT,
                DATE_BRUTTO TEXT,
                TIME_BRUTTO TEXT,
                DATE_TARA TEXT,
                TIME_TARA TEXT,
                FDELETE INTEGER
            )
            '''
        )
        connection.executemany(
            '''
            INSERT INTO SP_DOC VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ''',
            rows,
        )
        connection.commit()
    finally:
        connection.close()


class TestWaSqliteEdgeCases:
    def test_skips_deleted_and_derives_net(self, tmp_path):
        db_file = tmp_path / 'wa.sqlite'
        _seed_sqlite(
            db_file,
            [
                (
                    'keep-1', 'А123ВС', '56', 'КАМАЗ', 'Иванов',
                    'Песок', 'ООО А', 'ООО Б', 'ООО В', '',
                    25.5, 10.2, None, 'Оператор',
                    '2026-07-28', '10:15:00', '2026-07-28', '11:00:00', 0,
                ),
                (
                    'deleted-1', 'К999КК', '56', 'МАЗ', 'Петров',
                    'Щебень', 'А', 'Б', 'В', '',
                    20, 8, 12, 'Оператор',
                    '2026-07-28', '09:00:00', '2026-07-28', '09:30:00', 1,
                ),
            ],
        )

        items = _fetch_sqlite_items(str(db_file), '2026-07-28')
        assert len(items) == 1
        assert items[0]['wa_id'] == 'keep-1'
        assert items[0]['gross_weight'] == 25500
        assert items[0]['tare_weight'] == 10200
        assert items[0]['net_weight'] == 15300

    def test_matches_date_via_tara_when_brutto_missing(self, tmp_path):
        db_file = tmp_path / 'wa.sqlite'
        _seed_sqlite(
            db_file,
            [
                (
                    'tara-only', 'А111АА', '56', '', 'Сидоров',
                    'Грунт', 'А', 'Б', 'В', '',
                    18, 7, 11, 'Оператор',
                    None, None, '2026-07-28', '12:00:00', 0,
                ),
            ],
        )

        items = _fetch_sqlite_items(str(db_file), '2026-07-28')
        assert len(items) == 1
        assert items[0]['wa_id'] == 'tara-only'
        assert items[0]['datetimebrutto'] == '2026-07-28 12:00:00'
        assert items[0]['datetimetara'] == '2026-07-28 12:00:00'

    def test_fetch_wa_items_routes_sqlite_file(self, tmp_path):
        db_file = tmp_path / 'wa.sqlite'
        _seed_sqlite(
            db_file,
            [
                (
                    'guid-1', 'А123ВС', '56', 'КАМАЗ', 'Иванов',
                    'Песок', 'ООО А', 'ООО Б', 'ООО В', '',
                    25.5, 10.2, 15.3, 'Оператор',
                    '2026-07-28', '10:15:00', '2026-07-28', '11:00:00', 0,
                ),
            ],
        )
        items = fetch_wa_items(str(db_file), '2026-07-28')
        assert len(items) == 1
        assert items[0]['vehicle_number'] == 'А123ВС56'

    def test_fetch_wa_dictionary_names_from_sqlite(self, tmp_path):
        db_file = tmp_path / 'wa.sqlite'
        _seed_sqlite(
            db_file,
            [
                (
                    '1', 'А123ВС', '56', 'КАМАЗ', 'иванов и.и.; петров п.п.',
                    'Песок', 'ООО Отправитель', 'ООО Получатель', 'ООО Перевозчик', '',
                    25.5, 10.2, 15.3, 'Оператор',
                    '2026-07-28', '10:15:00', '2026-07-28', '11:00:00', 0,
                ),
                (
                    '2', 'А123ВС', '56', 'КАМАЗ', 'Иванов И.И.',
                    'песок', 'ООО Отправитель', 'ООО Получатель', 'ООО Перевозчик', '',
                    20, 8, 12, 'Оператор',
                    '2026-07-27', '09:00:00', '2026-07-27', '09:30:00', 0,
                ),
                (
                    '3', '??', '', '', '',
                    '—', '', '', '', '',
                    1, 1, 0, '',
                    '2026-07-26', '09:00:00', '2026-07-26', '09:30:00', 0,
                ),
            ],
        )

        dictionaries = fetch_wa_dictionary_names(str(db_file))
        # Distinct raw values are collected; case folding / person formatting happens on merge.
        assert set(dictionaries['cargos']) == {'Песок', 'песок'}
        assert dictionaries['shippers'] == ['ООО Отправитель']
        assert dictionaries['receivers'] == ['ООО Получатель']
        assert dictionaries['carriers'] == ['ООО Перевозчик']
        assert 'Иванов И.И.' in dictionaries['drivers']
        assert 'иванов и.и.' in dictionaries['drivers']
        assert 'петров п.п.' in dictionaries['drivers']
        assert dictionaries['vehicles'] == ['А123ВС56']
        assert '??' not in dictionaries['vehicles']
        assert '—' not in dictionaries['cargos']
