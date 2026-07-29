"""Vescom weighing_data must accept credentials via POST body, not GET query."""

from app import app


def test_vescom_weighing_data_rejects_get():
    client = app.test_client()
    response = client.get(
        '/api/vescom/weighing_data',
        query_string={
            'date': '2026-07-29',
            'db_path': 'X:/vescom.fdb',
            'user': 'SYSDBA',
            'password': 'secret-should-not-be-in-url',
        },
    )
    # App catch-all maps unmatched methods to 404 (not Flask's default 405).
    assert response.status_code in (404, 405)
    assert response.status_code != 200


def test_vescom_weighing_data_post_reads_json_body(monkeypatch):
    captured: dict = {}

    def fake_fetch(db_path, date_str, user, password):
        captured.update(
            db_path=db_path,
            date_str=date_str,
            user=user,
            password=password,
        )
        return [{'vehicle_number': 'A123AA'}]

    monkeypatch.setattr('app.fetch_vescom_rows', fake_fetch)

    client = app.test_client()
    response = client.post(
        '/api/vescom/weighing_data',
        json={
            'date': '2026-07-29',
            'db_path': 'X:/vescom.fdb',
            'user': 'SYSDBA',
            'password': 'secret-in-body',
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert body['items'] == [{'vehicle_number': 'A123AA'}]
    assert captured['password'] == 'secret-in-body'
    assert captured['date_str'] == '2026-07-29'
