"""ANPR gate: spare / flags / no overview → engine not invoked."""

import json
from unittest.mock import patch

import anpr
import year_db
from config_ini import CONFIG_SECTION, write_ini_section
from sqlite_store import write_database


class FakeEngine:
    def __init__(self, available=True, plate='А123ВС56', confidence=0.87, error=None):
        self.available = available
        self.plate = plate
        self.confidence = confidence
        self.error = error
        self.calls = 0

    def is_available(self) -> bool:
        return self.available

    def recognize(self, jpeg: bytes) -> tuple[str, float]:
        self.calls += 1
        if self.error:
            raise RuntimeError(self.error)
        return self.plate, self.confidence


def _write_config(temp_app_root, **kwargs):
    base = {'active_year': '2026', 'video_enabled': 'false', 'anpr_enabled': 'false'}
    base.update(kwargs)
    write_ini_section(str(temp_app_root / 'config.ini'), CONFIG_SECTION, base)


def _seed(anpr_mode='enabled', with_overview=True):
    year_db.write_active_year(2026)
    cameras = []
    if with_overview:
        cameras.append(
            {
                'id': 'cam-overview',
                'site_id': 'site-1',
                'role': 'overview',
                'name': 'Обзор',
                'capture_url': 'http://127.0.0.1:9/overview.jpg',
                'capture_kind': 'http_snapshot',
                'enabled': True,
                'sort_order': 0,
                'roi': {'x': 0.1, 'y': 0.1, 'w': 0.8, 'h': 0.8},
                'reference_normal_path': None,
                'reference_spare_path': None,
                'created_at': '2026-08-02T00:00:00',
            }
        )
    write_database(
        {
            'app_sites': json.dumps(
                [
                    {
                        'id': 'site-1',
                        'name': 'Площадка',
                        'is_default': True,
                        'created_at': '2026-08-02T00:00:00',
                    }
                ],
                ensure_ascii=False,
            ),
            'app_site_runtime': json.dumps(
                [
                    {
                        'site_id': 'site-1',
                        'active_scale_set': 'primary' if anpr_mode == 'enabled' else 'spare',
                        'camera_mode': 'normal' if anpr_mode == 'enabled' else 'spare',
                        'anpr_mode': anpr_mode,
                        'switch_reason': None,
                        'switch_by_operator_id': None,
                        'switch_by_operator_name': None,
                        'switch_at': None,
                    }
                ],
                ensure_ascii=False,
            ),
            'app_cameras': json.dumps(cameras, ensure_ascii=False),
            'app_weighing_tickets': json.dumps([], ensure_ascii=False),
        }
    )


def test_gate_spare_does_not_invoke_engine(api_client, temp_app_root):
    _write_config(temp_app_root, anpr_enabled='true', video_enabled='true')
    _seed(anpr_mode='disabled_by_configuration')
    engine = FakeEngine()
    anpr.set_engine_override(engine)
    try:
        resp = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'})
        data = resp.get_json()
        assert resp.status_code == 200
        assert data['success'] is True
        assert data['engine_invoked'] is False
        assert data['anpr_status'] == 'disabled_by_configuration'
        assert 'anpr_mode' in (data.get('reason') or '')
        assert engine.calls == 0
    finally:
        anpr.set_engine_override(None)


def test_gate_anpr_disabled_flag(api_client, temp_app_root):
    _write_config(temp_app_root, anpr_enabled='false', video_enabled='true')
    _seed(anpr_mode='enabled')
    engine = FakeEngine()
    anpr.set_engine_override(engine)
    try:
        data = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'}).get_json()
        assert data['engine_invoked'] is False
        assert data['anpr_status'] == 'disabled_by_configuration'
        assert data['reason'] == 'anpr_enabled=false'
        assert engine.calls == 0
    finally:
        anpr.set_engine_override(None)


def test_gate_video_disabled(api_client, temp_app_root):
    _write_config(temp_app_root, anpr_enabled='true', video_enabled='false')
    _seed(anpr_mode='enabled')
    engine = FakeEngine()
    anpr.set_engine_override(engine)
    try:
        data = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'}).get_json()
        assert data['engine_invoked'] is False
        assert data['anpr_status'] == 'disabled_by_configuration'
        assert data['reason'] == 'video_enabled=false'
        assert engine.calls == 0
    finally:
        anpr.set_engine_override(None)


def test_gate_no_overview(api_client, temp_app_root):
    _write_config(temp_app_root, anpr_enabled='true', video_enabled='true')
    _seed(anpr_mode='enabled', with_overview=False)
    engine = FakeEngine()
    anpr.set_engine_override(engine)
    try:
        data = api_client.post('/api/anpr/recognize', json={'site_id': 'site-1'}).get_json()
        assert data['engine_invoked'] is False
        assert data['anpr_status'] == 'disabled_by_configuration'
        assert data['reason'] == 'no_overview_camera'
        assert engine.calls == 0
    finally:
        anpr.set_engine_override(None)


def test_capabilities_default_disabled(api_client, temp_app_root):
    _write_config(temp_app_root)
    _seed()
    anpr.set_engine_override(FakeEngine(available=False))
    try:
        data = api_client.get('/api/anpr/capabilities').get_json()
        assert data['success'] is True
        assert data['anpr_enabled'] is False
        assert data['anpr_available'] is False
        assert data['model_loaded'] is False
    finally:
        anpr.set_engine_override(None)
