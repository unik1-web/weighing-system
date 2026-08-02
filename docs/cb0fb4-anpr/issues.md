# Реестр проблем: cb0fb4-anpr

## Итог

Задача завершена. Зафиксировано проблем: **0** возвратов (analysis ↔ architect, code-review → development, testing → development). Некритичные замечания ревью и пробелы покрытия — ниже.

Задача прошла все этапы без возвратов.

## Проблемы в процессе разработки

Возвратов между этапами не было.

## Замечания код-ревью

Некритичные (Approve без доработки, as-is):

1. **OnnxAnprEngine при наличии `plate.onnx`** помечает `model_loaded=true`, но `recognize` raises до привязки I/O конкретной модели (ожидаемо до спайка) — не путать с production-ready инференсом.
2. **Client `canOfferAnpr`** не проверяет `anpr_available`: кнопка может быть активна при включённом флаге без модели → API вернёт `disabled_by_configuration` (приемлемо).
3. **`auditCreateFields`** ставит `disabled_by_configuration` при spare / `!anpr_enabled`; при `video_off` / нет overview без клика Recognize статус тикета может остаться `null` (таблица architecture шире — не блокер).
4. **ThreadPoolExecutor** при FuturesTimeout не отменяет поток инференса (смягчено таймаутами cameras ~4 s и wall-clock recognize 5 s).

## Проблемы тестирования

Возвратов testing → development не было. Suite зелёный на момент приёмки:

- Backend anpr: 10 passed (`test_anpr_gate` + `test_anpr_recognize`).
- Frontend: 15 passed (anpr + vehicle-resolve); typecheck OK.
- Регрессии camera / ticket / site_runtime / spare: 20 passed.

Некритичные пробелы покрытия (предложены тестировщиком, не блокируют):

1. Явный API-тест `anpr_unavailable` (FakeEngine `available=False`) → `engine_invoked=false`, `reason=anpr_unavailable`.
2. Client: `recognizePlate` при сетевой ошибке → `anpr_status=failed` без throw.
3. Unit на `crop_roi` (нормализованный ROI).

## Известные ограничения (продукт)

- Реальный ONNX I/O mapping под конкретные веса отложен до спайка объекта; без модели — `UnavailableAnprEngine`, `anpr_available=false`.
- `anpr_enabled` default **false** до спайка с точностью ≥ 50% (`docs/implementation/anpr-spike-checklist.md`).
- Полный UI отчётов/фильтров по `anpr_*` — этап 9.
