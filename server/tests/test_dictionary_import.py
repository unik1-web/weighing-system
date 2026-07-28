import json

from dictionary_import import (
    format_import_message,
    merge_dictionaries,
    merge_dictionary_names,
    merge_vehicle_records,
)
from sqlite_store import connect, init_schema


class TestFormatImportMessage:
    def test_empty_fetch(self):
        message = format_import_message('Vescom', {}, {})
        assert 'не найдено записей' in message

    def test_nothing_new(self):
        fetched = {'drivers': ['Иванов И.И.', 'Петров П.П.'], 'cargos': ['Песок']}
        message = format_import_message('Metra', fetched, {})
        assert message.startswith('Все записи уже есть')
        assert 'водителей' in message

    def test_added_summary(self):
        fetched = {'vehicles': [{'number': 'А123ВС56'}], 'drivers': ['Иванов И.И.']}
        added = {'vehicles': 1, 'drivers': 1}
        message = format_import_message('Vescom', fetched, added)
        assert message.startswith('Импорт из Vescom:')
        assert 'автомобилей: 1 новых из 1' in message
        assert 'водителей: 1 новых из 1' in message


class TestDictionaryMerge:
    def test_merge_names_adds_unique_and_skips_duplicates(self, temp_app_root):
        first = merge_dictionary_names('cargos', ['Песок', 'песок', 'Щебень', '—', ''])
        second = merge_dictionary_names('cargos', ['Песок', 'Грунт'])

        assert first == 2
        assert second == 1

        with connect() as connection:
            names = {
                row['name']
                for row in connection.execute(
                    "SELECT name FROM dictionary_entries WHERE category = 'cargos'"
                )
            }
        assert names == {'Песок', 'Щебень', 'Грунт'}

    def test_merge_drivers_formats_and_splits(self, temp_app_root):
        added = merge_dictionary_names(
            'drivers',
            ['иванов и.и.; петров п.п.', 'Иванов И.И.'],
        )
        assert added == 2

        with connect() as connection:
            names = sorted(
                row['name']
                for row in connection.execute(
                    "SELECT name FROM dictionary_entries WHERE category = 'drivers'"
                )
            )
        assert names == ['Иванов И.И.', 'Петров П.П.']

    def test_merge_vehicles_dedupes_and_fills_missing_fields(self, temp_app_root):
        changed = merge_vehicle_records(
            [
                {'number': 'A123BC56', 'brand': '', 'tare_kg': None},
                {'number': 'А 123 ВС 56', 'brand': 'камаз', 'tare_kg': 8500},
                {'number': '??', 'brand': 'Мусор', 'tare_kg': 1000},
                {'number': 'В456ОР77', 'brand': 'маз', 'tare_kg': 0},
            ]
        )
        assert changed == 2

        with connect() as connection:
            rows = connection.execute(
                "SELECT name, payload FROM dictionary_entries WHERE category = 'vehicles' ORDER BY name"
            ).fetchall()

        assert len(rows) == 2
        by_number = {
            row['name']: json.loads(row['payload'])
            for row in rows
        }
        assert by_number['А123ВС56']['vehicle_brand'] == 'Камаз'
        assert by_number['А123ВС56']['default_tare_weight'] == 8500
        assert by_number['В456ОР77']['vehicle_brand'] == 'Маз'
        assert by_number['В456ОР77']['default_tare_weight'] is None

        # Existing record keeps brand/tare; only fill blanks on second merge.
        again = merge_vehicle_records(
            [{'number': 'А123ВС56', 'brand': 'Другая', 'tare_kg': 9000}]
        )
        assert again == 0

        filled = merge_vehicle_records(
            [{'number': 'В456ОР77', 'brand': '', 'tare_kg': 7200}]
        )
        assert filled == 1

        with connect() as connection:
            payload = json.loads(
                connection.execute(
                    "SELECT payload FROM dictionary_entries WHERE name = ?",
                    ('В456ОР77',),
                ).fetchone()['payload']
            )
        assert payload['vehicle_brand'] == 'Маз'
        assert payload['default_tare_weight'] == 7200

    def test_merge_dictionaries_routes_vehicle_dicts(self, temp_app_root):
        result = merge_dictionaries(
            {
                'cargos': ['Песок'],
                'vehicles': [{'number': 'А111АА56', 'brand': 'газ', 'tare_kg': 1200}],
                'drivers': [],
                'unknown': ['ignored'],
            }
        )
        assert result == {'cargos': 1, 'vehicles': 1}
