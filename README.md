# Система учёта автомобильных взвешиваний

Веб-приложение для полигона отходов: регистрация взвешиваний, журнал, печать актов и талонов, интеграция с РЭО, импорт из Vescom, Metra и WA.

## Возможности

- **Взвешивание** — режимы одиночное (`single`) и двойное (`dual`); брутто/тара, нетто и сумма, справочники, Web Serial; индикатор комплекта весов / ANPR / камер
- **Журнал** — поиск, фильтры (площадка, весы, источники веса, фото, ANPR, режим, оператор), незавершённые dual-рейсы, экспорт CSV, печать, история правок, отправка в РЭО (если включена)
- **Архив** — просмотр прошлых годов, admin-правка с audit/revisions
- **Отчёты** — сводка за период
- **Справочники** — авто, водители, грузы, контрагенты, пользователи (админ)
- **Печать** — акт (2 экз.) или талон-квитанция (3 экз. на листе)
- **Весы** — Web Serial (Микросим, Ньютон, CAS, Мидл) или ручной ввод; основной/резервный комплект
- **РЭО** — массовая отправка и экспорт JSON по инструкции
- **Импорт Vescom** — Firebird-база весовой программы Vescom
- **Импорт Metra** — Paradox-база `TWeights.db` (НПП «Метра»)
- **Импорт WA** — SQL/Firebird-база программы «Весы Авто» (`C:\Program Files (x86)\WA`)
- **Импорт справочников** — из баз Vescom, Metra и WA с нормализацией госномеров
- **Интерфейс** — полные или сжатые вкладки навигации
- **Резервное копирование** — экспорт/импорт в формате INI
- **Безопасность** — серверный PBKDF2 hash паролей, принудительная смена дефолтного admin

## Хранение данных

| Что | Где |
|-----|-----|
| Настройки | `config.ini` в каталоге приложения |
| Журнал, справочники, пользователи | `BD/weighing.db` (SQLite) |
| Кэш браузера | `localStorage` (синхронизируется с сервером) |
| Логи backend | `server/logs/app.log` |

> Для постоянной работы используйте **`npm start`** после **`npm run build`** — открывайте **`http://127.0.0.1:5001`**. Адреса `localhost:5173` и `127.0.0.1:5001` имеют разный `localStorage`.

## Требования

