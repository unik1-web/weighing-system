# HTTP API

Базовый URL: `http://127.0.0.1:5001`. В режиме `npm run dev` Vite проксирует `/api` на этот порт.

Ответы ошибок: `{ "success": false, "message": "..." }` с HTTP 4xx/5xx.

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

Ключи режимов взвешивания в `config` (опциональны; клиент подставляет defaults): `weighing_mode_default`, `stable_mode`, `tara_threshold`, `max_time_between`, `tara_default`, `driver_input_mode` (`vehicle` | `all` | `free`, default `all`), `scale_device_id` (id модели весов, default `microsim-m0601`).

В `data` журнала: тикеты `app_weighing_tickets` включают `weighing_mode`, `version`, nullable audit-stubs (`plate_source`, `site_id`, `scale_id`, `scale_role`, `photo_entry_path`, `photo_exit_path`, `photo_overview_path`); audit — `app_ticket_audit`; история водителей ТС — `app_vehicle_drivers`; площадка и весы — `app_sites`, `app_scales`, `app_site_runtime`, `app_site_scale_switches` (частичный POST без ключа соответствующие данные не очищает).
| `GET` | `/api/storage` | — | Объединённое чтение config + database |
| `POST` | `/api/storage` | `{ "data": { "app_...": "..." } }` | Сохранить; принимаются только строковые `app_*` |
| `GET` | `/api/storage/export` | — | Резервная копия INI (`format: "ini"`, `content`, `backup`) |
| `POST` | `/api/storage/import` | `{ "content" }` или `{ "backup" }` | Восстановление; INI или legacy JSON |

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

## Весы (backend I/O)

Операции относятся к **активному** комплекту (primary/spare из `app_site_runtime` + `app_scales`).
Ошибки: `{ success: false, message }` (как остальной API). Транспорт `web_serial` — только в браузере; `serial` — stub HTTP 501; `tcp` — реализован.

| Method | Path | Body / query | Response |
|--------|------|--------------|----------|
| `GET` | `/api/scales/context` | — | `{ success, site_id, scale_id, scale_role, adapter_id, connection, transport }` |
| `GET` | `/api/scales/status` | — | `{ success, connected, adapter_id, scale_id, transport, last_reading, error }` |
| `POST` | `/api/scales/connect` | `{}` или `{ host?, tcpPort?, serialPath? }` (overrides не персистятся) | `{ success, connected, adapter_id, transport }` |
| `POST` | `/api/scales/disconnect` | — | `{ success, connected: false }` |
| `GET` | `/api/scales/reading` | — | `{ success, reading, connected }` |

### Связанные поля данных

- `app_scales[].connection`: framing + `transport` (`web_serial` \| `tcp` \| `serial`) + для `custom`: `parseRegex` / `parseMask`; для TCP: `host`, `tcpPort`.
- `app_settings.manual_weight_reason_mode`: `off` \| `optional` \| `required` (default `optional`).
- `weighing_tickets.manual_weight_reason`: nullable TEXT (причина ручного ввода веса).

## Frontend

Неизвестные пути (не `api/*`) отдаются из `dist/` (`index.html` + ассеты). Если `dist/` нет — HTTP 503 с подсказкой `npm run build`.
