"""Year-rotation tare resolution used by auto-close on rotate."""

from __future__ import annotations

import json

import year_db
import year_rotation
from sqlite_store import connect, init_schema


def _insert_open_ticket(connection, *, ticket_id: str, vehicle: str, gross: float = 20000.0):
    connection.execute(
        '''
        INSERT INTO weighing_tickets (
            id, ticket_number, vehicle_number, status, created_at, operator_name,
            price, vat_rate, gross_weight, weighing_mode, version, auto_closed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            ticket_id,
            1,
            vehicle,
            'open',
            '2026-01-01T00:00:00',
            'Op',
            100,
            20,
            gross,
            'dual',
            1,
            0,
        ),
    )


def _insert_vehicle_dict(connection, *, name: str, default_tare, notes: str = ''):
    payload = {'default_tare_weight': default_tare}
    connection.execute(
        '''
        INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
        VALUES (?, 'vehicles', ?, ?, ?, ?)
        ''',
        (
            f'veh-{name}',
            name,
            notes,
            '2026-01-01T00:00:00',
            json.dumps(payload, ensure_ascii=False),
        ),
    )


def _insert_completed(
    connection,
    *,
    ticket_id: str,
    vehicle: str,
    tare: float | None,
    completed_at: str,
):
    connection.execute(
        '''
        INSERT INTO weighing_tickets (
            id, ticket_number, vehicle_number, status, created_at, completed_at,
            operator_name, price, vat_rate, gross_weight, tare_weight,
            weighing_mode, version, auto_closed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            ticket_id,
            10,
            vehicle,
            'completed',
            completed_at,
            completed_at,
            'Op',
            100,
            20,
            18000,
            tare,
            'single',
            1,
            0,
        ),
    )


def test_resolve_tare_prefers_dictionary_over_last_completed_and_default(temp_app_root):
    year_db.write_active_year(2026)
    with connect() as connection:
        init_schema(connection)
        _insert_vehicle_dict(connection, name='А001АА56', default_tare=5100)
        _insert_completed(
            connection,
            ticket_id='c-old',
            vehicle='А001АА56',
            tare=4200,
            completed_at='2026-06-01T10:00:00',
        )
        tare, source = year_rotation.resolve_tare_for_ticket(connection, 'А001АА56', 2500)
    assert tare == 5100
    assert source == 'dictionary'


def test_resolve_tare_falls_back_to_last_completed_tare(temp_app_root):
    year_db.write_active_year(2026)
    with connect() as connection:
        init_schema(connection)
        _insert_completed(
            connection,
            ticket_id='c1',
            vehicle='А222АА56',
            tare=3900,
            completed_at='2026-03-01T10:00:00',
        )
        _insert_completed(
            connection,
            ticket_id='c2',
            vehicle='А222АА56',
            tare=4100,
            completed_at='2026-06-01T10:00:00',
        )
        tare, source = year_rotation.resolve_tare_for_ticket(connection, 'А222АА56', 0)
        # Most recent completed with non-positive tare does not scan older history.
        _insert_completed(
            connection,
            ticket_id='c3',
            vehicle='А222АА56',
            tare=0,
            completed_at='2026-07-01T10:00:00',
        )
        tare_after_zero, source_after_zero = year_rotation.resolve_tare_for_ticket(
            connection, 'А222АА56', 0
        )
    assert tare == 4100
    # Current contract: last-completed tare is labelled dictionary for rotate UI.
    assert source == 'dictionary'
    assert tare_after_zero is None
    assert source_after_zero == 'none'


def test_resolve_tare_uses_config_default_then_none(temp_app_root):
    year_db.write_active_year(2026)
    with connect() as connection:
        init_schema(connection)
        tare_default, source_default = year_rotation.resolve_tare_for_ticket(
            connection, 'А999АА56', 2750
        )
        tare_none, source_none = year_rotation.resolve_tare_for_ticket(
            connection, 'А999АА56', 0
        )
    assert tare_default == 2750
    assert source_default == 'default'
    assert tare_none is None
    assert source_none == 'none'


def test_resolve_tare_skips_corrupt_dictionary_payload(temp_app_root):
    year_db.write_active_year(2026)
    with connect() as connection:
        init_schema(connection)
        connection.execute(
            '''
            INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
            VALUES (?, 'vehicles', ?, '', ?, ?)
            ''',
            ('bad-1', 'А333АА56', '2026-01-01T00:00:00', '{not-json'),
        )
        connection.execute(
            '''
            INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
            VALUES (?, 'vehicles', ?, '', ?, ?)
            ''',
            (
                'bad-2',
                'А333АА56',
                '2026-01-01T00:00:00',
                json.dumps({'default_tare_weight': 'nope'}, ensure_ascii=False),
            ),
        )
        connection.execute(
            '''
            INSERT INTO dictionary_entries (id, category, name, notes, created_at, payload)
            VALUES (?, 'vehicles', ?, '', ?, ?)
            ''',
            (
                'ok-3',
                'А333АА56',
                '2026-01-01T00:00:00',
                json.dumps({'default_tare_weight': 3600}, ensure_ascii=False),
            ),
        )
        tare, source = year_rotation.resolve_tare_for_ticket(connection, 'А333АА56', 1000)
    assert tare == 3600
    assert source == 'dictionary'


def test_auto_close_applies_last_completed_and_default_tare(temp_app_root):
    year_db.write_active_year(2026)
    with connect() as connection:
        init_schema(connection)
        _insert_completed(
            connection,
            ticket_id='hist',
            vehicle='А444АА56',
            tare=4300,
            completed_at='2026-05-01T12:00:00',
        )
        _insert_open_ticket(connection, ticket_id='open-hist', vehicle='А444АА56', gross=21000)
        _insert_open_ticket(connection, ticket_id='open-default', vehicle='А555АА56', gross=19000)

        closed = year_rotation.auto_close_open_tickets(
            connection,
            operator_id=None,
            operator_name='system',
            tara_default=2800,
        )

        by_id = {row['id']: row for row in closed}
        assert by_id['open-hist']['tare_source'] == 'dictionary'
        assert by_id['open-hist']['tare_weight'] == 4300
        assert by_id['open-hist']['attention'] is False
        assert by_id['open-default']['tare_source'] == 'default'
        assert by_id['open-default']['tare_weight'] == 2800
        assert by_id['open-default']['attention'] is False

        hist_row = connection.execute(
            'SELECT tare_weight, tare_source, net_weight, total_amount, status, auto_closed FROM weighing_tickets WHERE id = ?',
            ('open-hist',),
        ).fetchone()
        assert hist_row['status'] == 'completed'
        assert hist_row['auto_closed'] == 1
        assert hist_row['tare_weight'] == 4300
        assert hist_row['tare_source'] == 'dictionary'
        assert hist_row['net_weight'] == 16700
        assert hist_row['total_amount'] == 1670.0

        default_row = connection.execute(
            'SELECT tare_weight, tare_source, net_weight FROM weighing_tickets WHERE id = ?',
            ('open-default',),
        ).fetchone()
        assert default_row['tare_weight'] == 2800
        assert default_row['tare_source'] == 'default'
        assert default_row['net_weight'] == 16200
