# Stage 6 yearly archive smoke evidence (fail-retry)

## Контекст запуска
- Дата (UTC): `2026-07-31T04:46:09.891655+00:00`
- Запуск: `stage6-task-3-2-fail-retry`
- Scenario: `fail-retry`
- Платформа: `Linux-6.12.94+-x86_64-with-glibc2.39`
- Python: `3.12.3`
- Base URL: `http://127.0.0.1:5001`
- Origin: `http://127.0.0.1:5001`

## Итог
- status: `PASS`
- all_steps_passed: `True`
- passed_steps: `7`
- failed_steps: `0`

## Шаги smoke
### seed_session: PASSED
- Request: `POST /api/database`
- HTTP status: `200`
- Duration: `5 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "success": true
}
```

### rotation_preview: PASSED
- Request: `POST /api/year/rotation/preview`
- HTTP status: `200`
- Duration: `5 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "blocking_tickets": [],
  "open_candidates": [
    {
      "auto_closed": true,
      "gross_weight": 5000.0,
      "net_weight": 3800.0,
      "source_year": 2025,
      "status": "completed",
      "tare_source": "dictionary",
      "tare_weight": 1200.0,
      "ticket_id": "t-dictionary",
      "ticket_number": 101,
      "total_amount": 9120.0,
      "vehicle_number": "А001АА"
    },
    {
      "auto_closed": true,
      "gross_weight": 4000.0,
      "net_weight": 3100.0,
      "source_year": 2025,
      "status": "completed",
      "tare_source": "default",
      "tare_weight": 900.0,
      "ticket_id": "t-default",
      "ticket_number": 102,
      "total_amount": 11160.0,
      "vehicle_number": "В002ВВ"
    }
  ],
  "pending_reo_count": 1,
  "preview_token": "rotprev_2025_2026_4df321b6897b",
  "rotation_required": true,
  "source_db_fingerprint": "size:159744;mtime:2026-07-31T04:46:09.336641Z",
  "source_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2025.db",
  "source_year": 2025,
  "success": true,
  "target_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2026.db",
  "target_year": 2026
}
```

### rotation_commit_failed: PASSED
- Request: `POST /api/year/rotation/commit`
- HTTP status: `500`
- Duration: `7 ms`
- Expected ok: `False`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "code": "rotation_failed",
  "message": "Ротация не завершена; active_year не переключён: injected failure after backup",
  "success": false
}
```

### active_year_after_fail: PASSED
- Request: `GET /api/config`
- HTTP status: `200`
- Duration: `2 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `2025`
- Response:
```json
{
  "bootstrap": {
    "active_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2025.db",
    "backup_path": null,
    "migration_year": 2025,
    "status": "ready",
    "warning": {
      "archive_year": 2025,
      "code": "mixed_legacy_year_mismatch",
      "message": "В legacy-базе обнаружены тикеты за другие календарные годы; данные оставлены в одном архивном контейнере года миграции.",
      "ticket_years": [
        2025,
        2026
      ]
    }
  },
  "config": {
    "active_year": "2025",
    "manual_weight_reason_policy": "optional",
    "tara_default": "900"
  },
  "success": true
}
```

### rotation_preview: PASSED
- Request: `POST /api/year/rotation/preview`
- HTTP status: `200`
- Duration: `5 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `retry-preview`
- Response:
```json
{
  "blocking_tickets": [],
  "open_candidates": [],
  "pending_reo_count": 1,
  "preview_token": "rotprev_2025_2026_2620e9834fc0",
  "rotation_required": true,
  "source_db_fingerprint": "size:159744;mtime:2026-07-31T04:46:09.352641Z",
  "source_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2025.db",
  "source_year": 2025,
  "success": true,
  "target_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2026.db",
  "target_year": 2026
}
```

### rotation_commit_retry: PASSED
- Request: `POST /api/year/rotation/commit`
- HTTP status: `200`
- Duration: `26 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "auto_closed_count": 0,
  "backup_path": "/tmp/stage6-smoke-stppap5d/app/backup/weighing-2025.db.before-rotation-2026.20260101T100000.bak",
  "new_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2026.db",
  "recovery": {
    "copied_counts": {
      "dictionary_entries": 1,
      "profiles": 1,
      "scales": 0,
      "site_runtime": 0,
      "sites": 0,
      "users": 1,
      "vehicle_drivers": 0
    },
    "mode": "rebuild_target"
  },
  "source_year": 2025,
  "success": true,
  "target_year": 2026
}
```

### active_year_after_retry: PASSED
- Request: `GET /api/config`
- HTTP status: `200`
- Duration: `2 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `2026`
- Response:
```json
{
  "bootstrap": {
    "active_db_path": "/tmp/stage6-smoke-stppap5d/app/BD/weighing-2026.db",
    "backup_path": null,
    "migration_year": 2026,
    "status": "ready",
    "warning": null
  },
  "config": {
    "active_year": "2026",
    "manual_weight_reason_policy": "optional",
    "tara_default": "900"
  },
  "success": true
}
```
