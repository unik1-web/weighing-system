"""Camera URL discover: SSRF-safe template probing with in-memory sessions."""

from __future__ import annotations

import ipaddress
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from camera_templates import (
    BRAND_LABELS,
    build_attempt_plan,
    list_brands,
    progress_label,
    render_url,
)
from cameras import (
    _opencv_available,
    grab_frame_http,
    grab_frame_rtsp,
    save_tmp_snapshot,
)

logger = logging.getLogger('camera_discover')

DISCOVER_WALL_CLOCK = 45.0
DISCOVER_HTTP_PARALLEL = 2
DISCOVER_SESSION_TTL_SEC = 300
MAX_DISCOVER_SESSIONS = 8

_sessions: dict[str, dict[str, Any]] = {}
_sessions_lock = threading.Lock()
_active_session_id: str | None = None


def mask_url(url: str) -> str:
    """Replace password in userinfo with *** for logs/UI helpers."""
    if not url or '@' not in url:
        return url
    try:
        scheme_sep = url.find('://')
        if scheme_sep < 0:
            return url
        prefix = url[: scheme_sep + 3]
        rest = url[scheme_sep + 3 :]
        at = rest.rfind('@')
        if at < 0:
            return url
        userinfo = rest[:at]
        hostpart = rest[at + 1 :]
        if ':' in userinfo:
            user, _passwd = userinfo.split(':', 1)
            return f'{prefix}{user}:***@{hostpart}'
        return f'{prefix}***@{hostpart}'
    except Exception:
        return url


def assert_discover_target_allowed(ip: str) -> None:
    """Raise ValueError if IP is not private/local IPv4."""
    raw = (ip or '').strip()
    if not raw:
        raise ValueError('IP не указан')
    try:
        addr = ipaddress.IPv4Address(raw)
    except ValueError as exc:
        raise ValueError(
            'Укажите IPv4-адрес (DNS-имена не поддерживаются)'
        ) from exc
    if addr.is_unspecified:
        raise ValueError('Разрешены только адреса частных/локальных сетей')
    if addr.is_loopback or addr.is_private or addr.is_link_local:
        return
    raise ValueError('Разрешены только адреса частных/локальных сетей')


def parse_ip_and_ports(
    ip_raw: str,
    http_port: int | None = None,
    rtsp_port: int | None = None,
) -> tuple[str, int, int]:
    """
    Parse IPv4 or host:port. Optional :port in ip overrides http_port
    only when http_port was not explicitly passed.
    """
    raw = (ip_raw or '').strip()
    if not raw:
        raise ValueError('IP не указан')

    host = raw
    embedded_port: int | None = None
    if raw.count(':') == 1:
        left, right = raw.rsplit(':', 1)
        if right.isdigit():
            host = left.strip()
            embedded_port = int(right)

    assert_discover_target_allowed(host)

    resolved_http = 80
    if http_port is not None:
        resolved_http = int(http_port)
    elif embedded_port is not None:
        resolved_http = embedded_port

    resolved_rtsp = int(rtsp_port) if rtsp_port is not None else 554

    if not (1 <= resolved_http <= 65535):
        raise ValueError('Некорректный HTTP-порт')
    if not (1 <= resolved_rtsp <= 65535):
        raise ValueError('Некорректный RTSP-порт')

    return host, resolved_http, resolved_rtsp


