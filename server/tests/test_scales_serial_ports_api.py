def test_scales_serial_ports(api_client):
    resp = api_client.get('/api/scales/serial-ports')
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['success'] is True
    assert isinstance(body['ports'], list)
