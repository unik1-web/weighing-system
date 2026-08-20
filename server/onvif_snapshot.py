"""Minimal ONVIF Media GetSnapshotUri client (no heavy SDK).

Used for IQR / generic ONVIF cameras that do not expose a fixed /snapshot.jpg path.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote, urlparse, urlunparse
from xml.etree import ElementTree as ET

import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth

logger = logging.getLogger('onvif_snapshot')

CONNECT_TIMEOUT = 2.5
READ_TIMEOUT = 5.0

_NS = {
    's': 'http://www.w3.org/2003/05/soap-envelope',
    'tds': 'http://www.onvif.org/ver10/device/wsdl',
    'trt': 'http://www.onvif.org/ver10/media/wsdl',
    'tt': 'http://www.onvif.org/ver10/schema',
    'wsse': 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
    'wsu': 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
}


def _wsse_header(username: str, password: str) -> str:
    """WS-UsernameToken PasswordDigest header fragment."""
    nonce_raw = os.urandom(16)
    nonce_b64 = base64.b64encode(nonce_raw).decode('ascii')
    created = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    digest = base64.b64encode(
        hashlib.sha1(nonce_raw + created.encode('utf-8') + password.encode('utf-8')).digest()
    ).decode('ascii')
    user_xml = (
        username.replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
    )
    return f'''<wsse:Security s:mustUnderstand="1"
 xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
 xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <wsse:UsernameToken>
    <wsse:Username>{user_xml}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</wsse:Password>
    <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{nonce_b64}</wsse:Nonce>
    <wsu:Created>{created}</wsu:Created>
  </wsse:UsernameToken>
</wsse:Security>'''


def _soap_envelope(body: str, username: str = '', password: str = '') -> str:
    header = ''
    if username:
        header = f'<s:Header>{_wsse_header(username, password)}</s:Header>'
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:trt="http://www.onvif.org/ver10/media/wsdl" '
        'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" '
        'xmlns:tt="http://www.onvif.org/ver10/schema">'
        f'{header}<s:Body>{body}</s:Body></s:Envelope>'
    )


def _media_endpoints(ip: str, http_port: int) -> list[str]:
    base = f'http://{ip}:{int(http_port)}'
    return [
        f'{base}/onvif/media_service',
        f'{base}/onvif/Media',
        f'{base}/onvif/services',
        f'{base}/onvif/device_service',
        f'{base}/onvif/device',
        f'{base}/onvif/media',
    ]


def _post_soap(
    url: str,
    body: str,
    username: str,
    password: str,
    soap_action: str,
) -> Optional[str]:
    xml = _soap_envelope(body, username, password)
    headers = {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': f'"{soap_action}"',
    }
    auth_attempts: list[Any] = [None]
    if username:
        auth_attempts = [
            HTTPDigestAuth(username, password),
            HTTPBasicAuth(username, password),
            None,
        ]
    for auth in auth_attempts:
        try:
            resp = requests.post(
                url,
                data=xml.encode('utf-8'),
                headers=headers,
                timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                auth=auth,
            )
            if resp.status_code in (401, 403):
                continue
            if resp.status_code >= 400:
                continue
            text = resp.text or ''
            if 'Fault' in text and 'GetSnapshotUriResponse' not in text and 'GetProfilesResponse' not in text:
                continue
            return text
        except requests.RequestException:
            continue
    return None


def _local_tags(root: ET.Element, name: str) -> list[ET.Element]:
    return [el for el in root.iter() if el.tag.rsplit('}', 1)[-1] == name]


def _parse_profile_tokens(xml_text: str) -> list[str]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    tokens: list[str] = []
    for profiles in _local_tags(root, 'Profiles'):
        token = profiles.attrib.get('token')
        if token:
            tokens.append(token)
    for tok_el in _local_tags(root, 'ProfileToken'):
        if tok_el.text and tok_el.text.strip():
            tokens.append(tok_el.text.strip())
    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _parse_snapshot_uri(xml_text: str) -> Optional[str]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    for uri_el in _local_tags(root, 'Uri'):
        if uri_el.text and uri_el.text.strip().lower().startswith('http'):
            return uri_el.text.strip()
    # Fallback: regex if namespaces confuse ElementTree
    match = re.search(r'>(https?://[^<]+)<', xml_text)
    if match:
        return match.group(1).strip()
    return None


def _inject_userinfo(url: str, username: str, password: str) -> str:
    if not username:
        return url
    parsed = urlparse(url)
    if parsed.username is not None:
        return url
    user = quote(username, safe='')
    passwd = quote(password or '', safe='')
    netloc = f'{user}:{passwd}@{parsed.hostname}'
    if parsed.port:
        netloc = f'{netloc}:{parsed.port}'
    return urlunparse(
        (parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)
    )


def resolve_onvif_snapshot_url(
    ip: str,
    *,
    username: str = '',
    password: str = '',
    http_port: int = 80,
) -> Optional[str]:
    """
    Query ONVIF Media GetProfiles + GetSnapshotUri.
    Returns HTTP JPEG URL (with userinfo if credentials given), or None.
    """
    profile_body = '<trt:GetProfiles/>'
    for endpoint in _media_endpoints(ip, http_port):
        profiles_xml = _post_soap(
            endpoint,
            profile_body,
            username,
            password,
            'http://www.onvif.org/ver10/media/wsdl/GetProfiles',
        )
        if not profiles_xml:
            continue
        tokens = _parse_profile_tokens(profiles_xml)
        if not tokens:
            # Some firmware ignores GetProfiles on media; try common tokens
            tokens = ['Profile_1', 'profile_1', 'ProfileToken_1', '000', '1']
        for token in tokens[:4]:
            snap_body = (
                f'<trt:GetSnapshotUri><trt:ProfileToken>{token}</trt:ProfileToken></trt:GetSnapshotUri>'
            )
            snap_xml = _post_soap(
                endpoint,
                snap_body,
                username,
                password,
                'http://www.onvif.org/ver10/media/wsdl/GetSnapshotUri',
            )
            if not snap_xml:
                continue
            uri = _parse_snapshot_uri(snap_xml)
            if uri:
                final = _inject_userinfo(uri, username, password)
                logger.info('ONVIF snapshot URI for %s:%s → %s', ip, http_port, final.split('@')[-1])
                return final
    return None
