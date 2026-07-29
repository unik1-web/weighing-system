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

## Frontend

Неизвестные пути (не `api/*`) отдаются из `dist/` (`index.html` + ассеты). Если `dist/` нет — HTTP 503 с подсказкой `npm run build`.
