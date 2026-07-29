import sqlite3
from datetime import datetime
from pathlib import Path

import pytest

from wa import (
    _combine_date_time,
    _fetch_sqlite_items,
    _vehicle_number,
    _weight_to_kg,
    resolve_wa_db_path,
    resolve_wa_install_dir,
)
import wa as wa_module


class TestWaWeightHelpers:
    def test_weight_to_kg_treats_small_values_as_tons(self):
        assert _weight_to_kg(12.5) == 12500
        assert _weight_to_kg(12500) == 12500
        assert _weight_to_kg(0) is None
        assert _weight_to_kg('bad') is None

    def test_combine_date_time(self):
        assert _combine_date_time(datetime(2026, 7, 28, 10, 5, 9), None) == '2026-07-28 10:05:09'
        assert _combine_date_time('28.07.2026', '09:15') == '2026-07-28 09:15:00'
        assert _combine_date_time(None, '10:00') == ''

    def test_vehicle_number_appends_region(self):
        assert _vehicle_number('А123ВС', '56') == 'А123ВС56'
        assert _vehicle_number('А123ВС56', '56') == 'А123ВС56'


class TestWaPathResolution:
    def test_resolve_install_dir_from_file(self, tmp_path):
        db_file = tmp_path / 'VESYEVENT.GDB'
        db_file.write_bytes(b'')
        assert resolve_wa_install_dir(str(db_file)) == str(tmp_path)

    def test_resolve_db_path_in_database_subdir(self, tmp_path):
        db_dir = tmp_path / 'WA'
        nested = db_dir / 'DataBase'
        nested.mkdir(parents=True)
        db_file = nested / 'VESYEVENT.GDB'
        db_file.write_bytes(b'')

        assert resolve_wa_db_path(str(db_dir)) == str(db_file)
        assert resolve_wa_db_path(str(db_file)) == str(db_file)

    def test_resolve_db_path_missing_raises(self, tmp_path):
        empty = tmp_path / 'empty'
        empty.mkdir()
        with pytest.raises(FileNotFoundError):
            resolve_wa_db_path(str(empty))


class TestWaSqliteImport:
    def _create_db(self, path: Path) -> None:
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
            connection.execute(
                '''
                INSERT INTO SP_DOC VALUES (
                    'guid-1', 'А123ВС', '56', 'КАМАЗ', 'Иванов Иван',
                    'Песок', 'ООО Отправитель', 'ООО Получатель', 'ООО Перевозчик',
                    'В456ОР56', 25.5, 10.2, 15.3, 'Оператор',
                    '2026-07-28', '10:15:00', '2026-07-28', '11:00:00', 0
                )
                '''
            )
            connection.execute(
                '''
                INSERT INTO SP_DOC VALUES (
                    'guid-2', 'К999КК', '56', 'МАЗ', 'Петров',
                    'Щебень', 'А', 'Б', 'В',
                    '', 20, 8, 12, 'Оператор',
                    '2026-07-27', '09:00:00', '2026-07-27', '09:30:00', 0
                )
                '''
            )
            connection.commit()
        finally:
            connection.close()

    def test_fetch_sqlite_items_filters_by_date(self, tmp_path):
        db_file = tmp_path / 'wa.sqlite'
        self._create_db(db_file)

        items = _fetch_sqlite_items(str(db_file), '2026-07-28')
        assert len(items) == 1
        item = items[0]
        assert item['wa_id'] == 'guid-1'
        assert item['vehicle_number'] == 'А123ВС56'
        assert item['gross_weight'] == 25500
        assert item['tare_weight'] == 10200
        assert item['net_weight'] == 15300
        assert item['cargo_name'] == 'Песок'
        assert item['datetimebrutto'] == '2026-07-28 10:15:00'

    def test_test_connection_counts_rows(self, tmp_path):
        db_dir = tmp_path / 'WA'
        db_dir.mkdir()
        db_file = db_dir / 'Data.sqlite'
        self._create_db(db_file)
        # Prefer known Firebird names; for sqlite use direct file path
        assert wa_module.test_wa_connection(str(db_file)) == 2
