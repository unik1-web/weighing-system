"""WA API validation and dictionary-import wiring (no Firebird required)."""

from __future__ import annotations


def test_wa_test_requires_db_path(api_client):
    response = api_client.post('/api/wa/test', json={})
    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False
    assert 'баз' in body['message'].casefold()


def test_wa_weighing_data_rejects_bad_date(api_client):
    response = api_client.get(
        '/api/wa/weighing_data',
        query_string={'db_path': 'C:/WA', 'date': '28-07-2026'},
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False
    assert 'дата' in body['message'].casefold()


def test_wa_weighing_data_requires_db_path(api_client):
    response = api_client.get('/api/wa/weighing_data', query_string={'date': '2026-07-28'})
    assert response.status_code == 400
    assert response.get_json()['success'] is False


def test_wa_weighing_data_returns_items(api_client, monkeypatch):
    import app as flask_app

    monkeypatch.setattr(
        flask_app,
        'fetch_wa_items',
        lambda db_path, date_str, user, password: [
            {
                'wa_id': 'guid-1',
                'datetimebrutto': '2026-07-28 10:00:00',
                'datetimetara': '2026-07-28 11:00:00',
                'vehicle_number': 'А123ВС56',
                'vehicle_brand': 'Камаз',
                'trailer_number': '',
                'driver_name': 'Иванов И.И.',
                'cargo_name': 'Песок',
                'shipper_name': 'А',
                'receiver_name': 'Б',
                'carrier_name': 'В',
                'gross_weight': 25000,
                'tare_weight': 10000,
                'net_weight': 15000,
                'operator_name': 'Оператор',
            }
        ],
    )

    response = api_client.get(
        '/api/wa/weighing_data',
        query_string={
            'db_path': 'C:/WA/Data.sqlite',
            'date': '2026-07-28',
            'user': 'SYSDBA',
            'password': 'masterkey',
        },
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert len(body['items']) == 1
    assert body['items'][0]['wa_id'] == 'guid-1'


def test_wa_import_dictionaries_merges_and_returns_database(api_client, monkeypatch, temp_app_root):
    import app as flask_app

    monkeypatch.setattr(
        flask_app,
        'fetch_wa_dictionary_names',
        lambda db_path, user, password: {
            'cargos': ['Песок', 'Щебень'],
            'shippers': ['ООО А'],
            'receivers': ['ООО Б'],
            'carriers': ['ООО В'],
            'drivers': ['Иванов И.И.'],
            'vehicles': ['А123ВС56'],
        },
    )

    response = api_client.post(
        '/api/wa/import_dictionaries',
        json={'db_path': 'C:/WA/Data.sqlite', 'user': 'SYSDBA', 'password': 'masterkey'},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert body['added']['cargos'] == 2
    assert body['added']['drivers'] == 1
    assert body['added']['vehicles'] == 1
    assert 'Импорт из WA' in body['message']
    assert 'data' in body

    again = api_client.post(
        '/api/wa/import_dictionaries',
        json={'db_path': 'C:/WA/Data.sqlite'},
    )
    assert again.status_code == 200
    again_body = again.get_json()
    assert again_body['success'] is True
    assert sum(again_body['added'].values()) == 0


def test_wa_import_dictionaries_requires_db_path(api_client):
    response = api_client.post('/api/wa/import_dictionaries', json={})
    assert response.status_code == 400
    assert response.get_json()['success'] is False
