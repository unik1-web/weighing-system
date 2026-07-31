# Система учёта автомобильных взвешиваний

Веб-приложение для полигона отходов: регистрация взвешиваний, журнал, печать актов и талонов, интеграция с РЭО, импорт из Vescom, Metra и WA.

## Возможности

- **Взвешивание** — режимы одиночное (`single`) и двойное (`dual`); брутто/тара, нетто и сумма, справочники, Web Serial
- **Журнал** — поиск, фильтры, незавершённые dual-рейсы, экспорт CSV, печать, отправка в РЭО (если включена)
- **Отчёты** — сводка за период
- **Справочники** — авто, водители, грузы, контрагенты, пользователи (админ)
- **Печать** — акт (2 экз.) или талон-квитанция (3 экз. на листе)
- **Весы** — Web Serial (Микросим, Ньютон, CAS, Мидл) или ручной ввод
- **РЭО** — массовая отправка и экспорт JSON по инструкции
- **Импорт Vescom** — Firebird-база весовой программы Vescom
- **Импорт Metra** — Paradox-база `TWeights.db` (НПП «Метра»)
- **Импорт WA** — SQL/Firebird-база программы «Весы Авто» (`C:\Program Files (x86)\WA`)
- **Импорт справочников** — из баз Vescom, Metra и WA с нормализацией госномеров
- **Интерфейс** — полные или сжатые вкладки навигации
- **Резервное копирование** — экспорт/импорт в формате INI

## Хранение данных

| Что | Где |
|-----|-----|
| Настройки | `config.ini` в каталоге приложения (`[settings].active_year`) |
| Журнал, справочники, пользователи | `BD/weighing-ГГГГ.db` (SQLite активного года) |
| Архивные годы | `BD/weighing-ГГГГ.db` предыдущих лет (read-only журнал / печать) |
| Lock ротации года | `BD/.year_rotation.lock` |
| Backup миграции и ротации | `backup/` (рядом с приложением; retention — внеоперационная процедура) |
| Legacy (до миграции stage 6) | `BD/weighing.db` — только источник copy-on-write |
| Фото / эталоны (stage 7) | `Photo/` рядом с приложением (не в `_MEIPASS`) |
| Кэш браузера | `localStorage` (синхронизируется с сервером) |
| Логи backend | `logs/app.log` (рядом с приложением; в dev также возможен `server/logs/`) |

Постоянные данные **не** хранятся в PyInstaller `_MEIPASS` (`config.ini`, `BD/`, `backup/`, `logs/`, `Photo/` рядом с exe). Операционные runbook: [docs/yearly-db-archive-deploy.md](docs/yearly-db-archive-deploy.md) (stage 6), [docs/photo-capture-deploy.md](docs/photo-capture-deploy.md) (stage 7, dual basic/full).

Stage-6 операционные события (миграция, ротация года, архив, archive-edit) пишутся в `logs/app.log` строками вида `stage6 {...}` через `server/stage6_logging.py`. Полный diff правки тикета остаётся в `ticket_audit` годовой БД, а не в operational log.

> Для постоянной работы используйте **`npm start`** после **`npm run build`** — открывайте **`http://127.0.0.1:5001`**. Адреса `localhost:5173` и `127.0.0.1:5001` имеют разный `localStorage`.

## Требования

| Компонент | Версия |
|-----------|--------|
| Node.js | 18+ |
| Python | **3.11 или 3.12** (на 3.13 `fdb` может не работать) |
| Firebird client | для Vescom |
| pypxlib | для Metra (`pip install pypxlib`) |
| pyserial | backend transport `serial_backend` |

## Установка

```bash
git clone https://github.com/unik1-web/weighing-system.git
cd weighing-system

npm install
pip install -r server/requirements.txt
```

## Запуск

### Продакшен (рекомендуется)

```bash
npm run build
npm start
```

Откроется `http://127.0.0.1:5001` — один процесс Flask раздаёт интерфейс и API.  
Отключить автозапуск браузера: `OPEN_BROWSER=0`.

Краткий порядок проверки после обновления (stage 6):
1. **Backup legacy / активного года** — согласованная пара `config.ini` + `BD/weighing.db` (если ещё legacy) или `BD/weighing-ГГГГ.db` активного года; копии хранить вне каталога приложения
2. **Первый запуск после релиза** — `npm run build && npm start` (или `WeighingSystem.exe`); дождаться bootstrap миграции legacy → `BD/weighing-ГГГГ.db` и записи `active_year`
3. **Проверка результата миграции** — в `config.ini` есть `active_year`; в `BD/` есть `weighing-ГГГГ.db`; в `backup/` есть `*.legacy-before-stage6*.bak` (для первичной миграции); при mixed legacy — warning `mixed_legacy_year_mismatch`
4. **Smoke активного года** — `python scripts/smoke_yearly_archive.py --scenario active --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001`
5. **Smoke архива** — `python scripts/smoke_yearly_archive.py --scenario archive --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001`
6. Дополнительно: проверить `primary/spare` и ручной ввод (`manual_weight_reason`) — регрессия stage 5

