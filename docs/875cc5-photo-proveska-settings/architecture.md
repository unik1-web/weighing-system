# Архитектура: 875cc5-photo-proveska-settings

Доработка существующего React + Flask + SQLite weighing-system. Стек и API-контракты (`docs/api.md`) сохраняются; меняется порядок sync→capture на клиенте, UX превью/настроек/терминологии и README.

## Обзор решения

Пять связанных изменений в одном релизе:

1. **Надёжный захват фото** — устранить ложное «Фото недоступно»: перед `POST /api/cameras/capture` гарантировать наличие тикета в SQLite (`flushDatabaseSync`), на время capture приостановить debounce-sync, после merge фото/stubs — resume + flush.
2. **Превью по слотам камер** — `TicketPhotoPreview` показывает слот на каждую enabled-камеру площадки (или фактический `ticket_photos`) со статусом ok/failed/skipped.
3. **Терминология** — видимый UI: «тикет»/«талон» (сущность взвешивания) → «провеска»; печатный макет «Талон (квитанция)» не трогать.
4. **README** — раздел про камеры, кнопки, где смотреть фото.
5. **SettingsView** — вкладки по группам секций; один раздел виден; save flow без изменений.

### Ключевые решения

| Решение | Обоснование |
|---------|-------------|
| **AD-1. Flush-before-capture + pause sync** внутри `triggerCaptureAfterSave` | Корневая причина: `TicketStorage.create/update` только `scheduleDatabaseSync(400ms)`, capture вызывается сразу → FK `ticket_photos.ticket_id → weighing_tickets(id)` падает. Централизация в одном месте — WeighingForm не дублирует. Уже есть `flushDatabaseSync` / `pauseDatabaseSync` / `resumeDatabaseSync`. |
| **AD-2. Backend harden (рекомендуется):** не стирать `ticket_photos` в `_replace_tickets`, если в том же POST нет ключа `app_ticket_photos` | Сейчас `_replace_tickets` всегда `DELETE FROM ticket_photos`. Гонка: capture записал фото → отложенный sync тикетов без свежих photos в localStorage → wipe. Согласовать с заявленной семантикой «частичный POST без ключа не очищает» (`docs/api.md`). |
| **AD-3. Слоты превью = enabled cameras ∪ ticket_photos** | Показ только `status=ok` скрывает fail. Для ожидаемой съёмки failed должен быть виден. |
| **AD-4. OQ-1: печатный «Талон» оставить** | Документ-квитанция ≠ сущность «провеска» в экранном UI. |
| **AD-5. Вкладки Settings — клиентский state + опционально sessionStorage** | Без новых API; одна кнопка «Сохранить». |

## Компоненты системы

| Компонент | Изменение | Ответственность |
|-----------|-----------|-----------------|
| `src/lib/cameras.ts` | EDIT | `triggerCaptureAfterSave`: pause → flush → capture phases → resume → flush; сообщения ok / частичный / полный fail; early-exit без паники если video off / нет камер |
| `src/lib/storage-sync.ts` | READ (API уже есть) | `flushDatabaseSync`, `pauseDatabaseSync`, `resumeDatabaseSync` |
| `src/components/WeighingForm.tsx` | EDIT | Тосты с `cap.message`; строки «тикет»→«провеска»; `TicketPhotoPreview` на `lastTicket` |
| `src/components/TicketPhotoPreview.tsx` | EDIT | Слоты по камерам + статус |
| `src/components/WeighingJournal.tsx` | EDIT | Заголовок «Просмотр провески»; превью |
| `src/components/ArchiveView.tsx` | EDIT | Терминология «провеска» |
| `src/components/SettingsView.tsx` | EDIT | Вкладки; терминология ротации года |
| `src/lib/print-date.ts` / PrintAct | НЕ трогать макет «Талон» | OQ-1 |
| `server/sqlite_store.py` | EDIT (рекоменд.) | Harden `_replace_tickets` vs photos |
| `server/cameras.py` / `app.py` | без смены контракта | Capture как есть |
| `README.md` | EDIT | Камеры и кнопки |
| `docs/api.md` | EDIT только если harden меняет описанную семантику DELETE photos | Уточнить поведение |