| Компонент | Версия |
|-----------|--------|
| Node.js | 18+ |
| Python | **3.11 или 3.12** (на 3.13 `fdb` может не работать) |
| Firebird client | для Vescom |
| pypxlib | для Metra (`pip install pypxlib`) |

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
| [Inno Setup 6](https://jrsoftware.org/isinfo.php) | создание `WeighingSystem-Setup.exe` (опционально) |

```powershell
cd weighing-system
npm install
pip install -r server/requirements.txt -r server/requirements-build.txt
npm run build:win
```

Результат:

| Файл / каталог | Описание |
|----------------|----------|
| `release/WeighingSystem-Setup.exe` | установщик (Program Files или выбранный каталог) |
| `dist/WeighingSystem/WeighingSystem.exe` | portable-версия без установки |

Только exe без setup:

```powershell
npm run build:win:exe
```

### Установка у пользователя

1. Запустить `WeighingSystem-Setup.exe`
2. Выбрать каталог (по умолчанию `C:\Program Files\Система учёта взвешиваний`)
3. Запустить **WeighingSystem.exe** — откроется браузер на `http://127.0.0.1:5001`

Данные хранятся рядом с программой: `config.ini`, каталог `BD/`, логи `logs/`.

> Для Vescom нужен Firebird client на компьютере (как и при обычном запуске).  
> Сборка exe выполняется через **Python 3.11**: `py -3.11 -m pip install pypxlib` (нужен для Metra).

## Первый вход

| Логин | Пароль |
|-------|--------|
| `admin` | `admin123` |

При первом входе система **требует сменить** пароль по умолчанию (блокирующий экран). Новый пароль — не короче 6 символов и не `admin123`. Пароли хранятся на сервере как PBKDF2-hash; в браузерном кэше паролей нет.

## Сборка Windows: базовая и полная

| Сборка | Назначение |
|--------|------------|
| **Базовая** | Учёт взвешиваний без фото/ANPR (или с флагами выкл.). Индикаторы камер/ANPR в UI скрыты либо показывают «недоступно». |
| **Полная** | С OpenCV (RTSP), onnxruntime и моделью `models/anpr/plate.onnx` (файл модели **не** в git). Включаются `video_enabled` / `anpr_enabled` в настройках после проверки. |

Секреты, боевые пароли, `.env`, `config.ini` и каталог `BD/` в репозиторий не коммитятся.

## Настройки

### Организация и печать
Реквизиты организации и макет печати:

| Макет | Что печатается |
|-------|----------------|
| **Акт** (по умолчанию) | 2 экземпляра акта на листе |
| **Талон (квитанция)** | 3 экземпляра талона (копии 3, 1, 2) |

Источник веса на печатные формы **не** выводится (только в журнале/CSV).

### Вкладки меню
Подписи вкладок показываются, пока помещаются по ширине шапки; при нехватке места сначала сжимаются бренд и пользователь, затем вкладки переходят в иконки.

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
| [docs/project-for-agents.md](docs/project-for-agents.md) | Контекст проекта для мультиагентного пайплайна |
| [docs/orchestrator.md](docs/orchestrator.md) | Запуск Cursor Agent Orchestrator и live-дашборда |
| [docs/orchestrator-integration.md](docs/orchestrator-integration.md) | План/статус интеграции оркестратора |
| [docs/roadmap.md](docs/roadmap.md) | Roadmap развития |

## Мультиагентная разработка

Пайплайн на базе [Cursor Agent Orchestrator](https://github.com/denistv/cursor-agent-orchestrator): Cursor Skills (`.cursor/skills/`), FSM, память в `memory/`, live-дашборд в `dashboard/`.

Подробности: [docs/orchestrator.md](docs/orchestrator.md). Контекст продукта для ролей: [docs/project-for-agents.md](docs/project-for-agents.md).

### Дашборд

```bash
npm run orchestrator:dashboard:install
npm run orchestrator:dashboard
```

UI: `http://127.0.0.1:5174`, API/SSE: `:3001` (продукт остаётся на Vite `:5173` и Flask `:5001`).

### Запуск в Cursor

Очередь этапов: [docs/tasks/README.md](docs/tasks/README.md). Этап **01** влит (PR #13); **02** выполнен на этой ветке; следующий — **03**.

```text
/orchestrator создай задачу на доске по docs/tasks/03-vehicle-resolve.md и начни выполнять
```

Оркестратор ведёт задачу по FSM (`analysis` → … → `tech-writer`), субагенты пишут `memory/TASK_MEMORY_*.yml`, прогресс виден в дашборде.

### Deprecated: CLI-пайплайн `agents/`

Submodule [rdudov/agents](https://github.com/rdudov/agents) и запуск через Cursor CLI `agent -f --model …` больше не рекомендуются. Используйте `/orchestrator` и skills выше.

## Структура проекта

```
weighing-system/
├── .cursor/skills/         # роли Cursor Agent Orchestrator
├── memory/                 # TaskBoard + TASK_MEMORY_*.yml
├── dashboard/              # live UI оркестратора (:5174 / API :3001)
├── orchestrator-protocol.md
├── agents/                 # deprecated: старый submodule rdudov/agents
├── config.ini              # настройки (создаётся при работе)
├── BD/
│   └── weighing.db         # SQLite
├── docs/                   # архитектура, API, задачи и артефакты пайплайна
│   ├── tasks/              # постановки задач для оркестратора
│   └── implementation/     # черновики старого пайплайна (в .gitignore)
├── installer/
│   ├── build.ps1           # сборка exe + setup
│   ├── weighing-system.spec
│   └── weighing-system.iss # Inno Setup
├── release/                # WeighingSystem-Setup.exe (после сборки)
├── server/
│   ├── app.py              # Flask API + раздача dist/
│   ├── launcher.py         # точка входа для exe
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
