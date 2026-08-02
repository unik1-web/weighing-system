# Архитектура: 37cc69-photo-capture

## Обзор

Этап 7 (фотофиксация) расширяет контур weighing-system (React + Flask + SQLite): при фиксации брутто/тары backend снимает JPEG со всех включённых IP-камер площадки, пишет файлы в `Photo/ГГГГ/ММ/ДД/`, метаданные — в `ticket_photos` годовой БД и заполняет nullable stubs тикета (`photo_entry_path` / `photo_exit_path` / `photo_overview_path`). Реестр камер синхронизируется через `/api/database` (`app_cameras`). Флаг `video_enabled` в `config.ini` и graceful degrade (недоступность камер / базовой сборки без OpenCV) не блокируют взвешивание и печать. ANPR-инференс вне скоупа.

## Компоненты

| Компонент | Назначение |
|-----------|------------|
| `server/cameras.py` | Photo root, захват HTTP/RTSP, JPEG, path safety, эталоны, capabilities, parallel capture с wall-clock timeout |
| `server/sqlite_store.py` | DDL `cameras` / `ticket_photos`, STORAGE_KEYS, load/replace; FK-safe порядок DELETE |
| `server/year_rotation.py` | `cameras` в `COPY_TABLES`; `ticket_photos` не копируются |
| `server/app.py` | Routes `/api/cameras/*` |
| `src/lib/cameras.ts` | Capabilities, capture client, preview URL, CRUD ≤4 камер, эталоны |
| `src/lib/storage.ts` | Типы Camera / TicketPhoto, facades, `video_enabled` |
| `SettingsView` | Секция «Камеры и фото», video_enabled, ROI, эталоны |
| `SpareSwitchWizard` | Сверка live/snapshot с эталоном primary/spare |
| `WeighingForm` | Триггер capture после save; превью |
| `TicketPhotoPreview` | Галерея по stubs / `ticket_photos` |
| `WeighingJournal` | Превью в карточке тикета |
| installer | `cameras` hiddenimport; documented exclude `cv2` для basic-сборки |

Поток:

```
SettingsView / SpareSwitchWizard
        │
CamerasStorage / TicketPhotosStorage / video_enabled
        │
WeighingForm ──save ticket──► TicketStorage
        │
        │ POST /api/cameras/capture
        ▼
server/cameras.py ──► Photo/…/*.jpg + ticket_photos + stubs
        │
GET /api/cameras/photo?path=… ──► превью (форма / журнал)
```

## Структура файлов

```
server/cameras.py                         # NEW
server/sqlite_store.py                    # EDIT — DDL, keys, FK-safe replace
server/year_rotation.py                   # EDIT — COPY_TABLES +cameras
server/app.py                             # EDIT — /api/cameras/*
server/tests/test_cameras_capture.py      # NEW
server/tests/test_cameras_photo_path.py   # NEW
server/tests/test_year_rotation.py        # EDIT
server/tests/conftest.py                  # EDIT
src/lib/cameras.ts                        # NEW
src/lib/storage.ts                        # EDIT
src/lib/__tests__/cameras.test.ts         # NEW
src/lib/__tests__/storage-weighing.test.ts # EDIT
src/components/TicketPhotoPreview.tsx     # NEW
src/components/SettingsView.tsx           # EDIT
src/components/SpareSwitchWizard.tsx      # EDIT
src/components/WeighingForm.tsx           # EDIT
src/components/WeighingJournal.tsx        # EDIT
docs/api.md                               # EDIT
.gitignore                                # EDIT — /Photo/
installer/weighing-system.spec            # EDIT
```

## Модели данных

### TypeScript

- `Camera`: id, site_id, role (`entry`|`exit`|`overview`), name, capture_url, capture_kind (`http_snapshot`|`rtsp`|`auto`), enabled, sort_order (0..3), roi (0..1 или null), reference_normal_path / reference_spare_path, created_at.
- `TicketPhoto`: id, ticket_id, phase (`gross`|`tare`), camera_id, camera_role, relative_path, status (`ok`|`failed`|`skipped`), error_message, camera_mode, created_at.
- `AppSettings.video_enabled`: boolean, default `false`.

