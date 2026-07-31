# Развёртывание yearly DB archive (stage 6)

Операционный runbook выката годовых SQLite-баз и архива. Команды запуска совпадают с production entrypoint: `npm run build`, `npm start`, Windows `WeighingSystem.exe`.

## Подготовка окружения

### Требуемые каталоги рядом с приложением

Данные живут **рядом с приложением** (`get_app_root()`), не внутри PyInstaller `_MEIPASS`:

| Каталог / файл | Назначение |
|----------------|------------|
| `config.ini` | Настройки, в т.ч. `config.ini[settings].active_year` |
| `BD/` | Годовые БД `weighing-ГГГГ.db`, lock `BD/.year_rotation.lock` |
| `BD/weighing-ГГГГ.db` | Активный и архивные годовые файлы |
| `backup/` | Автоматические backup миграции и ротации |
| `logs/` | `logs/app.log` (в т.ч. строки `stage6 {...}`) |

При первом запуске приложение создаёт недостающие каталоги (`BD/`, `backup/`). Installer (Inno Setup) заранее готовит `BD/`, `backup/`, `logs/` с правами записи пользователя.

### Права на `config.ini`

- Файл должен быть доступен на чтение и запись процессу приложения.
- На Windows (Program Files) каталог установки и `config.ini` должны допускать запись под учётной записью оператора (как для `BD/` и `logs/`).
- Не размещайте рабочий `config.ini` внутри bundle/`_MEIPASS` — после обновления exe он будет потерян.

### Правила хранения `backup/`

- Backup создаётся **до** переключения `active_year`.
- Имена файлов:
  - первичная миграция: `weighing.db.legacy-before-stage6.<YYYYMMDDTHHMMSS>.bak`
  - ротация: `weighing-<год>.db.before-rotation-<целевой_год>.<YYYYMMDDTHHMMSS>.bak`
- Каталог `backup/` растёт со временем. **Автоматическое удаление backup в критическом пути приложения не выполняется.**
- Retention (очистка старых `.bak`) — отдельная внеоперационная процедура администратора (по политике площадки), вне окна ротации/миграции.

### Недопустимость хранения данных в `_MEIPASS`

В frozen-сборке UI берётся из `sys._MEIPASS/dist`, а `config.ini`, `BD/`, `backup/`, `logs/` всегда рядом с `WeighingSystem.exe`. Запись постоянных данных в `_MEIPASS` запрещена.

## Preflight перед обновлением

1. Остановить все процессы приложения (`npm start`, `WeighingSystem.exe`).
2. Сделать согласованную пару backup **вне** каталога приложения:
   - `config.ini` → например `config.pre-stage6.ini`
   - legacy `BD/weighing.db` (если ещё не мигрирован) **или** активный `BD/weighing-ГГГГ.db`
3. Зафиксировать текущий `active_year` (если уже есть) и список файлов в `BD/`.

## Миграция данных

### Preflight backup `config.ini` + `BD/weighing.db`

Перед первым запуском stage 6 на legacy-окружении:

```text
config.ini          →  <безопасное_место>/config.pre-stage6.ini
BD/weighing.db      →  <безопасное_место>/weighing.pre-stage6.db
```

Пара должна быть снята в один момент времени.

### Первый запуск stage 6

```bash
npm run build
npm start
# или WeighingSystem.exe
```

На старте `/api/config` и `/api/health` вызывают bootstrap:

1. Если `active_year` уже задан — миграция не нужна, используется `BD/weighing-<active_year>.db`.
2. Если legacy `BD/weighing.db` есть и `active_year` отсутствует:
   - backup legacy в `backup/weighing.db.legacy-before-stage6.<ts>.bak`
   - copy-on-write во временный `BD/weighing-ГГГГ.db.tmp`
   - schema stage 6 + валидация
   - атомарная публикация `BD/weighing-ГГГГ.db`
   - запись `config.ini[settings].active_year`
3. Исходный `BD/weighing.db` **не изменяется in-place**.

Год миграции = максимальный календарный год тикетов в legacy; при пустом журнале — текущий Gregorian год.

### Expected result при mixed legacy

Если в legacy есть тикеты за разные календарные годы:

- весь набор переносится в **один** файл `BD/weighing-ГГГГ.db` (год = год миграции);
- система **не** режет файл на несколько годовых БД;
- в ответах bootstrap / архива появляется warning `mixed_legacy_year_mismatch` с перечнем `ticket_years`;
- в UI Архива год контейнера = имя файла; несовпадение года даты тикета показывается предупреждением.

Проверка после миграции:

```bash
# в config.ini
active_year = <ГГГГ>

# файлы
ls BD/weighing-*.db
ls backup/*.legacy-before-stage6*.bak
```

### Порядок действий при `migration_target_exists`

Код ошибки: `migration_target_exists` — целевой `BD/weighing-ГГГГ.db` уже существует, legacy не тронут.

1. Остановить приложение.
2. Не удалять legacy `BD/weighing.db` «на глаз».
3. Сверить:
   - есть ли уже корректный `active_year` и валидный yearly-файл;
   - не остался ли частичный `.tmp`.
4. Если yearly-файл валиден, а `active_year` не записан — повторный старт может завершить resume после publish (см. логи `stage6`).
5. Если конфликт неразрешим — rollback preflight-пары (см. ниже) и эскалация.

### Rollback при неуспехе миграции

1. Остановить приложение.
2. Восстановить preflight-пару:
   - `config.pre-stage6.ini` → `config.ini`
   - `weighing.pre-stage6.db` → `BD/weighing.db`