def _gc_sessions_locked() -> None:
    """Drop terminal sessions older than TTL; trim to MAX_DISCOVER_SESSIONS."""
    now = time.time()
    to_delete: list[str] = []
    for sid, sess in _sessions.items():
        if sess['status'] in ('done', 'cancelled', 'failed'):
            finished = sess.get('finished_at') or sess.get('created_at') or now
            if now - float(finished) > DISCOVER_SESSION_TTL_SEC:
                to_delete.append(sid)
    for sid in to_delete:
        _sessions.pop(sid, None)

    if len(_sessions) <= MAX_DISCOVER_SESSIONS:
        return
    # Prefer removing oldest terminal sessions first
    terminal = sorted(
        (
            (sid, s)
            for sid, s in _sessions.items()
            if s['status'] in ('done', 'cancelled', 'failed')
        ),
        key=lambda item: float(item[1].get('finished_at') or item[1].get('created_at') or 0),
    )
    while len(_sessions) > MAX_DISCOVER_SESSIONS and terminal:
        sid, _ = terminal.pop(0)
        _sessions.pop(sid, None)


def _session_public(sess: dict[str, Any]) -> dict[str, Any]:
    with sess['lock']:
        return {
            'success': True,
            'session_id': sess['id'],
            'status': sess['status'],
            'progress': dict(sess['progress']),
            'candidates': [dict(c) for c in sess['candidates']],
            'message': sess.get('message'),
            'error': sess.get('error'),
            'skipped_rtsp': bool(sess.get('skipped_rtsp')),
        }


def _cancel_session_locked(sess: dict[str, Any]) -> None:
    sess['cancel_event'].set()
    with sess['lock']:
        if sess['status'] == 'running':
            sess['status'] = 'cancelled'
            sess['message'] = 'Отменено'
            sess['finished_at'] = time.time()


def _try_template(
    template: dict[str, Any],
    *,
    ip: str,
    username: str,
    password: str,
    http_port: int,
    rtsp_port: int,
) -> dict[str, Any] | None:
    """Probe one template; return candidate dict on success, else None."""
    url = render_url(
        template,
        ip=ip,
        username=username,
        password=password,
        http_port=http_port,
        rtsp_port=rtsp_port,
    )
    kind = str(template['kind'])
    brand = str(template['brand'])
    tid = str(template['id'])
    try:
        if kind == 'rtsp':
            jpeg = grab_frame_rtsp(url)
        else:
            jpeg = grab_frame_http(url)
        preview = save_tmp_snapshot(jpeg)
        logger.info(
            'discover ok ip=%s brand=%s template=%s kind=%s url=%s',
            ip,
            brand,
            tid,
            kind,
            mask_url(url),
        )
        return {
            'url': url,
            'kind': kind,
            'brand': brand,
            'template_id': tid,
            'ok': True,
            'preview_path': preview,
            'error': None,
        }
    except Exception as exc:
        logger.info(
            'discover fail ip=%s brand=%s template=%s kind=%s url=%s error=%s',
            ip,
            brand,
            tid,
            kind,
            mask_url(url),
            exc,
        )
        return None