### Поток capture после сохранения (to-be)

```
WeighingForm ── TicketStorage.create/update ──► localStorage
        │
        │ void triggerCaptureAfterSave(ticketId, phases, siteId)
        ▼
cameras.triggerCaptureAfterSave
  1. pauseDatabaseSync()
  2. await flushDatabaseSync()     // тикет в weighing_tickets
  3. optional gate: video_enabled + enabled cameras (client hint)
  4. for phase: captureForTicket → POST /api/cameras/capture
       → JPEG Photo/ + ticket_photos + stubs
       → TicketPhotosStorage.merge + TicketStorage.update stubs
  5. resumeDatabaseSync()
  6. await flushDatabaseSync()     // photos+stubs на сервер
  7. return { ok, message? }
        │
        ▼
WeighingForm: append message to success toast; refresh lastTicket
```

Fire-and-forget с точки зрения UX формы сохраняется (`void …then`); внутри функции — последовательный await flush/capture. Сохранение веса уже завершено до вызова.

## Структуры данных

Без новых таблиц / полей. Используются существующие:

- `TicketPhoto`: `status: 'ok' | 'failed' | 'skipped'`, `error_message`, `camera_role`, `phase`, …
- `Camera`: `enabled`, `site_id`, `role`, `sort_order`
- `WeighingTicket`: stubs `photo_entry_path` / `photo_exit_path` / `photo_overview_path`

### Превью: модель слота (UI-only)

```ts
interface PhotoPreviewSlot {
  key: string;                 // camera_id или role+phase
  role: CameraRole;
  label: string;               // CAMERA_ROLE_LABELS[role] (+ name камеры при коллизии ролей)
  cameraName?: string;
  status: 'ok' | 'failed' | 'skipped' | 'missing';
  relative_path: string | null;
  error_message?: string | null;
  phase?: PhotoPhase;          // optional badge в non-compact
}
```

Алгоритм слотов:

1. `cameras = CamerasStorage.forSite(ticket.site_id).filter(c => c.enabled)` (если `site_id` null — fallback на роли из photos/stubs).
2. `photos = TicketPhotosStorage.forTicket(ticket.id)` (или prop).
3. Если `cameras.length > 0`: для каждой камеры взять **последний** photo по `(camera_id)` (или по role, если camera_id null), иначе слот `missing` при `video_enabled` / наличии любых photos для тикета; при `video_enabled=false` и пустых photos — нейтральный empty («Фотофиксация отключена» / не акцентировать).
4. Если камер нет, но есть photos — слоты из photos (все статусы, не только ok).
5. Fallback stubs: только если нет rows в photos — показать ok-пути из stubs как `status: 'ok'`.

## API и интерфейсы

Публичные HTTP-эндпоинты **без breaking changes**.

### Клиентские сигнатуры (to-be)

```ts
// src/lib/cameras.ts — поведение меняется, сигнатура сохраняется
export async function triggerCaptureAfterSave(
  ticketId: string,
  phases: PhotoPhase[],
  siteId?: string | null,
): Promise<{ ok: boolean; message?: string }>;

// Сообщения (русские, для тоста):
// - полный fail API / все слоты failed при ожидаемой съёмке → ok:false, message: 'Фото недоступно'
// - смесь ok+failed → ok:true, message: 'Часть фото недоступна'
// - все ok → ok:true, без message
// - video_enabled=false или 0 enabled cameras → ok:true, без message (skipped / no-op)
// - flush упал / backend недоступен при ожидаемой съёмке → ok:false, message: 'Фото недоступно'
```

Рекомендация: early client gate по `SettingsStorage.getAppSettings().video_enabled` и `CamerasStorage.forSite(siteId).some(c => c.enabled)` — избежать лишних POST и ложных fail при выкл. видео. Backend по-прежнему пишет `skipped` если вызвали с video off.

### Backend harden (рекомендуемый, минимальный)

В `server/sqlite_store.py`, `_replace_tickets`:

