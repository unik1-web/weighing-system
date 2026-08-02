"""Safe photo path resolution and serve endpoint."""

import os

import cameras


def test_resolve_safe_photo_path_ok(temp_app_root):
    photo_dir = temp_app_root / 'Photo' / '2026' / '08' / '02'
    photo_dir.mkdir(parents=True)
    target = photo_dir / 't1_gross_entry_20260802120000.jpg'
    target.write_bytes(b'\xff\xd8\xff\xd9')
    rel = 'Photo/2026/08/02/t1_gross_entry_20260802120000.jpg'
    resolved = cameras.resolve_safe_photo_path(rel)
    assert os.path.isfile(resolved)
    assert os.path.realpath(resolved) == os.path.realpath(str(target))


def test_resolve_safe_photo_path_traversal(temp_app_root):
    for bad in (
        '../etc/passwd',
        'Photo/../../etc/passwd',
        '/etc/passwd',
        'BD/weighing.db',
        '',
    ):
        try:
            cameras.resolve_safe_photo_path(bad)
            raised = False
        except ValueError:
            raised = True
        assert raised, f'expected ValueError for {bad!r}'


def test_photo_serve_ok_and_traversal(api_client, temp_app_root):
    photo_dir = temp_app_root / 'Photo' / 'tmp'
    photo_dir.mkdir(parents=True)
    target = photo_dir / 'preview.jpg'
    target.write_bytes(b'\xff\xd8\xff\xd9')

    ok = api_client.get('/api/cameras/photo', query_string={'path': 'Photo/tmp/preview.jpg'})
    assert ok.status_code == 200
    assert ok.data[:2] == b'\xff\xd8'

    bad = api_client.get(
        '/api/cameras/photo',
        query_string={'path': 'Photo/../../etc/passwd'},
    )
    assert bad.status_code == 400

    missing = api_client.get(
        '/api/cameras/photo',
        query_string={'path': 'Photo/tmp/missing.jpg'},
    )
    assert missing.status_code == 404