### SQLite

- Таблица `cameras` (FK → sites), индекс по site_id + sort_order.
- Таблица `ticket_photos` (FK → weighing_tickets), индекс по ticket_id + phase + created_at.
- Application-level: ≤4 камеры на площадку.
- Stubs тикета: после ok-capture обновляются `photo_{role}_path`; failed/skipped не затирают предыдущий ok.

### Файлы на диске

- Root: `{get_app_root()}/Photo/`.
- Тикетные: `Photo/{YYYY}/{MM}/{DD}/{ticket_id}_{phase}_{role}_{yyyyMMddHHmmss}.jpg`.
- Эталоны: `Photo/refs/{camera_id}_normal.jpg`, `Photo/refs/{camera_id}_spare.jpg`.
- Пути в БД — относительно app root с `/`.
- `/Photo/` в `.gitignore`.

### Sync keys (`/api/database`)

| Ключ | Формат | Partial POST |
|------|--------|--------------|
| `app_cameras` | `Camera[]` | без ключа — не очищает |
| `app_ticket_photos` | `TicketPhoto[]` | без ключа — не очищает |

Ротация года: реестр `cameras` копируется; `ticket_photos` и файлы остаются в архиве/на диске.

## API / Интерфейсы

Существующие `/api/database`, `/api/config`, archive — сохранены; расширены ключами и `video_enabled`.

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/api/cameras/capabilities` | `capture_available`, backends, `video_enabled`, `photo_root` |
| `POST` | `/api/cameras/capture` | `{ ticket_id, phase, site_id? }` → photos + stubs |
| `POST` | `/api/cameras/snapshot` | Временный JPEG в `Photo/tmp/` |
| `POST` | `/api/cameras/reference` | Эталон normal/spare |
| `GET` | `/api/cameras/photo` | Serve JPEG; только под photo root; traversal → 400 |

Поведение capture: при `video_enabled=false` / недоступном модуле — `skipped`, HTTP 200; иначе параллельный захват (до 4 workers), таймаут на камеру ~3 s, wall-clock 6 s; JPEG quality 85, downscale >1920; ошибка одной камеры не откатывает тикет.

Триггеры UI: single — два вызова (`gross`, затем `tare`); dual — одна phase за проход; fire-and-forget после успешного save.

## Стек технологий

- React 18, TypeScript, Vite, Tailwind; Flask; SQLite; Python 3.11/3.12.
- HTTP snapshot: `requests` (timeout 1/3 s).
- RTSP: optional `opencv-python-headless`, ленивый `import cv2`.
- Параллелизм: `ThreadPoolExecutor` + `wait(..., timeout=6)`.
- JPEG re-encode: Pillow → OpenCV → raw.
- Новых npm-зависимостей нет.

## Решения и обоснования

1. **Раскладка A** (`Photo/ГГГГ/ММ/ДД/…`) — удобнее для оператора/поддержки, чем `BD/photos/`.
2. **Захват на backend** — нужен RTSP/OpenCV и безопасная запись; UI только триггерит и мержит ответ.
3. **Stubs = latest ok по role**; полная история — в `ticket_photos`.
4. **Dual-build**: модуль всегда в репозитории; HTTP без OpenCV; UI камер при `capture_available` или уже сохранённых камерах; превью архивных файлов всегда через `/api/cameras/photo`.
5. **FK-safe replace**: перед DELETE тикетов очищать `ticket_photos`; перед DELETE sites — cameras/switches/runtime/scales (фиксы после code-review).
6. **Wall-clock 6 s** на parallel capture — незавершённые futures → `failed` «Таймаут захвата», HTTP не блокируется бесконечно.
7. ANPR, обязательные фото в печати, drag-rect ROI, отдельный basic `.spec` — вне скоупа / отложены.