3. Удалить только явно неполные артефакты текущей попытки (при наличии):
   - `BD/weighing-ГГГГ.db.tmp`
   - частично опубликованный `BD/weighing-ГГГГ.db`, если миграция не подтверждена и `active_year` не выставлен
4. Запустить предыдущую (до stage 6) версию приложения **или** исправить причину и повторить миграцию stage 6.
5. Проверить `/api/config`, `/api/database`, журнал тикетов.

Повторный успешный старт после сбоя до publish безопасен: `.tmp` очищается, legacy не меняется.

## Годовая ротация

### Auto-start при входе в новый год

Условие: календарный (Gregorian) год системы **больше** `config.ini[settings].active_year`.

При первом входе оператора UI автоматически вызывает:

1. `POST /api/year/rotation/preview` — без записи в БД и без смены `active_year`
2. Диалог подтверждения (blocking tickets без тары, ack pending REO)
3. `POST /api/year/rotation/commit` — backup, whitelist-перенос, publish нового года, обновление `active_year`
4. Обязательный **повторный вход** (сессия очищается)

Отдельная ручная кнопка ротации в UI stage 6 не требуется.

### Поведение lock-файла

- Путь: `BD/.year_rotation.lock` (создание `O_EXCL`, single-flight).
- Пока lock свежий, вторая сессия получает `409 rotation_in_progress`.
- Запись в активную БД во время ротации блокируется (кроме самого commit).

### Поведение при stale lock

- TTL lock: **15 минут** (`lock_ttl_seconds = 900`).
- Следующая попытка ротации:
  - если есть валидный `.tmp` той же ротации → `resume_tmp`;
  - иначе → `rebuild_target` (пересборка target без дублирования auto-close при корректном retry).
- `active_year` до успешного commit **не** меняется.
- Ручная чистка lock/`.tmp` оператору не нужна в штатном recovery.

### Проверка backup после ротации

После успешного commit ожидается:

```text
backup/weighing-<source>.db.before-rotation-<target>.<ts>.bak
BD/weighing-<target>.db          # новая активная БД, журнал пуст
BD/weighing-<source>.db          # архив закрытого года
config.ini: active_year = <target>
```

Первый новый тикет в активном году получает номер `1`.

### Повторный вход после успеха

После commit UI показывает сообщение о новом `active_year` и выполняет logout. Оператор должен войти снова; работа продолжается уже в новой годовой БД.

## Smoke после выката

Production-like entrypoint (не Vite `:5173`):

```bash
npm run build
OPEN_BROWSER=0 npm start
```

### Active-year smoke

```bash
python scripts/smoke_yearly_archive.py --scenario active \
  --base-url http://127.0.0.1:5001 \
  --origin http://127.0.0.1:5001
```

Проверяет: `active_year` из `/api/config`, session seed, rotation preview.

### Archive smoke

```bash
python scripts/smoke_yearly_archive.py --scenario archive \
  --base-url http://127.0.0.1:5001 \
  --origin http://127.0.0.1:5001
```

Проверяет: список лет, журнал, карточка, forbidden-field PATCH, sent-REO ветка, mixed legacy warning.

### Rotation preview smoke

Покрывается сценарием `active` (preview) и дополнительно:

```bash
python scripts/smoke_yearly_archive.py --scenario fail-retry
python scripts/smoke_yearly_archive.py --scenario parallel-lock
```

- `fail-retry` — сбой после backup + безопасный retry (изолированный HTTP server);
- `parallel-lock` — вторая сессия получает `409 rotation_in_progress`.

### Печать completed ticket

Ручная проверка UI после `npm start`:

1. В активном году открыть completed-тикет → печать акта/талона.
2. В Архиве открыть тикет архивного года → перепечатка **без** записи в active year.
3. Убедиться, что `active_year` и активная БД не изменились.

Evidence и acceptance: `docs/reports/yearly-db-archive/`.  
Release checklist: `docs/reports/yearly-db-archive/release-checklist.md`.  
CI gate: `.github/workflows/yearly-db-archive.yml` (`frontend-tests` → `backend-tests` → `build` → `production-smoke` + `windows-package` → `evidence-gate`).

### Scale smoke (регрессия после обновления)

```bash
python scripts/smoke_scale_api.py \
  --base-url http://127.0.0.1:5001 \
  --origin http://127.0.0.1:5001 \
  --expected-site-id default-site \
  --expected-scale-id scale-primary \
  --expected-scale-role primary
```

## Rollback stage 6 (операционный)

### После неуспешной первичной миграции

См. раздел «Rollback при неуспехе миграции» — восстановление preflight-пары `config.ini` + `BD/weighing.db`.

### После неуспешной ротации

1. `active_year` должен остаться прежним.
2. Не удалять `BD/weighing-<source>.db` и существующие `backup/*.before-rotation-*.bak`.
3. Повторный вход/повторный commit выполнит recovery по stale lock / `.tmp`.
4. Если нужен полный откат к состоянию до обновления кода — восстановить согласованный preflight snapshot (`config.ini` + все `BD/weighing-*.db` + при необходимости `backup/`).

## Windows packaged runtime

```powershell
npm run build:win
# или только exe:
npm run build:win:exe
```

1. Запустить `dist\WeighingSystem\WeighingSystem.exe`.
2. Убедиться, что рядом с exe появились/используются `config.ini`, `BD/`, `backup/`, `logs/`.
3. Повторить active/archive smoke против `http://127.0.0.1:5001`.
4. Не путать backend `serial_backend` smoke с браузерным Web Serial.
