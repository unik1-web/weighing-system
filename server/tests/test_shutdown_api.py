"""Shutdown endpoint returns success JSON before process exit is scheduled."""


def test_shutdown_returns_success(api_client, monkeypatch):
    scheduled = []

    class FakeThread:
        def __init__(self, target=None, daemon=None):
            self.target = target
            self.daemon = daemon

        def start(self):
            scheduled.append(self.target)

    monkeypatch.setattr('app.threading.Thread', FakeThread)
    monkeypatch.setattr('app.time.sleep', lambda _s: None)
    monkeypatch.setattr('app.os._exit', lambda code: scheduled.append(('exit', code)))

    response = api_client.post('/api/shutdown', json={})
    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert scheduled  # stop callback was scheduled
    # Run stop callback: should call os._exit(0), not raise.
    for item in list(scheduled):
        if callable(item):
            item()
    assert ('exit', 0) in scheduled
