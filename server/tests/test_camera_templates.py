"""Unit tests for camera URL template catalog."""

from urllib.parse import unquote

from camera_templates import (
    build_attempt_plan,
    list_brands,
    render_url,
    TEMPLATES,
)


def test_list_brands_order():
    brands = list_brands()
    ids = [b['id'] for b in brands]
    assert ids == ['hikvision', 'dahua', 'axis', 'uniview', 'generic']
    assert all('label' in b for b in brands)


def test_plan_brand_hikvision_http_then_rtsp():
    plan, skipped = build_attempt_plan('hikvision', opencv_available=True)
    assert skipped is False
    assert all(t['brand'] == 'hikvision' for t in plan)
    kinds = [t['kind'] for t in plan]
    assert 'http_snapshot' in kinds
    assert 'rtsp' in kinds
    first_rtsp = next(i for i, k in enumerate(kinds) if k == 'rtsp')
    assert all(k == 'http_snapshot' for k in kinds[:first_rtsp])


def test_plan_unknown_popular_http_first():
    plan, skipped = build_attempt_plan(None, opencv_available=True)
    assert skipped is False
    http = [t for t in plan if t['kind'] == 'http_snapshot']
    # First HTTP items should be popular
    popular_http = [t for t in TEMPLATES if t['kind'] == 'http_snapshot' and t.get('popular')]
    assert http[: len(popular_http)] == popular_http


def test_plan_skips_rtsp_without_opencv():
    plan, skipped = build_attempt_plan('hikvision', opencv_available=False)
    assert skipped is True
    assert all(t['kind'] == 'http_snapshot' for t in plan)
    assert any(t['kind'] == 'rtsp' for t in TEMPLATES if t['brand'] == 'hikvision')


def test_render_url_percent_encodes_userinfo():
    tmpl = next(t for t in TEMPLATES if t['id'] == 'hikvision-http-isapi')
    url = render_url(
        tmpl,
        ip='192.168.1.64',
        username='admin',
        password='p@ss:word',
        http_port=80,
    )
    assert '192.168.1.64' in url
    assert 'p@ss:word' not in url
    assert unquote(url.split('@')[0].split('://', 1)[1].split(':', 1)[1]) == 'p@ss:word'


def test_render_url_empty_creds_omits_userinfo():
    tmpl = next(t for t in TEMPLATES if t['id'] == 'generic-http-snapshot-jpg')
    url = render_url(tmpl, ip='10.0.0.5', username='', password='')
    assert url.startswith('http://10.0.0.5:80/snapshot.jpg')
    assert '@' not in url


def test_render_url_empty_username_omits_userinfo_even_with_password():
    tmpl = next(t for t in TEMPLATES if t['id'] == 'generic-http-snapshot-jpg')
    url = render_url(tmpl, ip='10.0.0.5', username='', password='secret')
    assert url.startswith('http://10.0.0.5:80/snapshot.jpg')
    assert '@' not in url
    assert 'secret' not in url
