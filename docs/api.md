# HTTP API

Базовый URL: `http://127.0.0.1:5001`. В режиме `npm run dev` Vite проксирует `/api` на этот порт.

Ответы ошибок: `{ "success": false, "message": "..." }` с HTTP 4xx/5xx.

## Служебные

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/health` | `{ success, service }` |
| `POST` | `/api/shutdown` | Завершение процесса (для exe/локального запуска) |
| `GET` | `/api/storage/paths` | Абсолютные пути к `config.ini`, БД и каталогам; также `active_year`, `backups_dir` |

## Auth

Пароли хранятся только на сервере (PBKDF2-HMAC-SHA256). Sync `app_users` **не** содержит `passwordHash`.

| Метод | Путь | Тело | Ответ |
|-------|------|------|-------|
| `POST` | `/api/auth/login` | `{ username, password }` | `{ success, user, profile, must_change_password }` или 401 |
| `POST` | `/api/auth/change-password` | `{ user_id, new_password, current_password? }` | `{ success, must_change_password: false }`; при `must_change_password=1` текущий пароль не обязателен; `new_password` ≥ 6 и ≠ `admin123` |
| `POST` | `/api/auth/register` | `{ username, password, display_name }` | создаёт user+profile (первый — admin); hash на сервере |

Дефолтный bootstrap: при пустой таблице `users` сервер создаёт `admin` / `admin123` с `must_change_password=1`. Legacy hash (`btoa`) при успешном login перехешируется в PBKDF2.

## Хранение

| Метод | Путь | Тело / параметры | Описание |
|-------|------|------------------|----------|
| `GET` | `/api/config` | — | Настройки из `config.ini` → `{ config }` |
| `POST` | `/api/config` | `{ "config": { ... } }` | Сохранить настройки (`active_year` через этот API не меняется) |
| `GET` | `/api/database` | — | Данные **активного** года SQLite → `{ data }` (ключи `app_*`); `app_users` без hash, с `mustChangePassword` |
| `POST` | `/api/database` | `{ "data": { ... } }` | Сохранить активную БД (клиентский `passwordHash` игнорируется) |
| `GET` | `/api/database/years` | — | `{ years, active_year }` — список `BD/weighing-ГГГГ.db` |
| `GET` | `/api/database/rotate/preview` | — | `{ active_year, open_count, reo_pending_count, suggested_new_year }` |
| `POST` | `/api/database/rotate` | `{ target_year, operator_id, operator_name, confirm_reo_pending? }` | Ротация года (admin); 409 если есть pending РЭО без confirm |
| `GET` | `/api/database/archive/<year>` | — | Read-only снимок архивного (или активного) года |
| `POST` | `/api/database/archive/<year>/ticket` | `{ ticket, operator_id, operator_name, confirm_reo_sent? }` | Admin-правка архивного тикета + revisions/audit; пустой diff — без `updated` и без bump version |

Ключи режимов взвешивания в `config` (опциональны; клиент подставляет defaults): `weighing_mode_default`, `stable_mode`, `tara_threshold`, `max_time_between`, `tara_default`, `driver_input_mode` (`vehicle` | `all` | `free`, default `all`), `scale_device_id` (id модели весов, default `microsim-m0601`), `video_enabled` (`true`/`false`, default `false` — фотофиксация), `anpr_enabled` (`true`/`false`, default `false` — локальный ANPR; включать после спайка ≥ 50%), `active_year` (ГГГГ; меняется только ротацией).

Разделение хранилища: `GET/POST /api/config` — только `config.ini` (настройки). `GET/POST /api/database` — только `BD/weighing-{YYYY}.db` (справочники, тикеты, сессия). `GET/POST /api/storage` — объединённый вид (обратная совместимость). При старте UI: `Promise.all` config+database.

В `data` журнала: тикеты `app_weighing_tickets` включают `weighing_mode`, `version`, `auto_closed`, nullable audit-stubs (`plate_source`, `site_id`, `scale_id`, `scale_role`, `photo_entry_path`, `photo_exit_path`, `photo_overview_path`, `anpr_plate_raw`, `plate_confidence`, `anpr_accepted`, `anpr_status`); audit — `app_ticket_audit` (`created` \| `completed` \| `auto_closed` \| `updated`); правки — `app_ticket_revisions`; история водителей ТС — `app_vehicle_drivers`; площадка и весы — `app_sites`, `app_scales`, `app_site_runtime`, `app_site_scale_switches`; камеры и фото — `app_cameras`, `app_ticket_photos` (частичный POST без ключа соответствующие данные не очищает; при ротации года `cameras` копируются в новый год, `ticket_photos` остаются в архиве).

Файлы БД: `BD/weighing-ГГГГ.db`; бэкапы ротации — `BD/backups/`. Legacy `BD/weighing.db` мигрирует в годовой файл при первом запуске. Фото JPEG — каталог `Photo/` рядом с приложением (не в SQLite).

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

## Камеры и фотофиксация

Модуль `server/cameras.py`. JPEG на диске в `Photo/ГГГГ/ММ/ДД/…`; метаданные в `ticket_photos` и stubs тикета. Захват не блокирует взвешивание (graceful degrade).

| Метод | Путь | Тело / query | Ответ |
|-------|------|--------------|-------|
| `GET` | `/api/cameras/capabilities` | — | `{ success, capture_available, backends, video_enabled, photo_root, opencv_available? }` |
| `POST` | `/api/cameras/capture` | `{ ticket_id, phase: "gross"\|"tare", site_id? }` | `{ success, photos[], stubs }` — пишет файлы + `ticket_photos` + stubs |
| `POST` | `/api/cameras/snapshot` | `{ camera_id }` или `{ capture_url, capture_kind? }` | `{ success, relative_path }` во временный `Photo/tmp/` |
| `POST` | `/api/cameras/reference` | `{ camera_id, mode: "normal"\|"spare" }` | Снимок эталона → `Photo/refs/…`; `{ success, camera }` |
| `GET` | `/api/cameras/photo` | `path` (относительный от app root, только под `Photo/`) | `image/jpeg` или 404; path traversal → 400 |

Поведение `capture`: при `video_enabled=false` — строки `skipped`, HTTP 200; ошибка одной камеры — `failed`, остальные ок; таймаут HTTP ~3 с; параллельно до 4 камер.

## ANPR (локальное распознавание номеров)

Модуль `server/anpr.py`. Захват overview (+ ROI crop) и инференс на backend; тикет не пишет. Feature-flag `anpr_enabled` (default `false`) + runtime `anpr_mode` (spare → `disabled_by_configuration`). Модель: `{app_root}/models/anpr/plate.onnx` (вне git; полная сборка с `onnxruntime`).

| Метод | Путь | Тело / query | Ответ |
|-------|------|--------------|-------|
| `GET` | `/api/anpr/capabilities` | — | `{ success, anpr_available, anpr_enabled, video_enabled, engine, model_loaded, backends?, model_path? }` |
| `POST` | `/api/anpr/recognize` | `{ site_id?, camera_id? }` | `{ success, engine_invoked, anpr_status, plate_raw, confidence, camera_id, error, reason }` |

Gate (все обязательны для `engine_invoked=true`): `anpr_enabled` ∧ `video_enabled` ∧ `anpr_mode=enabled` ∧ overview с `capture_url` ∧ `anpr_available`. Иначе HTTP 200, `engine_invoked=false`, `anpr_status=disabled_by_configuration`. Ошибка кадра/модели → `anpr_status=failed` (HTTP 200, взвешивание не блокируется). Таймаут recognize ~5 с. Confidence REAL 0..1.

Поля тикета (nullable soft-read): `anpr_plate_raw`, `plate_confidence`, `anpr_accepted`, `anpr_status` (`enabled` \| `disabled_by_configuration` \| `failed`); `plate_source` = `anpr` \| `operator` \| `directory`.

## Frontend

Неизвестные пути (не `api/*`) отдаются из `dist/` (`index.html` + ассеты). Если `dist/` нет — HTTP 503 с подсказкой `npm run build`.
