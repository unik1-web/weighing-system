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
| `GET` | `/api/config` | — | Настройки из `config.ini` → `{ config }` |
| `POST` | `/api/config` | `{ "config": { ... } }` | Сохранить настройки |
| `GET` | `/api/database` | — | Данные SQLite → `{ data }` (ключи `app_*`) |
| `POST` | `/api/database` | `{ "data": { ... } }` | Сохранить БД |

Ключи режимов взвешивания в `config` (опциональны; клиент подставляет defaults): `weighing_mode_default`, `stable_mode`, `tara_threshold`, `max_time_between`, `tara_default`, `driver_input_mode` (`vehicle` \| `all` \| `free`), `scale_device_id`, `manual_weight_reason_policy` (`optional` \| `required`).

В `data` журнала: тикеты `app_weighing_tickets` включают `weighing_mode`, `version` и nullable поля `plate_source`, `site_id`, `scale_id`, `scale_role`, `photo_entry_path`, `photo_exit_path`; audit — `app_ticket_audit`; история водителей — `app_vehicle_drivers`; площадка — `app_sites`, `app_scales`, `app_site_runtime`, `app_scale_switch_journal` (частичный POST без соответствующего ключа таблицу не очищает). `scale_device_id` в config — зеркало device активного комплекта.
| `GET` | `/api/storage` | — | Объединённое чтение config + database |
| `POST` | `/api/storage` | `{ "data": { "app_...": "..." } }` | Сохранить; принимаются только строковые `app_*` |
| `GET` | `/api/storage/export` | — | Резервная копия INI (`format: "ini"`, `content`, `backup`) |
| `POST` | `/api/storage/import` | `{ "content" }` или `{ "backup" }` | Восстановление; INI или legacy JSON |

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