Полный операционный runbook: [docs/yearly-db-archive-deploy.md](docs/yearly-db-archive-deploy.md).

Краткий порядок проверки фотофиксации (stage 7, dual setup):
1. **Backup** — `config.ini` + `BD/weighing-ГГГГ.db` (+ `Photo/` при наличии) вне каталога приложения
2. **Установка** — basic `WeighingSystem-Setup.exe` или full `WeighingSystem-Full-Setup.exe` (`npm run build:win` / `build:win:full`); данные рядом с exe сохраняются
3. **Migration v7** — первый запуск создаёт `cameras` / `ticket_photos`, `PRAGMA user_version = 7`
4. **Full** — Настройки → Видео → `video_enabled`, CRUD камер, проверка capture; при недоступной камере — degrade без блокировки веса
5. **Smoke** — `npm run smoke:photo-capability` / `smoke:photo-capture-noop` / `smoke:photo-basic-import` / `smoke:photo-full-import`

Полный runbook dual packaging и rollback: [docs/photo-capture-deploy.md](docs/photo-capture-deploy.md).

Порядок smoke-проверки runtime API (`serial_backend`):

```bash
npm start
python scripts/smoke_scale_api.py \
  --base-url http://127.0.0.1:5001 \
  --origin http://127.0.0.1:5001 \
  --expected-site-id default-site \
  --expected-scale-id scale-primary \
  --expected-scale-role primary
```

Проверка `serial_backend` обязательна отдельно от Chromium Web Serial browser-пути.

### Smoke / acceptance stage 6 (yearly archive)

Production-like проверка выполняется против реального entrypoint (`npm run build && npm start`), не против Vite dev server.

```bash
# терминал 1 — production-like entrypoint
npm run build && npm start

# терминал 2 — сценарии stage 6
python scripts/smoke_yearly_archive.py --scenario active \
  --base-url http://127.0.0.1:5001 \
  --origin http://127.0.0.1:5001 \
  --write-markdown docs/reports/yearly-db-archive/yearly-archive-smoke.md \
  --write-json docs/reports/yearly-db-archive/yearly-archive-smoke.json

python scripts/smoke_yearly_archive.py --scenario archive \
  --base-url http://127.0.0.1:5001 \
  --origin http://127.0.0.1:5001

python scripts/smoke_yearly_archive.py --scenario fail-retry \
  --write-markdown docs/reports/yearly-db-archive/yearly-archive-fail-retry.md \
  --write-json docs/reports/yearly-db-archive/yearly-archive-fail-retry.json

python scripts/smoke_yearly_archive.py --scenario parallel-lock
```

Сценарии:
- `active` — `active_year` из `/api/config`, session seed, rotation preview;
- `archive` — список лет, журнал, карточка, forbidden-field PATCH, sent-REO ветка;
- `fail-retry` — inject failure after backup + безопасный retry (изолированный HTTP server);
- `parallel-lock` — вторая сессия получает `409 rotation_in_progress`.

Обязательные ручные проверки UI (после `npm start`):
- вход оператора, вкладки `single` / `dual`, журнал, печать, РЭО, импорты Vescom/Metra/WA;
- авто-диалог ротации при `active_year <` календарного года: blocking tickets, ack pending REO, logout после commit;
- Архив: список лет → журнал → карточка → печать без записи в active year;
- admin: правка архива; user: control «Редактировать» скрыт;
- sent-REO: warning + подтверждение; forbidden field отклоняется.

Acceptance report: `docs/reports/yearly-db-archive/yearly-archive-acceptance.md`.  
Release checklist: `docs/reports/yearly-db-archive/release-checklist.md`.

### CI/CD и release gate (stage 6)

Отдельный GitHub Actions workflow [`.github/workflows/yearly-db-archive.yml`](.github/workflows/yearly-db-archive.yml) (не зависит от stage-5 `scale-adapters.yml`) обязателен перед merge изменений годового архива.

