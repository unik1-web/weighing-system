"""API smoke: config defaults, single/dual database branches, health (Flask test client)."""

import json
import sqlite3

import sqlite_store


WEIGHING_KEYS = (
    'weighing_mode_default',
    'stable_mode',
    'tara_threshold',
    'max_time_between',
    'tara_default',
)


def _base_ticket(**overrides):
    ticket = {
        'id': 'smoke-1',
        'ticket_number': 1,
        'vehicle_number': 'А001АА56',
        'vehicle_brand': '',
        'trailer_number': '',
        'driver_name': 'Иванов',
        'cargo_name': 'Грунт',
        'shipper_name': 'А',
        'receiver_name': 'Б',
        'carrier_name': 'В',
        'price': 100,
        'vat_rate': 20,
        'gross_weight': 20000,
        'tare_weight': 5000,
        'net_weight': 15000,
        'total_amount': 1500,
        'gross_source': 'manual',
        'tare_source': 'manual',
        'gross_raw': None,
        'tare_raw': None,
        'gross_datetime': '2026-01-01T10:00:00',
        'tare_datetime': '2026-01-01T10:05:00',
        'scale_device': '',
        'operator_id': None,
        'operator_name': 'Оператор',
        'status': 'completed',
        'reo_status': 'pending',
        'reo_sent_at': None,
        'notes': '',
        'created_at': '2026-01-01T10:00:00',
        'completed_at': '2026-01-01T10:05:00',
        'weighing_mode': 'single',
        'version': 1,
    }
    ticket.update(overrides)
    return ticket


def test_smoke_health_and_config_defaults_branch(api_client):
    health = api_client.get('/api/health')
    assert health.status_code == 200
    assert health.get_json().get('success') is True

    empty = api_client.get('/api/config')
    assert empty.status_code == 200
    config = empty.get_json()['config']
    for key in WEIGHING_KEYS:
        assert key not in config

    payload = {
        'weighing_mode_default': 'single',
        'stable_mode': 'false',
        'tara_threshold': '15000',
        'max_time_between': '24',
        'tara_default': '0',
    }
    saved = api_client.post('/api/config', json={'config': payload})
    assert saved.status_code == 200
    loaded = api_client.get('/api/config').get_json()['config']
    for key, value in payload.items():
        assert loaded[key] == value


def test_smoke_single_completed_path(api_client):
    ticket = _base_ticket(weighing_mode='single', status='completed', version=1)
    audit = [
        {
            'id': 'a-created',
            'ticket_id': ticket['id'],
            'action': 'created',
            'at': ticket['created_at'],
            'operator_name': 'Оператор',
            'operator_id': None,
        },
        {
            'id': 'a-completed',
            'ticket_id': ticket['id'],
            'action': 'completed',
            'at': ticket['completed_at'],
            'operator_name': 'Оператор',
            'operator_id': None,
        },
    ]
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([ticket], ensure_ascii=False),
                'app_ticket_audit': json.dumps(audit, ensure_ascii=False),
            }
        },
    )
    data = api_client.get('/api/database').get_json()['data']
    loaded = json.loads(data['app_weighing_tickets'])[0]
    assert loaded['weighing_mode'] == 'single'
    assert loaded['status'] == 'completed'
    assert loaded['version'] == 1
    actions = [e['action'] for e in json.loads(data['app_ticket_audit'])]
    assert actions == ['created', 'completed']