- **Сейчас:** `DELETE FROM ticket_photos` всегда перед `DELETE FROM weighing_tickets`.
- **To-be:** не удалять все `ticket_photos` здесь. Варианты (предпочтение по возрастанию инвазивности):

  **A (предпочтительно):** в `save_database` / транзакции replace: если в `data` есть и tickets, и ticket_photos — порядок: delete photos → delete tickets → insert tickets → insert photos (как сейчас, но DELETE photos только когда ключ photos присутствует). Если tickets есть, а photos **нет** — сохранить существующие photo-rows для ticket_id, которые остаются после replace (удалить photos только для ticket_id, отсутствующих в новом списке; либо временно отключить FK / delete+reinsert tickets с сохранением photos через staging).

  **Практичный минимум A':**  
  1. Если `STORAGE_KEYS['ticket_photos'] in data` — как сейчас (delete photos в `_replace_tickets` ок, т.к. следом полный replace photos).  
  2. Если ключа photos нет — `_replace_tickets` **не** делает `DELETE FROM ticket_photos`; вместо этого: для каждого старого ticket_id отсутствующего в новом наборе — `DELETE FROM ticket_photos WHERE ticket_id=?`, затем update/replace tickets без полного wipe photos (например delete+insert только tickets, photos orphans уже убраны).

Клиентский pause+flush закрывает основной UX-баг даже без A'; harden — защита от гонок и соответствие docs.

## Технологический стек

Без изменений: React 18 + TS + Vite + Tailwind; Flask; SQLite; Python 3.11/3.12.

Settings tabs: нативный UI на существующих Tailwind-классах (кнопки/`role="tablist"`), без новой UI-библиотеки. Иконки — уже подключённый `lucide-react`.

## Файловая структура (изменения)

```
src/lib/cameras.ts                         # EDIT — flush/pause/resume в triggerCaptureAfterSave
src/lib/__tests__/cameras.test.ts          # EDIT — мок flush; success / partial / skip
src/components/TicketPhotoPreview.tsx      # EDIT — слоты + статусы
src/components/WeighingForm.tsx            # EDIT — терминология; refresh preview
src/components/WeighingJournal.tsx         # EDIT — «провеска»
src/components/ArchiveView.tsx             # EDIT — «провеска»
src/components/SettingsView.tsx            # EDIT — вкладки + терминология ротации
server/sqlite_store.py                     # EDIT — harden _replace_tickets (рекоменд.)
server/tests/test_cameras_capture.py       # EDIT — sync-before-capture / race harden
README.md                                  # EDIT — камеры и кнопки
docs/api.md                                # EDIT — только при harden семантики
docs/875cc5-photo-proveska-settings/       # артефакты задачи
```

Не трогать: `dashboard/`, `installer/` (кроме косвенно через README), печатный макет «Талон (квитанция)», ANPR.

## FR-детализация для разработчика

### FR-1. Sync-before-capture

В `triggerCaptureAfterSave`:

```ts
pauseDatabaseSync();
try {
  await flushDatabaseSync();
  // ... existing phase loop with captureForTicket ...
} finally {
  resumeDatabaseSync();
}
try {
  await flushDatabaseSync(); // лучший effort после merge
} catch { /* degrade already reflected in message */ }
```

`captureForTicket` при HTTP error → `null` → anyFail. Не менять backend response shape.

Тесты:

- Frontend: mock `flushDatabaseSync` called before `apiPost('/api/cameras/capture')`; partial fail message; skip when no cameras / video off.
- Server (если harden): POST database с tickets без photos key не уничтожает ранее записанные capture-rows; существующий `test_sync_after_capture_ok` сохранить.

### FR-2. TicketPhotoPreview

Props: добавить опционально `siteId` (default `ticket.site_id`), `videoExpected?: boolean`.

UI слота:

- `ok` — img через `photoUrl`
- `failed` — плейсхолдер + «Ошибка» / короткий `error_message`
- `skipped` — нейтрально «Пропущено» (если блок вообще показываем)
- `missing` — «Нет снимка» (ожидалось)

Compact (журнал): мини-сетка, failed — красноватый текст/бордер без тяжёлых карточек-декораций сверх существующего border pattern.

