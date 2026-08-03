from datetime import date, datetime

import vescom


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    def execute(self, query, params=()):
        self.executed.append((query, params))

    def fetchall(self):
        return list(self.rows)


class TestVescomPathHelpers:
    def test_install_root_detects_vescom_segment(self, tmp_path):
        db = tmp_path / 'Vescom' / 'StaticTruckScale' / 'Database' / 'STATICTRUCKSCALE.FDB'
        db.parent.mkdir(parents=True)
        db.write_bytes(b'')
        root = vescom._vescom_install_root(str(db))
        assert root.rstrip('/\\').endswith('Vescom')

    def test_related_paths_find_sibling_databases(self, tmp_path):
        scale_a = tmp_path / 'Vescom' / 'StaticTruckScale' / 'Database'
        scale_b = tmp_path / 'Vescom' / 'StaticTruckScale1' / 'Database'
        scale_a.mkdir(parents=True)
        scale_b.mkdir(parents=True)
        primary = scale_a / 'STATICTRUCKSCALE.FDB'
        sibling = scale_b / 'STATICTRUCKSCALE.FDB'
        primary.write_bytes(b'')
        sibling.write_bytes(b'')

        related = vescom._related_vescom_db_paths(str(primary))
        normalized = {path.casefold() for path in related}
        assert str(primary).casefold() in normalized
        assert str(sibling).casefold() in normalized


class TestFetchWeighingsFromWeighings:
    def test_maps_rows_and_derives_net(self, monkeypatch):
        columns = {
            'ID',
            'CAR_NUMBER',
            'CAR_MARKA',
            'RECEIVER',
            'SENDER',
            'CARRIER',
            'DRIVER',
            'PRODUCT',
            'BRUTTO',
            'TARA',
            'NETTO',
            'BRUTTO_DT',
            'TARA_DT',
            'DELETED',
        }
        monkeypatch.setattr(vescom, '_table_columns', lambda cursor, table: columns)

        cursor = FakeCursor(
            [
                (
                    42,
                    datetime(2026, 7, 28, 10, 0, 0),
                    datetime(2026, 7, 28, 11, 0, 0),
                    'A123BC56',
                    'камаз',
                    'Полигон',
                    12.5,
                    8.0,
                    None,
                    'ТКО',
                    'Отправитель',
                    'Перевозчик',
                    'иванов и.и.',
                ),
                (
                    43,
                    datetime(2026, 7, 28, 12, 0, 0),
                    None,
                    'В456ОР77',
                    'маз',
                    '',
                    0,
                    None,
                    None,
                    '',
                    '',
                    '',
                    '',
                ),
            ]
        )

        items = vescom._fetch_weighings_from_weighings(cursor, '2026-07-28', '(DELETED = 0 OR DELETED IS NULL)')

        assert len(items) == 1
        item = items[0]
        assert item['vescom_id'] == 42
        assert item['datetimebrutto'] == '2026-07-28 10:00:00'
        assert item['vehicle_number'] == 'А123ВС56'
        assert item['vehicle_brand'] == 'Камаз'
        assert item['gross_weight'] == 12500
        assert item['tare_weight'] == 8000
        assert item['net_weight'] == 4500
        assert item['driver_name'] == 'Иванов И.И.'
        assert item['cargo_name'] == 'ТКО'

        query, params = cursor.executed[0]
        assert 'FROM WEIGHINGS' in query
        assert 'DELETED' in query
        assert params == (date(2026, 7, 28), date(2026, 7, 28))

    def test_returns_empty_without_required_columns(self, monkeypatch):
        monkeypatch.setattr(vescom, '_table_columns', lambda cursor, table: {'BRUTTO'})
        assert vescom._fetch_weighings_from_weighings(FakeCursor([]), '2026-07-28', '1=1') == []


class TestFetchWeighingsFromEvents:
    def test_maps_events_and_skips_invalid_gross(self, monkeypatch):
        monkeypatch.setattr(vescom, '_table_exists', lambda cursor, table: table == 'EVENTS')
        cursor = FakeCursor(
            [
                (
                    datetime(2026, 7, 28, 9, 0, 0),
                    datetime(2026, 7, 28, 9, 30, 0),
                    'А123ВС56',
                    'Газель',
                    'Фирма',
                    15000,
                    5000,
                    None,
                    'Песок',
                ),
                (
                    datetime(2026, 7, 28, 10, 0, 0),
                    datetime(2026, 7, 28, 10, 30, 0),
                    'В456ОР77',
                    '',
                    '',
                    None,
                    None,
                    None,
                    '',
                ),
            ]
        )

        items = vescom._fetch_weighings_from_events(cursor, '2026-07-28')
        assert len(items) == 1
        assert items[0]['vescom_id'] is None
        assert items[0]['gross_weight'] == 15000
        assert items[0]['tare_weight'] == 5000
        assert items[0]['net_weight'] == 10000
        assert items[0]['cargo_name'] == 'Песок'
        assert items[0]['driver_name'] == '—'
        assert cursor.executed[0][1] == ('2026-07-28',)

    def test_returns_empty_without_events_table(self, monkeypatch):
        monkeypatch.setattr(vescom, '_table_exists', lambda cursor, table: False)
        assert vescom._fetch_weighings_from_events(FakeCursor([]), '2026-07-28') == []
