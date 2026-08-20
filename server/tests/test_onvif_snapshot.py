"""Tests for ONVIF GetSnapshotUri helpers and IQR templates."""

from onvif_snapshot import _inject_userinfo, _parse_profile_tokens, _parse_snapshot_uri
from camera_templates import build_attempt_plan, TEMPLATES


def test_parse_profile_tokens():
    xml = '''<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
                xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
                xmlns:tt="http://www.onvif.org/ver10/schema">
      <s:Body>
        <trt:GetProfilesResponse>
          <trt:Profiles token="Profile_1" fixed="true">
            <tt:Name>main</tt:Name>
          </trt:Profiles>
          <trt:Profiles token="Profile_2">
            <tt:Name>sub</tt:Name>
          </trt:Profiles>
        </trt:GetProfilesResponse>
      </s:Body>
    </s:Envelope>'''
    assert _parse_profile_tokens(xml) == ['Profile_1', 'Profile_2']


def test_parse_snapshot_uri():
    xml = '''<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
                xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
                xmlns:tt="http://www.onvif.org/ver10/schema">
      <s:Body>
        <trt:GetSnapshotUriResponse>
          <trt:MediaUri>
            <tt:Uri>http://192.168.1.3/webcapture.jpg?command=snap&amp;channel=1</tt:Uri>
          </trt:MediaUri>
        </trt:GetSnapshotUriResponse>
      </s:Body>
    </s:Envelope>'''
    uri = _parse_snapshot_uri(xml)
    assert uri is not None
    assert 'webcapture.jpg' in uri
    assert '192.168.1.3' in uri


def test_inject_userinfo():
    url = _inject_userinfo('http://192.168.1.3/snap.jpg', 'admin', 'secret')
    assert url.startswith('http://admin:secret@192.168.1.3/')


def test_iqr_plan_has_oem_http_paths():
    plan, skipped = build_attempt_plan('iqr', opencv_available=False)
    assert skipped is True
    ids = [t['id'] for t in plan]
    assert 'iqr-webcapture-snap' in ids
    assert 'iqr-onvif-http-snapshot' in ids
    assert all(t['kind'] == 'http_snapshot' for t in plan)


def test_iqr_templates_in_catalog():
    brands = {t['brand'] for t in TEMPLATES}
    assert 'iqr' in brands