def test_smoke_dual_open_then_complete_path(api_client):
    open_ticket = _base_ticket(
        id='dual-1',
        status='open',
        weighing_mode='dual',
        tare_weight=None,
        net_weight=None,
        total_amount=None,
        tare_datetime=None,
        completed_at=None,
        version=1,
    )
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([open_ticket], ensure_ascii=False),
                'app_ticket_audit': json.dumps(
                    [
                        {
                            'id': 'a1',
                            'ticket_id': 'dual-1',
                            'action': 'created',
                            'at': open_ticket['created_at'],
                            'operator_name': 'Оператор',
                            'operator_id': None,
                        }
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    data = api_client.get('/api/database').get_json()['data']
    loaded_open = json.loads(data['app_weighing_tickets'])[0]
    assert loaded_open['status'] == 'open'
    assert loaded_open['weighing_mode'] == 'dual'

    completed = dict(loaded_open)
    completed.update(
        {
            'tare_weight': 5000,
            'tare_datetime': '2026-01-01T11:00:00',
            'net_weight': 15000,
            'total_amount': 1500,
            'status': 'completed',
            'completed_at': '2026-01-01T11:00:00',
            'version': 2,
        }
    )
    api_client.post(
        '/api/database',
        json={
            'data': {
                'app_weighing_tickets': json.dumps([completed], ensure_ascii=False),
                'app_ticket_audit': json.dumps(
                    [
                        {
                            'id': 'a1',
                            'ticket_id': 'dual-1',
                            'action': 'created',
                            'at': open_ticket['created_at'],
                            'operator_name': 'Оператор',
                            'operator_id': None,
                        },
                        {
                            'id': 'a2',
                            'ticket_id': 'dual-1',
                            'action': 'completed',
                            'at': completed['completed_at'],
                            'operator_name': 'Оператор',
                            'operator_id': None,
                        },
                    ],
                    ensure_ascii=False,
                ),
            }
        },
    )
    data = api_client.get('/api/database').get_json()['data']
    loaded = json.loads(data['app_weighing_tickets'])[0]
    assert loaded['status'] == 'completed'
    assert loaded['weighing_mode'] == 'dual'
    assert loaded['version'] == 2
    assert [e['action'] for e in json.loads(data['app_ticket_audit'])] == [
        'created',
        'completed',
    ]


def test_smoke_migrate_legacy_db_via_api_read(api_client, temp_app_root):
    """First API read on legacy schema adds columns and backfills open→dual."""
    db_path = sqlite_store.get_sqlite_path()
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            '''
            CREATE TABLE weighing_tickets (
                id TEXT PRIMARY KEY,
                ticket_number INTEGER,
                vehicle_number TEXT NOT NULL DEFAULT '',
                vehicle_brand TEXT NOT NULL DEFAULT '',
                trailer_number TEXT NOT NULL DEFAULT '',
                driver_name TEXT NOT NULL DEFAULT '',
                cargo_name TEXT NOT NULL DEFAULT '',
                shipper_name TEXT NOT NULL DEFAULT '',
                receiver_name TEXT NOT NULL DEFAULT '',
                carrier_name TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL DEFAULT 0,
                vat_rate REAL NOT NULL DEFAULT 0,
                gross_weight REAL,
                tare_weight REAL,
                net_weight REAL,
                total_amount REAL,
                gross_source TEXT NOT NULL DEFAULT 'manual',
                tare_source TEXT NOT NULL DEFAULT 'manual',
                gross_raw TEXT,
                tare_raw TEXT,
                gross_datetime TEXT,
                tare_datetime TEXT,
                scale_device TEXT NOT NULL DEFAULT '',
                operator_id TEXT,
                operator_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                reo_status TEXT NOT NULL DEFAULT 'pending',
                reo_sent_at TEXT,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            '''
        )
        connection.execute(
            '''
            INSERT INTO weighing_tickets (
                id, ticket_number, vehicle_number, status, created_at, operator_name
            ) VALUES (?, ?, ?, ?, ?, ?)
            ''',
            ('legacy-open', 1, 'A001', 'open', '2026-01-01T00:00:00', 'Op'),
        )
        connection.commit()
    finally:
        connection.close()

    data = api_client.get('/api/database').get_json()['data']
    tickets = json.loads(data['app_weighing_tickets'])
    assert len(tickets) == 1
    assert tickets[0]['weighing_mode'] == 'dual'
    assert tickets[0]['version'] == 1
    assert 'app_ticket_audit' not in data or data.get('app_ticket_audit') is not None