| Job | Что проверяет |
|-----|----------------|
| `frontend-tests` | `npm test` + `npm run test:stage6-frontend` |
| `backend-tests` | `pytest server/tests` + `npm run test:stage6-backend` |
| `build` | `npm run build` |
| `production-smoke` | `npm start` + smoke `active` / `archive` / `fail-retry` / `parallel-lock` |
| `windows-package` | `npm run build:win:exe` + layout `BD/` / `backup/` / `logs/` вне `_MEIPASS` |
| `evidence-gate` | наличие reports + acceptance без `FAIL` + `release-checklist.md` |

Локальные команды (списки файлов не дублировать в workflow — только через `package.json`):

```bash
npm run test:stage6
npm run smoke:stage6
npm run smoke:stage6-archive
```

Перед релизом: runbook [docs/yearly-db-archive-deploy.md](docs/yearly-db-archive-deploy.md), checklist и evidence в `docs/reports/yearly-db-archive/`.

### Разработка

**Терминал 1 — API:**

```bash
npm run dev:api
```

**Терминал 2 — frontend:**

```bash
npm run dev
```

Интерфейс: `http://localhost:5173`, API проксируется на `:5001`.

## Установка на Windows (exe / setup)

Для пользователей **не нужны** Node.js и Python — всё уже внутри пакета.

### Сборка установщика (на машине разработчика)

Требования для сборки:

