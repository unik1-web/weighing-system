# Stage 6 yearly archive smoke evidence (archive)

## Контекст запуска
- Дата (UTC): `2026-07-31T04:46:09.065657+00:00`
- Запуск: `stage6-task-3-2-archive`
- Scenario: `archive`
- Платформа: `Linux-6.12.94+-x86_64-with-glibc2.39`
- Python: `3.12.3`
- Base URL: `http://127.0.0.1:5031`
- Origin: `http://127.0.0.1:5031`

## Итог
- status: `PASS`
- all_steps_passed: `True`
- passed_steps: `8`
- failed_steps: `0`

## Шаги smoke
### health: PASSED
- Request: `GET /api/health`
- HTTP status: `200`
- Duration: `3 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "service": "weighing-system-api",
  "success": true
}
```

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

### archive_years: PASSED
- Request: `GET /api/archive/years`
- HTTP status: `200`
- Duration: `3 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "success": true,
  "years": [
    {
      "file_name": "weighing-2025.db",
      "label": "Архив 2025",
      "year": 2025
    }
  ]
}
```

### archive_tickets: PASSED
- Request: `GET /api/archive/tickets?year=2025`
- HTTP status: `200`
- Duration: `4 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "success": true,
  "tickets": [
    {
      "auto_closed": false,
      "cargo_name": "Грунт",
      "carrier_name": "ООО Перевозчик",
      "completed_at": "2025-06-01T09:10:00",
      "created_at": "2025-06-01T09:00:00",
      "driver_name": "Иванов",
      "gross_datetime": "2025-06-01T09:00:00",
      "gross_raw": null,
      "gross_source": "manual",
      "gross_weight": 20000.0,
      "id": "arch-sent",
      "manual_weight_reason": null,
      "net_weight": 12000.0,
      "notes": "",
      "operator_id": null,
      "operator_name": "",
      "photo_entry_path": null,
      "photo_exit_path": null,
      "plate_source": null,
      "price": 100.0,
      "receiver_name": "ООО Получатель",
      "reo_sent_at": "2025-06-01T10:00:00",
      "reo_status": "sent",
      "scale_device": "",
      "scale_id": null,
      "scale_role": null,
      "shipper_name": "ООО Отправитель",
      "site_id": null,
      "status": "completed",
      "tare_datetime": null,
      "tare_raw": null,
      "tare_source": "manual",
      "tare_weight": 8000.0,
      "ticket_number": 77,
      "total_amount": 1500.0,
      "trailer_number": "",
      "vat_rate": 20.0,
      "vehicle_brand": "КАМАЗ",
      "vehicle_number": "A111AA56",
      "version": 1,
      "weighing_mode": "single"
    },
    {
      "auto_closed": false,
      "cargo_name": "Грунт",
      "carrier_name": "ООО Перевозчик",
      "completed_at": "2024-12-31T12:10:00",
      "created_at": "2024-12-31T12:00:00",
      "driver_name": "Петров",
      "gross_datetime": "2024-12-31T12:00:00",
      "gross_raw": null,
      "gross_source": "manual",
      "gross_weight": 18000.0,
      "id": "arch-mixed",
      "manual_weight_reason": null,
      "net_weight": 11000.0,
      "notes": "",
      "operator_id": null,
      "operator_name": "",
      "photo_entry_path": null,
      "photo_exit_path": null,
      "plate_source": null,
      "price": 100.0,
      "receiver_name": "ООО Получатель",
      "reo_sent_at": null,
      "reo_status": "pending",
      "scale_device": "",
      "scale_id": null,
      "scale_role": null,
      "shipper_name": "ООО Отправитель",
      "site_id": null,
      "status": "completed",
      "tare_datetime": null,
      "tare_raw": null,
      "tare_source": "manual",
      "tare_weight": 7000.0,
      "ticket_number": 78,
      "total_amount": 1500.0,
      "trailer_number": "",
      "vat_rate": 20.0,
      "vehicle_brand": "КАМАЗ",
      "vehicle_number": "B222BB56",
      "version": 1,
      "weighing_mode": "single"
    }
  ],
  "warning": {
    "archive_year": 2025,
    "code": "mixed_legacy_year_mismatch",
    "message": "В legacy-базе обнаружены тикеты за другие календарные годы; данные оставлены в одном архивном контейнере года миграции.",
    "ticket_years": [
      2024,
      2025
    ]
  },
  "year": 2025
}
```

