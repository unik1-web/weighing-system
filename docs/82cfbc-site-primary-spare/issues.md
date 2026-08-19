# Реестр проблем: 82cfbc-site-primary-spare

## Итог

Задача завершена. Зафиксировано проблем: 1 (возврат code-review → development). После фикса повторное ревью одобрило; тестирование прошло без возвратов.

## Проблемы в процессе разработки

### ISSUE-1: Disable spare при active_scale_set=spare → split-brain

- **Этап**: code-review (#4) → development (#5)
- **Описание**: В `SettingsView.handleSave` можно было снять «Резервные весы включены» и сохранить, пока runtime на spare. Spare становился `enabled=false`, а `site_runtime.active_scale_set` оставался `spare`. `getActiveScaleContext()` молча откатывался на primary: новые тикеты получали `scale_id`/`scale_role` primary, `scale_device_id` синхронизировался с primary, UI продолжал показывать «Резервные». Нарушение FR3/FR5 (источник истины комплекта vs запись в талоны).
- **Решение**: добавлен `disableSpareScale()` с запретом disable при `active_scale_set=spare` (сообщение «Сначала вернитесь на основные…»); SettingsView сохраняет через него и блокирует снятие галочки в UI. Silent fallback в `getActiveScaleContext` заменён на `logger.warn` + атомарный self-heal runtime на primary + sync `scale_device_id`. Тесты: forbid disable-on-spare, allow на primary, heal+log.
- **Execution**: #4 (обнаружение), #5 (исправление), #6 (Approve)

## Замечания код-ревью

### Execution 4 (Request Changes) — некритичные

- FR7 «фокус на поле госномера» после switch не реализован: wizard только в Settings — приемлемо для этапа 4.
- Дублирующий селект «Модель весов активного комплекта» и профили primary/spare в одной форме — синхронизированы, но могут путать оператора.
- `docs/api.md` упоминает ключи одной строкой без полной схемы полей — достаточно для этапа.

### Execution 6 (Approve) — некритичные (для сведения)

- `upsertScale` / `ScalesStorage.upsert` теоретически обходят запрет при прямом вызове (UI-путь закрыт) — приемлемо.
- При heal last-switch поля runtime не сбрасываются — UI истории не ломается.
- FR7 фокус на госномере после switch из Settings — по-прежнему nice-to-have этапа 4.

## Проблемы тестирования

Возвратов testing → development не было. Execution 7: все проверки зелёные (Vitest 91, pytest 62). Опциональные усиления тестов предложены текстом в `output_data` тестировщика и на диск не записывались — не блокеры приёмки.
