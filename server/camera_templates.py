"""Catalog of IP camera URL templates for discover (brand + path patterns)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

BRAND_LABELS: dict[str, str] = {
    'hikvision': 'Hikvision',
    'dahua': 'Dahua',
    'axis': 'Axis',
    'uniview': 'Uniview',
    'generic': 'Generic / fallback',
}

# Template dict keys: id, brand, label, kind, url_pattern, popular
TEMPLATES: list[dict[str, Any]] = [
    # Hikvision
    {
        'id': 'hikvision-http-isapi',
        'brand': 'hikvision',
        'label': 'ISAPI/Streaming/channels/101/picture',
        'kind': 'http_snapshot',
        'url_pattern': (
            'http://{user}:{password}@{ip}:{http_port}'
            '/ISAPI/Streaming/channels/101/picture'
        ),
        'popular': True,
    },
    {
        'id': 'hikvision-rtsp-101',
        'brand': 'hikvision',
        'label': 'Streaming/Channels/101',
        'kind': 'rtsp',
        'url_pattern': 'rtsp://{user}:{password}@{ip}:{rtsp_port}/Streaming/Channels/101',
        'popular': False,
    },
    {
        'id': 'hikvision-rtsp-102',
        'brand': 'hikvision',
        'label': 'Streaming/Channels/102',
        'kind': 'rtsp',
        'url_pattern': 'rtsp://{user}:{password}@{ip}:{rtsp_port}/Streaming/Channels/102',
        'popular': False,
    },
    # Dahua
    {
        'id': 'dahua-http-snapshot',
        'brand': 'dahua',
        'label': 'cgi-bin/snapshot.cgi',
        'kind': 'http_snapshot',
        'url_pattern': 'http://{user}:{password}@{ip}:{http_port}/cgi-bin/snapshot.cgi',
        'popular': True,
    },
    {
        'id': 'dahua-rtsp-main',
        'brand': 'dahua',
        'label': 'cam/realmonitor channel=1 subtype=0',
        'kind': 'rtsp',
        'url_pattern': (
            'rtsp://{user}:{password}@{ip}:{rtsp_port}'
            '/cam/realmonitor?channel=1&subtype=0'
        ),
        'popular': False,
    },
    {
        'id': 'dahua-rtsp-sub',
        'brand': 'dahua',
        'label': 'cam/realmonitor channel=1 subtype=1',
        'kind': 'rtsp',
        'url_pattern': (
            'rtsp://{user}:{password}@{ip}:{rtsp_port}'
            '/cam/realmonitor?channel=1&subtype=1'
        ),
        'popular': False,
    },
    # Axis
    {
        'id': 'axis-http-jpg',
        'brand': 'axis',
        'label': 'axis-cgi/jpg/image.cgi',
        'kind': 'http_snapshot',
        'url_pattern': 'http://{user}:{password}@{ip}:{http_port}/axis-cgi/jpg/image.cgi',
        'popular': True,
    },
    # Uniview
    {
        'id': 'uniview-http-snapshot',
        'brand': 'uniview',
        'label': 'images/snapshot.jpg',
        'kind': 'http_snapshot',
        'url_pattern': 'http://{user}:{password}@{ip}:{http_port}/images/snapshot.jpg',
        'popular': True,
    },
    # Generic fallback
    {
        'id': 'generic-http-snapshot-jpg',
        'brand': 'generic',
        'label': 'snapshot.jpg',
        'kind': 'http_snapshot',
        'url_pattern': 'http://{user}:{password}@{ip}:{http_port}/snapshot.jpg',
        'popular': True,
    },
    {
        'id': 'generic-http-cgi-snapshot',
        'brand': 'generic',
        'label': 'cgi-bin/snapshot.cgi',
        'kind': 'http_snapshot',
        'url_pattern': 'http://{user}:{password}@{ip}:{http_port}/cgi-bin/snapshot.cgi',
        'popular': False,
    },
    {
        'id': 'generic-rtsp-stream1',
        'brand': 'generic',
        'label': 'stream1',
        'kind': 'rtsp',
        'url_pattern': 'rtsp://{user}:{password}@{ip}:{rtsp_port}/stream1',
        'popular': False,
    },
    {
        'id': 'generic-rtsp-h264',
        'brand': 'generic',
        'label': 'h264',
        'kind': 'rtsp',
        'url_pattern': 'rtsp://{user}:{password}@{ip}:{rtsp_port}/h264',
        'popular': False,
    },
]


def list_brands() -> list[dict[str, str]]:
    """Return brand catalog for UI (without virtual «unknown» item)."""
    order = ['hikvision', 'dahua', 'axis', 'uniview', 'generic']
    return [{'id': bid, 'label': BRAND_LABELS[bid]} for bid in order]


def render_url(
    template: dict[str, Any],
    *,
    ip: str,
    username: str = '',
    password: str = '',
    http_port: int = 80,
    rtsp_port: int = 554,
) -> str:
    """Substitute placeholders; percent-encode userinfo."""
    user_q = quote(username or '', safe='')
    pass_q = quote(password or '', safe='')
    pattern = str(template['url_pattern'])
    # No username → omit userinfo (avoids ":@" and ":pass@" forms).
    # Username without password keeps "user:@" (common for open Basic auth).
    if not username:
        pattern = pattern.replace('{user}:{password}@', '')
    return pattern.format(
        user=user_q,
        password=pass_q,
        ip=ip,
        http_port=int(http_port),
        rtsp_port=int(rtsp_port),
    )


def progress_label(template: dict[str, Any]) -> str:
    brand = BRAND_LABELS.get(str(template['brand']), str(template['brand']))
    kind = 'HTTP' if template['kind'] == 'http_snapshot' else 'RTSP'
    return f"{brand} · {kind} · {template['label']}"


def build_attempt_plan(
    brand: str | None,
    opencv_available: bool,
) -> tuple[list[dict[str, Any]], bool]:
    """
    Build ordered list of templates to try.

    Returns (plan, skipped_rtsp) where skipped_rtsp is True when RTSP templates
    exist for the selection but OpenCV is unavailable.
    """
    brand_norm = (brand or '').strip().lower() or None
    if brand_norm in ('unknown', 'none', ''):
        brand_norm = None

    if brand_norm:
        pool = [t for t in TEMPLATES if t['brand'] == brand_norm]
    else:
        pool = list(TEMPLATES)

    http_items = [t for t in pool if t['kind'] == 'http_snapshot']
    rtsp_items = [t for t in pool if t['kind'] == 'rtsp']

    if brand_norm is None:
        popular_http = [t for t in http_items if t.get('popular')]
        other_http = [t for t in http_items if not t.get('popular')]
        # Preserve catalog order within groups
        http_ordered = popular_http + other_http
    else:
        http_ordered = http_items

    skipped_rtsp = bool(rtsp_items) and not opencv_available
    if opencv_available:
        plan = http_ordered + rtsp_items
    else:
        plan = http_ordered

    return plan, skipped_rtsp
