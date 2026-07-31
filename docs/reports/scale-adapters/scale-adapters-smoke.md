# Scale API smoke evidence

## Контекст запуска
- Дата (UTC): `2026-07-31T02:21:33.709561+00:00`
- Запуск: `local-backend-5008-origin-localhost`
- Платформа: `Linux-6.12.94+-x86_64-with-glibc2.39`
- Python: `3.12.3`
- Base URL: `http://127.0.0.1:5008`
- Origin: `http://localhost:5173`
- Active scale context: `default-site` / `scale-primary` / `primary`
- Session ID: `n/a`

## Итог
- all_steps_passed: `False`
- passed_steps: `0`
- failed_steps: `1`

## Шаги smoke
### connect: FAILED
- Request: `POST /api/scales/connect`
- HTTP status: `503`
- Duration: `6 ms`
- Error: `none`
- Response (redacted):
```json
{
  "code": "transport_unavailable",
  "message": "Не удалось открыть serial порт",
  "success": false
}
```

## Интерпретация для acceptance
Без физического COM/TTY `503 transport_unavailable` на `connect` является ожидаемым результатом программного smoke.
Контракт API, security guard и transport-слой покрыты автотестами (`server/tests/test_serial_backend_transport.py`, `test_scale_api_contract.py`, `test_scale_api_security.py`).
Live serial и Windows `.exe` фиксируются отдельно в `scale-adapters-exe-checklist.md`.
