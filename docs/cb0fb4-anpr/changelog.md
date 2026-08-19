# История изменений: cb0fb4-anpr

## Описание задачи

Источник: `docs/tasks/08-anpr.md`.

Цель: локальный ANPR (этап 8) поверх этапов 3/4/7 — распознавание госномера по кадру overview (+ ROI) без облака/СКУД; предложение номера + confidence с подтверждением оператором (Принять / Править / Вручную); поля `anpr_*` / `plate_confidence` в тикете; на spare / при выкл. флаге движок не вызывается (`disabled_by_configuration`); ошибка кадра/модели → `failed` без блокировки взвешивания; после подтверждения — `resolveVehicle` и автоподстановка; dual-build (базовая без onnx, полная с моделью вне git); релиз `anpr_enabled` только после спайка ≥ 50%.

Зависимости: этап 7 (фото/overview), `anpr_mode` из этапа 4. Вне скоупа: облако/СКУД, long-focus на spare, полный UI отчётов (этап 9).

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR1–FR11 и NFR1–NFR5 — локальный инференс overview, gate (anpr_mode / video / overview / сборка), spare → `disabled_by_configuration`, failed без блокировки веса, UI подтверждения оператором, поля тикета, связь с `resolveVehicle` / `plate_source`, момент запуска, feature-flag и порог 50%, минимум для отчётов, тесты. Критических открытых вопросов нет.

### [Архитектура] Execution 2
- Статус: done
- Результат: API `/api/anpr/*`, модуль `server/anpr.py` + pluggable `AnprEngine` (ONNX / stub), dual gate (`anpr_enabled` + `anpr_mode`), confidence REAL 0..1, UI-кнопка «Распознать номер», ROI crop на backend, модель `{app_root}/models/anpr/` вне git. Артефакты: `docs/cb0fb4-anpr/architecture.md`, `docs/implementation/anpr-spike-checklist.md`. Возврат в analysis не требуется.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы: `server/anpr.py`, `server/app.py`, `server/sqlite_store.py`, `server/tests/test_anpr_gate.py`, `server/tests/test_anpr_recognize.py`, `src/lib/anpr.ts`, `src/lib/__tests__/anpr.test.ts`, `src/lib/vehicle-resolve.ts` (+ тест override), `src/lib/storage.ts`, `WeighingForm.tsx`, `SettingsView.tsx`, `docs/api.md`, `.gitignore` (`/models/`), `installer/weighing-system.spec`, чеклист спайка. Проверки: pytest anpr 10 passed; vitest anpr+resolve 15 passed; typecheck OK; регрессии cameras/ticket 14 passed.

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: соответствие архитектуре подтверждено; критических замечаний нет. Некритичные замечания (ONNX I/O до спайка, canOfferAnpr без anpr_available, auditCreateFields/null status, ThreadPool после timeout) — для сведения, не блокер. Переход к testing.

### [Тестирование] Execution 5
- Статус: done
- Результат: pytest anpr — **10 passed**; vitest anpr + vehicle-resolve — **15 passed**; регрессии camera/ticket/site_runtime/spare — **20 passed**; typecheck OK. Покрыты FR2–FR7, FR9, FR11 / gate spare / failed vs disabled / plate_source. Предложены опциональные доп. тесты (anpr_unavailable, network→failed, crop_roi) — на диск не записывались, не блокируют.

### [Документация] Execution 6
- Статус: done
- Результат: `docs/cb0fb4-anpr/{changelog,issues,deploy-notes}.md` (+ существующий `architecture.md`); обновлена точка продолжения в `docs/tasks/README.md` → этап 09.

## Git история

```
1350984 feat(anpr): local plate recognition with operator confirm
87d05f9 docs(anpr): architecture for stage 08 (cb0fb4)
```

Коммит `87d05f9`: архитектурный документ и чеклист спайка.

Коммит `1350984`: 17 файлов, +1592/−27 — реализация ANPR (gate/API, поля тикета, UI confirm, stub engine, тесты, api.md, installer notes).