| Компонент | Назначение |
|-----------|------------|
| Node.js 18+ | `npm run build` |
| Python 3.11/3.12 | PyInstaller, backend |
| [Inno Setup 6](https://jrsoftware.org/isinfo.php) | создание `WeighingSystem-Setup.exe` / `WeighingSystem-Full-Setup.exe` (опционально) |

```powershell
cd weighing-system
npm install
# Базовая поставка (без OpenCV)
pip install -r server/requirements.txt -r server/requirements-build.txt
npm run build:win

# Полная поставка (камеры + opencv-python-headless)
pip install -r server/requirements-full.txt -r server/requirements-build.txt
npm run build:win:full
```

Результат:

| Файл / каталог | Описание |
|----------------|----------|
| `release/WeighingSystem-Setup.exe` | установщик basic (без OpenCV) |
| `release/WeighingSystem-Full-Setup.exe` | установщик full (фотофиксация / RTSP) |
| `dist/WeighingSystem/WeighingSystem.exe` | portable-версия без установки |

Только exe без setup:

```powershell
npm run build:win:exe
npm run build:win:full:exe
```

Capability в runtime (`GET /api/cameras/capability`) отличает сборки: basic — `available=false`; full — `available=true` при наличии OpenCV в бандле. Full без deps камер падает на этапе build/smoke, а не «тихо» становится basic.
### Установка у пользователя

1. Запустить `WeighingSystem-Setup.exe`
2. Выбрать каталог (по умолчанию `C:\Program Files\Система учёта взвешиваний`)
3. Запустить **WeighingSystem.exe** — откроется браузер на `http://127.0.0.1:5001`

Данные хранятся рядом с программой (не в `_MEIPASS`): `config.ini`, `BD/weighing-ГГГГ.db`, `backup/`, `BD/.year_rotation.lock`, `logs/`, `Photo/`.

Smoke-порядок для упакованной версии:

1. Запустить `dist/WeighingSystem/WeighingSystem.exe`
2. Открыть `http://127.0.0.1:5001`
3. Проверить stage 6: `active_year`, наличие DB, smoke `active` / `archive` (`scripts/smoke_yearly_archive.py`)
4. Проверить сценарий `serial_backend` (`connect -> status -> read -> disconnect`) через `scripts/smoke_scale_api.py` или checklist из `docs/implementation/reports/scale-adapters-exe-checklist.md`
5. Отдельно зафиксировать, что это backend-path (не Web Serial)

> Для Vescom нужен Firebird client на компьютере (как и при обычном запуске).  
> Сборка exe выполняется через **Python 3.11**: `py -3.11 -m pip install pypxlib` (нужен для Metra).

## Первый вход

| Логин | Пароль |
|-------|--------|
| `admin` | `admin123` |

Смените пароль в **Справочники → Пользователи**.

## Настройки

### Организация и печать
Реквизиты организации и макет печати:

| Макет | Что печатается |
|-------|----------------|
| **Акт** (по умолчанию) | 2 экземпляра акта на листе |
| **Талон (квитанция)** | 3 экземпляра талона (копии 3, 1, 2) |

### Вкладки меню
В настройках: **Полное** (иконки + названия) или **Сжатое** (только иконки, подпись по наведению).

### РЭО
1. Включить интеграцию
2. URL сервиса, ID объекта, ключ доступа
3. Выбрать виды груза для отправки
4. **Проверка РЭО** → **Сохранить настройки**

В журнале: **Отправить в РЭО** и **Создать JSON для РЭО** (видны только при включённой интеграции).  
JSON-файл для ручной отправки содержит пустые `objectId`/`accessKey` (как в образце инструкции РЭО).

### Vescom (Firebird)
1. Включить импорт
2. Указать путь к `.fdb` / `.gdb` (кнопка **Обзор...**)
3. **Проверка Vescom** — тест подключения
4. **Импорт справочников** — грузы, контрагенты, авто, **водители** из базы Vescom (`WEIGHINGS.DRIVER`)
5. Сохранить → вкладка **Импорт Vescom**

### Metra (Paradox)
1. Включить импорт
2. Указать каталог с `TWeights.db` (обычно `C:\Program Files (x86)\Metra\ASNet\DB`)
3. **Проверка Metra**
4. **Импорт справочников** — грузы, контрагенты, авто, **водители** из словарей Metra и `TWeights.db`
5. Сохранить → вкладка **Импорт Metra**

### WA («Весы Авто», Firebird/SQL)
1. Включить импорт
2. Указать каталог установки WA (по умолчанию `C:\Program Files (x86)\WA`) или файл `.gdb` / `.fdb`
3. **Проверка WA** — тест подключения (ищется `VESYEVENT.GDB` / `DataBase\*.fdb`)
4. **Импорт справочников** — грузы, контрагенты, авто, водители из журнала WA
5. Сохранить → вкладка **Импорт WA**

### Импорт справочников и госномера
При импорте Vescom/Metra/WA номера нормализуются (латиница→кириллица, без пробелов); если регион не указан — подставляется **56**. Дубликаты не создаются. Повторный импорт той же взвешивающей записи (ключ: брутто + тара + госномер) в UI блокируется.

### Резервная копия
- **Экспорт** — файл `weighing-backup_YYYY-MM-DD.ini` (секции `[config]` и `[database]`)
- **Импорт** — восстановление из `.ini` (поддерживается и старый JSON)

При первом запуске настройки из `config.json` автоматически переносятся в `config.ini`.

## Весы (Web Serial)

Подключение напрямую из браузера (Chrome / Edge), backend не участвует.

| Модель | Скорость | Примечание |
|--------|----------|------------|
| Микросим М0601 | 9600 8N1 | терминатор `\r` |
| Ньютон | 9600 8N1 | `\r\n` |
| CAS | 9600 7E1 | `\r\n` |
| Мидл Ми ВДА | 9600 8N1 | `\r\n` |

Без Web Serial вес вводится вручную на форме взвешивания.

## Документация для разработчиков

| Документ | Содержание |
|----------|------------|
| [docs/architecture.md](docs/architecture.md) | Потоки данных, модули, нормализация, печать, env |
| [docs/api.md](docs/api.md) | Справочник HTTP API Flask |
| [docs/yearly-db-archive-deploy.md](docs/yearly-db-archive-deploy.md) | Runbook выката stage 6: миграция, ротация, rollback, smoke |
| [docs/reports/yearly-db-archive/release-checklist.md](docs/reports/yearly-db-archive/release-checklist.md) | Release checklist / gate stage 6 |
| [docs/photo-capture-deploy.md](docs/photo-capture-deploy.md) | Runbook stage 7: dual basic/full, migration v7, capture/degrade, rollback |
| [docs/reports/photo-capture/release-checklist.md](docs/reports/photo-capture/release-checklist.md) | Release checklist / gate stage 7 |
| [docs/scale-adapters-deploy.md](docs/scale-adapters-deploy.md) | Runbook stage 5 (scale-adapters) |
| [docs/project-for-agents.md](docs/project-for-agents.md) | Контекст проекта для мультиагентного пайплайна |
| [docs/roadmap.md](docs/roadmap.md) | Roadmap развития |

## Мультиагентная разработка

Промпты ролей подключены как git submodule из [rdudov/agents](https://github.com/rdudov/agents) в каталог `agents/`.

```bash
# после clone репозитория
git submodule update --init --recursive

# обновление промптов
git submodule update --remote agents
```

Нужен [Cursor CLI](https://cursor.com/install): `agent login`, модели — `agent models`.

Постановку задачи положите в `docs/tasks/` (очередь этапов: [docs/tasks/README.md](docs/tasks/README.md)). Артефакты пайплайна пишутся в `docs/implementation/` (не коммитятся).

### Скрипт-оркестратор

Последовательный прогон ролей из `agents/01_orchestrator.md` (с циклами review/repair):

```bash
chmod +x orchestrate.sh
agent login   # или export CURSOR_API_KEY=...

# одна постановка (или следующая невыполненная из очереди)
./orchestrate.sh docs/tasks/05-scale-adapters.md

# вся очередь docs/tasks/* без статуса «реализовано»
./orchestrate.sh --queue

# продолжить с шага / dry-run
./orchestrate.sh --from develop docs/tasks/05-scale-adapters.md
./orchestrate.sh --dry-run docs/tasks/05-scale-adapters.md

# через Makefile
make orchestrate TASK=docs/tasks/05-scale-adapters.md
make orchestrate-queue
```

Модели по умолчанию: аналитик/архитектор/планировщик — `gpt-5.4-high`; ревьюеры и разработчик — `gpt-5.3-codex` (переопределение: `MODEL_HIGH`, `MODEL_CODEX`).

### Запуск оркестратора в Cursor (Agent mode)

```
Используя подход по оркестрации мультиагентной разработки (agents/01_orchestrator.md),
выполни доработку docs/tasks/05-scale-adapters.md.

Описание проекта: docs/project-for-agents.md
Дополнительный контекст: docs/architecture.md, docs/api.md, README.md

Каталог артефактов пайплайна: docs/implementation

Промпты агентов с указанными в 01_orchestrator.md ролями находятся в agents (02*.md..10.md).
Агентов нужно вызывать shell-командами:
agent -f --model {модель} -p {промпт}
и дожидаться от них результатов.

Промпт следующего формата:
"{содержимое файла с ролью} {входные данные согласно описанию роли}"

Модель:
аналитик, архитектор, планировщик — gpt-5.4-high
ревьюеры ТЗ, архитектуры, плана, кода и разработчик — gpt-5.3-codex
```

## Структура проекта

```
weighing-system/
├── agents/                 # промпты мультиагентного пайплайна (submodule)
├── config.ini              # настройки (создаётся при работе)
├── BD/
│   ├── weighing-YYYY.db    # SQLite активного / архивных лет
│   └── .year_rotation.lock # single-flight lock ротации (runtime)
├── backup/                 # backup миграции и ротации
├── docs/                   # архитектура, API, задачи и артефакты пайплайна
│   ├── tasks/              # постановки задач для оркестратора
│   ├── yearly-db-archive-deploy.md
│   ├── photo-capture-deploy.md  # runbook stage 7 (dual basic/full)
│   └── implementation/     # черновики пайплайна (в .gitignore)
├── Photo/                  # JPEG тикетов/эталонов (рядом с exe, runtime)
├── installer/
│   ├── build.ps1                 # сборка exe + setup (-Full = полная поставка)
│   ├── weighing-system.spec      # basic (exclude cv2)
│   ├── weighing-system-full.spec # full (+ OpenCV / cameras)
│   ├── weighing-system.iss       # WeighingSystem-Setup.exe
│   └── weighing-system-full.iss  # WeighingSystem-Full-Setup.exe
├── release/                # Setup.exe / Full-Setup.exe (после сборки)
├── server/
│   ├── app.py              # Flask API + раздача dist/
│   ├── launcher.py         # точка входа для exe
│   ├── requirements.txt    # basic runtime (без OpenCV)
│   ├── requirements-full.txt # full = basic + opencv-python-headless
│   ├── persistence.py      # config.ini, backup INI
│   ├── sqlite_store.py     # SQLite
│   ├── dictionary_import.py
│   ├── text_encoding.py
│   ├── metra.py / vescom.py / wa.py
│   ├── reo_client.py
│   └── logs/
├── src/
│   ├── components/         # UI
│   ├── hooks/
│   └── lib/                # storage, api, reo, scales, sync
└── dist/                   # сборка frontend (npm run build)
```

## Устранение неполадок

| Проблема | Решение |
|----------|---------|
| «Backend не отвечает» | `npm run dev:api` или `npm start` |
| Данные пропали после перезапуска | Открывайте `127.0.0.1:5001`, не `localhost:5173` |
| Vescom / WA / fdb | Python 3.11/3.12, Firebird client |
| Metra пусто за дату | Проверьте дату в базе (тестовые данные могут быть за 2022 год) |
| Вкладка импорта не видна | Включите переключатель в настройках и сохраните |
| Кнопки РЭО в журнале | Включите интеграцию РЭО в настройках |
| Web Serial недоступен | Chrome/Edge; HTTPS или `http://127.0.0.1` |
| `npm start` без UI | Сначала `npm run build` (иначе API-only / 503) |
| Порт занят | `PORT=5002 npm start` (и обновите proxy в `vite.config.ts` для dev) |

## Лицензия

Проект для внутреннего использования полигона отходов.
