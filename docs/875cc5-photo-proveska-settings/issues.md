# Реестр проблем: 875cc5-photo-proveska-settings

## Итог

Задача завершена. Зафиксировано проблем: **0** возвратов между этапами. Задача прошла все этапы без возвратов.

## Проблемы в процессе разработки

Возвратов analysis ↔ architect ↔ development ↔ code-review ↔ testing не было. Code-review (execution 4) — Approve с первого прохода.

## Замечания код-ревью

Некритичные (Approve, as-is / низкий приоритет):

1. **`TicketPhotoPreview.latestPhotoForRole`**: при отсутствии photo с `camera_id` fallback на любую photo той же role (включая чужой `camera_id`) может неверно показать ok на слоте другой камеры при нескольких камерах одной роли. На типичной схеме 1 камера/роль не проявляется; после реального capture у каждой камеры обычно свой row. Желательно ограничить fallback только photos с `!camera_id`.
2. **Logger-строки** «Создан/Завершён тикет» в `WeighingForm` не переименованы — по архитектуре (низкий приоритет) ок; операторский UI использует «провеска».

## Проблемы тестирования

Возвратов testing → development не было. Suite зелёный на момент приёмки:

- Frontend: **142 passed** (`npm test`); typecheck OK.
- Backend: **113 passed** (`npm run test:server`), в т.ч. `test_tickets_only_sync_preserves_capture_photos`, capture suite, регрессии.

Некритичные пробелы покрытия (предложены тестировщиком, не блокируют):

1. Unit: flush throws → «Фото недоступно» + `resumeDatabaseSync`.
2. Unit: полный success без `message`; dual phases `[gross, tare]`.
3. Preview: stubs fallback; `video_off` → skipped; disabled cameras ignored.
4. Опционально server: orphan cleanup photos при удалении тикета в tickets-only sync.
5. Code-review note: unit на ограничение fallback `latestPhotoForRole` только `!camera_id`.

## Известные ограничения (продукт)

- Печатный макет «Талон (квитанция)» / «Талон № N» не переименован в «провеска» (AD-4 / OQ-1).
- Logger/console «тикет» частично оставлен.
- Ручной smoke на объекте (single/dual + камеры, вкладки Settings) — остаток приёмки по чеклисту тестировщика.
- `dashboard/` оркестратора и Windows-installer не затрагивались.