### archive_ticket: PASSED
- Request: `GET /api/archive/tickets/arch-sent?year=2025`
- HTTP status: `200`
- Duration: `3 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "success": true,
  "ticket": {
    "auto_closed": false,
    "cargo_name": "Грунт",
    "carrier_name": "ООО Перевозчик",
    "completed_at": "2025-06-01T09:10:00",
    "created_at": "2025-06-01T09:00:00",
    "driver_name": "Иванов",
    "gross_datetime": "2025-06-01T09:00:00",
    "gross_raw": null,
    "gross_source": "manual",
    "gross_weight": 20000.0,
    "id": "arch-sent",
    "manual_weight_reason": null,
    "net_weight": 12000.0,
    "notes": "",
    "operator_id": null,
    "operator_name": "",
    "photo_entry_path": null,
    "photo_exit_path": null,
    "plate_source": null,
    "price": 100.0,
    "receiver_name": "ООО Получатель",
    "reo_sent_at": "2025-06-01T10:00:00",
    "reo_status": "sent",
    "scale_device": "",
    "scale_id": null,
    "scale_role": null,
    "shipper_name": "ООО Отправитель",
    "site_id": null,
    "status": "completed",
    "tare_datetime": null,
    "tare_raw": null,
    "tare_source": "manual",
    "tare_weight": 8000.0,
    "ticket_number": 77,
    "total_amount": 1500.0,
    "trailer_number": "",
    "vat_rate": 20.0,
    "vehicle_brand": "КАМАЗ",
    "vehicle_number": "A111AA56",
    "version": 1,
    "weighing_mode": "single"
  },
  "year": 2025
}
```

### archive_edit_forbidden: PASSED
- Request: `PATCH /api/archive/tickets/arch-sent`
- HTTP status: `422`
- Duration: `3 ms`
- Expected ok: `False`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "code": "archive_edit_forbidden_field",
  "message": "Запрещено изменять поле ticket_number",
  "success": false
}
```

### archive_edit_sent_reo_ack_required: PASSED
- Request: `PATCH /api/archive/tickets/arch-sent`
- HTTP status: `409`
- Duration: `4 ms`
- Expected ok: `False`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "code": "archive_reo_ack_required",
  "message": "Нужно подтвердить предупреждение для тикета, уже отправленного в РЭО",
  "success": false
}
```

### archive_edit_sent_reo_with_ack: PASSED
- Request: `PATCH /api/archive/tickets/arch-sent`
- HTTP status: `200`
- Duration: `5 ms`
- Expected ok: `True`
- Error: `none`
- Contract error: `none`
- Note: `none`
- Response:
```json
{
  "audit_event": {
    "actor_id": "smoke-user",
    "actor_name": "Smoke Operator",
    "changed_fields": [
      "driver_name"
    ],
    "event_type": "archive_edit",
    "new_values": {
      "driver_name": "Сидоров"
    },
    "old_values": {
      "driver_name": "Иванов"
    },
    "reo_divergence_warning": true,
    "source_year": 2025,
    "timestamp": "2026-07-31T04:46:09.063879Z"
  },
  "success": true,
  "ticket": {
    "auto_closed": false,
    "cargo_name": "Грунт",
    "carrier_name": "ООО Перевозчик",
    "completed_at": "2025-06-01T09:10:00",
    "created_at": "2025-06-01T09:00:00",
    "driver_name": "Сидоров",
    "gross_datetime": "2025-06-01T09:00:00",
    "gross_raw": null,
    "gross_source": "manual",
    "gross_weight": 20000.0,
    "id": "arch-sent",
    "manual_weight_reason": null,
    "net_weight": 12000.0,
    "notes": "",
    "operator_id": null,
    "operator_name": "",
    "photo_entry_path": null,
    "photo_exit_path": null,
    "plate_source": null,
    "price": 100.0,
    "receiver_name": "ООО Получатель",
    "reo_sent_at": "2025-06-01T10:00:00",
    "reo_status": "sent",
    "scale_device": "",
    "scale_id": null,
    "scale_role": null,
    "shipper_name": "ООО Отправитель",
    "site_id": null,
    "status": "completed",
    "tare_datetime": null,
    "tare_raw": null,
    "tare_source": "manual",
    "tare_weight": 8000.0,
    "ticket_number": 77,
    "total_amount": 1500.0,
    "trailer_number": "",
    "vat_rate": 20.0,
    "vehicle_brand": "КАМАЗ",
    "vehicle_number": "A111AA56",
    "version": 1,
    "weighing_mode": "single"
  },
  "warning": {
    "code": "archive_reo_sent_warning",
    "message": "Архивный тикет уже отправлялся в РЭО; статус сохранён как sent"
  },
  "year": 2025
}
```