def _worker(session_id: str) -> None:
    global _active_session_id
    with _sessions_lock:
        sess = _sessions.get(session_id)
    if not sess:
        return

    req = sess['request']
    ip = req['ip']
    username = req.get('username') or ''
    password = req.get('password') or ''
    http_port = int(req['http_port'])
    rtsp_port = int(req['rtsp_port'])
    brand = req.get('brand')

    opencv = _opencv_available()
    plan, skipped_rtsp = build_attempt_plan(brand, opencv)
    with sess['lock']:
        sess['skipped_rtsp'] = skipped_rtsp
        sess['progress'] = {
            'current': 0,
            'total': len(plan),
            'label': 'RTSP пропущен: нет OpenCV' if skipped_rtsp and not plan else '',
        }
        if skipped_rtsp and not plan:
            sess['message'] = 'RTSP пропущен: нет OpenCV'
        elif skipped_rtsp:
            sess['message'] = None

    start = time.monotonic()
    cancel_event: threading.Event = sess['cancel_event']
    idx = 0

    def wall_exceeded() -> bool:
        return (time.monotonic() - start) >= DISCOVER_WALL_CLOCK

    def mark_progress(template: dict[str, Any], current: int) -> None:
        with sess['lock']:
            sess['progress'] = {
                'current': current,
                'total': len(plan),
                'label': progress_label(template),
            }

    def append_candidate(cand: dict[str, Any]) -> None:
        with sess['lock']:
            sess['candidates'].append(cand)

    try:
        # Process plan: batch consecutive HTTP items (parallel ≤2), RTSP serial
        i = 0
        while i < len(plan):
            if cancel_event.is_set():
                break
            if wall_exceeded():
                with sess['lock']:
                    if sess['status'] == 'running':
                        sess['status'] = 'done'
                        sess['message'] = (
                            f'Поиск прерван по таймауту ({int(DISCOVER_WALL_CLOCK)} с)'
                        )
                        sess['finished_at'] = time.time()
                break

            item = plan[i]
            if item['kind'] == 'rtsp':
                idx += 1
                mark_progress(item, idx)
                if cancel_event.is_set() or wall_exceeded():
                    if wall_exceeded() and not cancel_event.is_set():
                        with sess['lock']:
                            if sess['status'] == 'running':
                                sess['status'] = 'done'
                                sess['message'] = (
                                    f'Поиск прерван по таймауту ({int(DISCOVER_WALL_CLOCK)} с)'
                                )
                                sess['finished_at'] = time.time()
                    break
                cand = _try_template(
                    item,
                    ip=ip,
                    username=username,
                    password=password,
                    http_port=http_port,
                    rtsp_port=rtsp_port,
                )
                if cand:
                    append_candidate(cand)
                i += 1
                continue

            # Collect consecutive HTTP templates for a parallel window
            http_batch: list[dict[str, Any]] = []
            while i < len(plan) and plan[i]['kind'] == 'http_snapshot':
                http_batch.append(plan[i])
                i += 1
                if len(http_batch) >= DISCOVER_HTTP_PARALLEL:
                    break

            # Run batch with max_workers=2; update progress per completion
            for tmpl in http_batch:
                if cancel_event.is_set() or wall_exceeded():
                    break
                # Pre-mark label for first of batch before submit
                pass

            if cancel_event.is_set():
                break
            if wall_exceeded():
                with sess['lock']:
                    if sess['status'] == 'running':
                        sess['status'] = 'done'
                        sess['message'] = (
                            f'Поиск прерван по таймауту ({int(DISCOVER_WALL_CLOCK)} с)'
                        )
                        sess['finished_at'] = time.time()
                break

            # Mark progress at start of each template in batch
            futures_map = {}
            with ThreadPoolExecutor(max_workers=DISCOVER_HTTP_PARALLEL) as executor:
                for tmpl in http_batch:
                    if cancel_event.is_set() or wall_exceeded():
                        break
                    idx += 1
                    mark_progress(tmpl, idx)
                    fut = executor.submit(
                        _try_template,
                        tmpl,
                        ip=ip,
                        username=username,
                        password=password,
                        http_port=http_port,
                        rtsp_port=rtsp_port,
                    )
                    futures_map[fut] = tmpl

                for fut in as_completed(futures_map):
                    if cancel_event.is_set():
                        break
                    try:
                        cand = fut.result()
                    except Exception as exc:  # pragma: no cover
                        logger.info('discover batch error: %s', exc)
                        cand = None
                    if cand:
                        append_candidate(cand)

            if wall_exceeded() and not cancel_event.is_set():
                with sess['lock']:
                    if sess['status'] == 'running':
                        sess['status'] = 'done'
                        sess['message'] = (
                            f'Поиск прерван по таймауту ({int(DISCOVER_WALL_CLOCK)} с)'
                        )
                        sess['finished_at'] = time.time()
                break

        with sess['lock']:
            if sess['status'] == 'running':
                if cancel_event.is_set():
                    sess['status'] = 'cancelled'
                    sess['message'] = 'Отменено'
                elif not sess['candidates']:
                    sess['status'] = 'failed'
                    msg_parts = ['Рабочие URL не найдены']
                    if skipped_rtsp:
                        msg_parts.append('RTSP пропущен: нет OpenCV')
                    msg_parts.append('проверьте Basic-авторизацию или укажите URL вручную')
                    sess['message'] = '; '.join(msg_parts)
                    sess['error'] = sess['message']
                else:
                    sess['status'] = 'done'
                    if skipped_rtsp and not sess.get('message'):
                        sess['message'] = 'RTSP пропущен: нет OpenCV'
                sess['finished_at'] = time.time()
                # Ensure progress current reaches total when finished cleanly
                if sess['status'] in ('done', 'failed') and not (
                    sess.get('message') or ''
                ).startswith('Поиск прерван'):
                    sess['progress']['current'] = sess['progress']['total']
    except Exception as exc:
        logger.exception('discover worker failed session=%s', session_id)
        with sess['lock']:
            sess['status'] = 'failed'
            sess['error'] = str(exc)
            sess['message'] = f'Ошибка поиска: {exc}'
            sess['finished_at'] = time.time()
    finally:
        with _sessions_lock:
            if _active_session_id == session_id:
                _active_session_id = None


