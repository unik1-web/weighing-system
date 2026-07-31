# Acceptance report: scale adapters gate

| EC-ID | Status | Evidence | Note |
|---|---|---|---|
| EC-01 | PASS | `src/lib/__tests__/scale-adapters-builtins.test.ts`, `src/lib/__tests__/scale-adapters-parity.test.ts`, `server/tests/test_scale_adapter_parity.py` | Встроенные профили и fixture parity frontend/backend покрыты автотестами. |
| EC-02 | PASS | `src/lib/__tests__/manual-weight-reason.test.ts`, `src/lib/__tests__/weighing-scale-runtime-flow.test.ts`, `server/tests/test_scale_api_contract.py` | Ошибки runtime/API переводят поток в manual-only без блокировки ручного ввода. |
| EC-03 | PASS | `server/tests/test_scale_runtime_switch.py`, `server/tests/test_scale_api_contract.py`, `src/lib/__tests__/site-runtime-switch.test.ts` | Авточтение и API-сессии привязаны к active scale из `site_runtime`; stale-сессии валидируются. |
| EC-04 | PASS | `docs/reports/scale-adapters/scale-adapters-smoke.md`, `server/tests/test_serial_backend_transport.py`, `server/tests/test_scale_api_contract.py` | Программный контур `serial_backend` и `/api/scales/*` подтверждён: без физического COM API корректно отвечает `503 transport_unavailable`. Live COM + Windows `.exe` — операционный checklist (`scale-adapters-exe-checklist.md`), не блокер кода этапа. |
| EC-05 | PASS | `docs/api.md`, `server/tests/test_api_smoke_weighing_settings.py` | Контракты `/api/config`, `/api/database`, `/api/storage` сохранены, `/api/scales/*` добавлен отдельно. |
| EC-06 | PASS | `server/tests/test_scale_integrity.py`, `scripts/smoke_scale_api.py`, `docs/reports/scale-adapters/scale-adapters-smoke.md` | Логи и smoke-отчёт используют redaction чувствительных параметров подключения. |
| EC-07 | PASS | `server/tests/test_stage5_migration.py`, `docs/scale-adapters-deploy.md` | Legacy migration `scale_device_id` и stage-5 migration покрыты тестами и runbook. |
| EC-08 | PASS | `server/tests/test_scale_runtime_switch.py`, `server/tests/test_scale_api_contract.py` | При switch старая backend-сессия инвалидируется и возвращает `stale_session`/`inactive_scale_mismatch`. |
| EC-09 | PASS | `docs/reports/scale-adapters/scale-adapters-acceptance.md` | Все EC-01..EC-08 в статусе PASS для программного gate этапа. |

## Ограничения среды
- Live COM/TTY и полный Windows `.exe` smoke остаются в операционном checklist и выполняются на целевой площадке.
