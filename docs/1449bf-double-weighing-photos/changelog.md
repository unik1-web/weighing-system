# История изменений: 1449bf-double-weighing-photos

## Описание задачи

Источник: `docs/tasks/12-double-weighing-photos.md`.

При двойном взвешивании в карточке провески показывать снимки обоих заездов (тара и брутто), а не только одного; дать увеличение превью (lightbox). Файлы уже пишутся на диск — исправить UI/выбор данных. Одиночное взвешивание и отсутствие фото не ломать.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR-1…FR-4 и NFR — показ обеих фаз dual через `ticket_photos`, группировка «Тара»/«Брутто», lightbox для ok-превью, stubs как fallback; корневая причина — схлопывание по `camera_id` в `TicketPhotoPreview` / `buildSlotsFromPhotos`. Backend capture не менять.

### [Архитектура] Execution 2
- Статус: done
- Результат: Frontend-only: `buildPhotoPreviewGroups`, ключи `camera|phase`, useGroups при ≥2 phase, пустые группы не показывать, `PhotoLightbox` (Esc/backdrop/Закрыть, z выше journal modal). API/stubs/schema без изменений. Тест-план для Vitest.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `src/components/TicketPhotoPreview.tsx` — groups, phase-aware слоты, UI групп, PhotoLightbox (co-located)
  - `src/lib/__tests__/ticket-photo-preview.test.ts` — dual / single / stubs / порядок / failed-missing
- Проверки: `npm test` 153 passed, `npm run typecheck` ok
- Ветка: `cursor/double-weighing-photos-d525`, commit `204cc3b`

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: Соответствие архитектуре подтверждено; некритичные замечания (размер файла, формулировка теста порядка при null datetime, опциональный `createPortal`). Переход к testing.

### [Тестирование] Execution 5
- Статус: done
- Результат: `npm test` — 153 passed (в т.ч. 8 в `ticket-photo-preview.test.ts`); `npm run typecheck` — ok. FR-1/2/4 и регрессии covered; FR-3 lightbox — статический разбор кода + предложенные RTL-кейсы (на диск не писались, не блокер). Backend suite не запускался (backend не менялся).

### [Документация] Execution 6
- Статус: done
- Результат: созданы `architecture.md`, `changelog.md`, `issues.md` в `docs/1449bf-double-weighing-photos/`

## Git история

```
204cc3b feat(photos): group dual weighing previews by phase with lightbox
751b245 merge: resolve TaskBoard conflict with orchestrator-integration-proposal-5520 (#40)
a831b9c feat(cameras): фотофиксация при взвешивании (этап 7) (#31)
```

Коммит реализации задачи: `204cc3b` — 2 файла, +499 / −65 (`TicketPhotoPreview.tsx`, `ticket-photo-preview.test.ts`).