def start_discover(
    *,
    ip: str,
    username: str = '',
    password: str = '',
    brand: str | None = None,
    http_port: int | None = None,
    rtsp_port: int | None = None,
) -> dict[str, Any]:
    """Validate request, auto-cancel previous session, start worker thread."""
    global _active_session_id

    host, resolved_http, resolved_rtsp = parse_ip_and_ports(ip, http_port, rtsp_port)

    brand_norm: str | None = None
    if brand is not None and str(brand).strip():
        brand_norm = str(brand).strip().lower()
        if brand_norm in ('unknown', 'none'):
            brand_norm = None
        elif brand_norm not in BRAND_LABELS:
            raise ValueError(f'Неизвестный бренд: {brand}')

    with _sessions_lock:
        _gc_sessions_locked()
        if _active_session_id and _active_session_id in _sessions:
            prev = _sessions[_active_session_id]
            if prev['status'] == 'running':
                _cancel_session_locked(prev)

        session_id = uuid.uuid4().hex
        sess: dict[str, Any] = {
            'id': session_id,
            'status': 'running',
            'created_at': time.time(),
            'finished_at': None,
            'cancel_event': threading.Event(),
            'lock': threading.Lock(),
            'request': {
                'ip': host,
                'username': username or '',
                'password': password or '',
                'brand': brand_norm,
                'http_port': resolved_http,
                'rtsp_port': resolved_rtsp,
            },
            'progress': {'current': 0, 'total': 0, 'label': ''},
            'candidates': [],
            'skipped_rtsp': False,
            'message': None,
            'error': None,
        }
        _sessions[session_id] = sess
        _active_session_id = session_id
        _gc_sessions_locked()

    thread = threading.Thread(
        target=_worker,
        args=(session_id,),
        name=f'discover-{session_id[:8]}',
        daemon=True,
    )
    thread.start()
    return _session_public(sess)


def get_discover(session_id: str) -> dict[str, Any]:
    with _sessions_lock:
        _gc_sessions_locked()
        sess = _sessions.get(session_id)
    if not sess:
        raise KeyError('Сессия поиска не найдена')
    return _session_public(sess)


def cancel_discover(session_id: str) -> dict[str, Any]:
    with _sessions_lock:
        sess = _sessions.get(session_id)
        if not sess:
            raise KeyError('Сессия поиска не найдена')
        _cancel_session_locked(sess)
    return _session_public(sess)


def get_brands() -> list[dict[str, str]]:
    return list_brands()


def reset_sessions_for_tests() -> None:
    """Clear in-memory sessions (unit tests only)."""
    global _active_session_id
    with _sessions_lock:
        for sess in _sessions.values():
            sess['cancel_event'].set()
        _sessions.clear()
        _active_session_id = None