Empty states:

- нет камер и нет photos → «Фотофиксация отсутствует»
- video off и нет photos → короткий нейтральный текст или скрыть акцент

### FR-3. Терминология

Заменить **видимые** строки (не идентификаторы):

| Файл | Примеры as-is → to-be |
|------|------------------------|
| WeighingForm | «Тикет не найден» → «Провеска не найдена»; «Тикет уже завершён» → «Провеска уже завершена»; «Тикет в незавершённых» → «Провеска в незавершённых»; «Дозавершение талона» → «Дозавершение провески»; колонка «Талон» → «Провеска» |
| WeighingJournal | «Просмотр тикета» → «Просмотр провески» |
| ArchiveView | «архивных тикетов» → «архивных провесок»; заголовок карточки |
| SettingsView | «открытых тикетов» / «тикетов с ожидающей отправкой в РЭО» → «провесок…» |
| Logger | желательно, низкий приоритет |

**Не менять:** `PRINT_LAYOUT_LABELS.receipt = 'Талон (квитанция)'`; заголовок печатной формы «Талон № N»; `ticket_id`, `TicketStorage`, API paths; описание «шапка талона» в контексте макета квитанции можно оставить или уточнить «шапка печатного талона (квитанции)».

### FR-4. README

Добавить подраздел (например под настройками / оборудование):

- `video_enabled`; 1–4 камеры на площадку; HTTP/RTSP URL; `capture_kind`; роли entry/exit/overview; ROI overview; эталоны primary/spare; OpenCV для RTSP; каталог `Photo/`
- Кнопки: «Показать снимок» / «Обновить снимок» (`CameraSetupPreview`); эталоны; монитор «Камеры на весах»; автозахват при сохранении
- Где смотреть: карточка после сохранения, журнал
- Без боевых URL/паролей и без бинарников Photo/

### FR-5. Вкладки настроек

Группы (id → label → секции as-is):

| id | Label | Секции |
|----|-------|--------|
| `org` | Организация и печать | Реквизиты организации; Макет печати |
| `site` | Площадка и весы | Площадка и весы |
| `cameras` | Камеры и фото | Камеры и фото (+ ANPR-флаги если в этой секции) |
| `weighing` | Режимы взвешивания | Режимы взвешивания |
| `integrations` | Интеграции | РЭО; Vescom; Metra; WA |
| `data` | Год и данные | Год и архив; Данные и резервное копирование |

Реализация:

- `const [settingsTab, setSettingsTab] = useState<SettingsTabId>('org')`
- Опционально: init/read/write `sessionStorage` key `app_settings_tab`
- Tablist сверху (горизонтальный scroll на mobile); `aria-selected`; контент — текущие JSX-блоки без изменения полей
- Кнопка «Сохранить» / footer — **вне** вкладок, видна всегда
- Не выносить секции в отдельные route

## Открытые решения (с рекомендацией)

| Тема | Рекомендация |
|------|--------------|
| Делать ли backend harden в том же PR | **Да**, минимум A' — иначе гонка wipe photos остаётся; клиентский flush закрывает «Фото недоступно», но не все race |
| Early gate video/cameras в triggerCaptureAfterSave | **Да** — меньше шума и ложных тостов |
| Несколько камер с одной role | Слот на **камеру** (key=`camera_id`), label = role + name |
| sessionStorage для вкладки | **Да**, простой UX |
| Переименование logger «тикет» | По желанию, не блокирует приёмку |

## Критерии приёмки → проверки

1. video_enabled + рабочие камеры: после save нет ложного «Фото недоступно»; файлы в `Photo/`, rows в `ticket_photos`.
2. Превью: слоты = enabled cameras / явный failed.
3. UI: «провеска» на основных экранах; печатный «Талон» сохранён.
4. README обновлён.
5. Settings — вкладки, один раздел, save работает.
6. Регрессии: video off, журнал, печать, primary/spare.
7. Тесты: cameras trigger order (flush before capture); preview slots; при harden — server race test.

## Вне скоупа

Новый ANPR, облако фото, полный i18n, `dashboard/`, Windows-installer без явной нужды.
