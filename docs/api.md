# HTTP API

Базовый URL: `http://127.0.0.1:5001`. В режиме `npm run dev` Vite проксирует `/api` на этот порт.

Ответы ошибок: `{ "success": false, "message": "..." }` с HTTP 4xx/5xx.
Для `/api/scales/*` формат ошибок расширен до `{ "success": false, "code": "...", "message": "..." }`.

## Служебные

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/health` | `{ success, service }` |
| `POST` | `/api/shutdown` | Завершение процесса (для exe/локального запуска) |
| `GET` | `/api/storage/paths` | Абсолютные пути к `config.ini`, БД и каталогам |

## Хранение

| Метод | Путь | Тело / параметры | Описание |
|-------|------|------------------|----------|
| `GET` | `/api/config` | — | Настройки из `config.ini` + bootstrap миграции stage 6 → `{ config, bootstrap }` |
| `POST` | `/api/config` | `{ "config": { ... } }` | Сохранить настройки |
| `GET` | `/api/database` | — | Данные SQLite активного года → `{ data }` (ключи `app_*`) |
| `POST` | `/api/database` | `{ "data": { ... } }` | Сохранить активную БД (под write-gate ротации) |

Ключи режимов взвешивания в `config` (опциональны; клиент подставляет defaults): `weighing_mode_default`, `stable_mode`, `tara_threshold`, `max_time_between`, `tara_default`, `driver_input_mode` (`vehicle` \| `all` \| `free`), `scale_device_id`, `manual_weight_reason_policy` (`optional` \| `required`).

В `data` журнала: тикеты `app_weighing_tickets` включают `weighing_mode`, `version` и nullable поля `plate_source`, `site_id`, `scale_id`, `scale_role`, `photo_entry_path`, `photo_exit_path`; audit — `app_ticket_audit`; история водителей — `app_vehicle_drivers`; площадка — `app_sites`, `app_scales`, `app_site_runtime`, `app_scale_switch_journal` (частичный POST без соответствующего ключа таблицу не очищает). `scale_device_id` в config — зеркало device активного комплекта.
| `GET` | `/api/storage` | — | Объединённое чтение `config.ini` + active-year database |
| `POST` | `/api/storage` | `{ "data": { "app_...": "..." } }` | Сохранить `app_settings` + active-year `app_*`, запись под write-gate |
| `GET` | `/api/storage/export` | — | Резервная копия INI (`format: "ini"`, `content`, `backup`) |
| `POST` | `/api/storage/import` | `{ "content" }` или `{ "backup" }` | Восстановление; INI или legacy JSON |

`GET /api/config` и `GET /api/database` перед чтением данных запускают bootstrap первичной миграции legacy `BD/weighing.db` в `BD/weighing-YYYY.db`. При ошибке bootstrap возвращается `{ success: false, code, message, bootstrap }` c HTTP 500.

## Stage 6 (yearly archive)

| Метод | Путь | Тело / параметры | Описание |
|-------|------|------------------|----------|
| `GET` | `/api/archive/years` | — | Список архивных лет по именам `weighing-ГГГГ.db` (без active year / `.tmp`) |
| `GET` | `/api/archive/tickets` | `year` (+ опц. фильтры) | Read-only журнал выбранного архивного года, optional mixed legacy warning |
| `GET` | `/api/archive/tickets/:id` | `year` | Карточка архивного тикета + optional mixed legacy warning |
| `PATCH` | `/api/archive/tickets/:id` | `{ year, patch, acknowledge_reo_sent_warning? }` | Admin-правка архивного тикета (whitelist, backend-пересчёт, `ticket_audit`) |
| `POST` | `/api/year/rotation/preview` | `{ ... }` | Preview ротации года |
| `POST` | `/api/year/rotation/commit` | `{ ... }` | Commit ротации года |

Ошибки archive-read: `401 auth_required`, `400 invalid_archive_year`, `404 archive_year_not_found` / `archive_ticket_not_found`, `500 archive_open_failed`. Archive-операции не меняют `active_year` и не пишут в active DB.

## Cameras & Photos

Аддитивные маршруты фотофиксации (stage 7). Формат ошибок где уместно: `{ "success": false, "code": "...", "message": "..." }` (как `/api/scales/*`).

Ключи `config` (через существующие `GET/POST /api/config`): `video_enabled`, `camera_capture_timeout_sec` (по умолчанию ≤ 3), `camera_jpeg_quality`. Изменение `video_enabled` / параметров камер — только `admin`.

Sync-ключи `GET/POST /api/database`: `app_cameras`, `app_ticket_photos` (только метаданные/пути; JPEG/base64 в payload запрещены).

ANPR и `GET /api/cameras/live` — вне скоупа этапа 7. Печать акта/талона не требует фото.

| Метод | Путь | Роль | Описание |
|-------|------|------|----------|
| `GET` | `/api/cameras/capability` | любой | Доступность модуля камер в сборке → `{ success, available, build, opencv }` (+ `code: camera_module_unavailable` в basic) |
| `POST` | `/api/cameras/snapshot` | `user` \| `admin` | Live/preview кадр (HTTP snapshot или RTSP) → `{ success, preview_jpeg_base64, content_type }` |
| `POST` | `/api/cameras/test` | `admin` | Admin-алиас того же транспорта, что `snapshot` (кнопка «Проверить») |
| `POST` | `/api/cameras/etalon` | `admin` | Съёмка эталона primary/spare → `{ success, path, preview_jpeg_base64, camera }`; при ошибке предыдущий эталон не перезаписывается |
| `POST` | `/api/cameras/capture` | `user` \| `admin` | Захват всех enabled-камер фазы тикета (после flush); список камер из SQLite, не из body |
| `GET` | `/api/photos/<path:relpath>` | session не требуется | Раздача JPEG из `Photo/` для `<img src>`; path traversal → 400; Origin/Referer как scale allowlist |

### `POST /api/cameras/capture`

- request: `{ ticket_id, event: "gross"|"tare" }`
- noop (basic / `video_enabled=false` / 0 enabled): `{ success: true, noop: true, results: [], ticket_photos: [] }`
- success / mixed degrade: `{ success: true, noop: false, results: [...], ticket_photos: [...], photo_entry_path, photo_exit_path, capture_token }`
- ошибки оркестрации: `404 ticket_not_found`, `409 rotation_in_progress`, `400 invalid_request`; per-camera fail не даёт HTTP 5xx всего запроса

Клиент **MUST** upsert `ticket_photos` / stubs в localStorage и повторно `flushDatabaseSync`; запрещено `app_ticket_photos = response.ticket_photos`.

### `GET /api/photos/<path:relpath>`

- `Content-Type: image/jpeg`
- отсутствие Origin и Referer разрешено (типичный `<img>`); чужой Origin/Referer → `403 origin_not_allowed`
- файл вне `Photo/` или `..` → `400 path_traversal`; нет файла → `404 not_found`

## Runtime весов `/api/scales/*`

Runtime работает от `app_site_runtime.active_scale_set` + `app_scales`. При изменениях
`app_site_runtime`/`app_scales`/`app_current_user` через `POST /api/database` текущие backend-сессии
инвалидируются и переходят в `stale_session`.

Security guard:
- Разрешённые browser-origin: `http://127.0.0.1:5001`, `http://localhost:5173`, `http://127.0.0.1:5173`
- Требуется активная operator-session в `app_current_user`
- Для этих маршрутов не используется wildcard CORS (`Access-Control-Allow-Origin: *`)

### `POST /api/scales/connect`
- request: `{ expected_site_id, expected_scale_id, expected_scale_role }`
- success: `{ success: true, session_id, status, scale, reading }`
- error: `{ success: false, code, message }`

Пример success:
```json
{
  "success": true,
  "session_id": "session-uuid",
  "status": "connected",
  "scale": {
    "site_id": "default-site",
    "scale_id": "scale-primary",
    "scale_role": "primary",
    "adapter_id": "cas",
    "transport": "serial_backend"
  },
  "reading": null
}
```

`409 inactive_scale_mismatch` — если `expected_*` не совпали с текущим активным комплектом.

### `GET /api/scales/status?session_id=...`
- query: `session_id`
- success: `{ success: true, session_id, status, scale, reading }`
- error: `{ success: false, code, message }`

`409 stale_session` — если сессия устарела после переключения активного комплекта.

### `POST /api/scales/read`
- request: `{ session_id, timeout_ms }`
- success: `{ success: true, session_id, status: "reading", reading }`
- error: `{ success: false, code, message }`

`409 stale_session` — если сессия устарела после переключения активного комплекта.

Пример `reading`:
```json
{
  "value": 45.0,
  "stable": true,
  "raw": "ST,GS,+00045.0kg",
  "captured_at": "2026-07-31T00:00:00Z"
}
```

### `POST /api/scales/disconnect`
- request: `{ session_id }`
- success: `{ success: true, session_id, status: "disconnected" }`
- error: `{ success: false, code, message }`

`409 stale_session` — если сессия уже инвалидирована и ещё находится в stale-marker TTL.

Коды ошибок `/api/scales/*`:
- `400 invalid_request`
- `401 auth_required`
- `403 origin_not_allowed`
- `403 insufficient_permissions`
- `404 session_not_found`
- `409 inactive_scale_mismatch`
- `409 stale_session`
- `422 invalid_connection_config`
- `422 unsupported_transport`
- `503 session_registry_overloaded`
- `503 transport_unavailable`
- `504 read_timeout`

## Файловый обзор

`GET /api/browse`

| Query | Значения | Описание |
|-------|----------|----------|
| `path` | путь | Каталог (пусто — корень по умолчанию OS) |
| `mode` | `file` \| `directory` | Режим выбора |
| `extensions` | `.fdb,.gdb` | Фильтр расширений (через запятую) |

Используется модалкой выбора пути Vescom/Metra/WA.

## РЭО

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| `POST` | `/api/reo/test` | `access_key`, `object_url`, `object_id?` | Тестовый multipart-импорт |
| `POST` | `/api/reo/send` | `object_url`, `payload` | Отправка `weightControls`; HTTP 422 → ошибка валидации РЭО |

Клиент собирает payload в `src/lib/reo.ts`. Для файла-экспорта `objectId`/`accessKey` оставляются пустыми.

## Vescom (Firebird)

Нужны `fdb` и Firebird client. Python 3.11/3.12.

| Метод | Путь | Параметры / тело |
|-------|------|------------------|
| `POST` | `/api/vescom/test` | `db_path`, `user?` (SYSDBA), `password?` (masterkey) |
| `GET` | `/api/vescom/weighing_data` | `date` (`YYYY-MM-DD`), `db_path`, `user?`, `password?` → `{ items }` |
| `POST` | `/api/vescom/import_dictionaries` | `db_path`, `user?`, `password?` → `{ message, fetched, added, data }` |

## Metra (Paradox)

Нужен `pypxlib`. Путь — каталог с `TWeights.db` или сам файл.

| Метод | Путь | Параметры / тело |
|-------|------|------------------|
| `POST` | `/api/metra/test` | `db_path` → `{ message, count }` |
| `GET` | `/api/metra/weighing_data` | `date`, `db_path` → `{ items, warning? }` |
| `POST` | `/api/metra/import_dictionaries` | `db_path` → `{ message, fetched, added, data }` |

## WA («Весы Авто», Firebird/SQL)

Нужны `fdb` и Firebird client (для `.gdb`/`.fdb`). Путь — каталог установки (обычно `C:\Program Files (x86)\WA`) или файл базы.

| Метод | Путь | Параметры / тело |
|-------|------|------------------|
| `POST` | `/api/wa/test` | `db_path`, `user?` (SYSDBA), `password?` (masterkey) → `{ message, count, resolved_path }` |
| `GET` | `/api/wa/weighing_data` | `date`, `db_path`, `user?`, `password?` → `{ items }` |
| `POST` | `/api/wa/import_dictionaries` | `db_path`, `user?`, `password?` → `{ message, fetched, added, data }` |

## Frontend

Неизвестные пути (не `api/*`) отдаются из `dist/` (`index.html` + ассеты). Если `dist/` нет — HTTP 503 с подсказкой `npm run build`.
