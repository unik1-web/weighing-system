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

| Сборка | Зависимости Python | Назначение |
|--------|-------------------|------------|
| **Базовая** | `server/requirements.txt` **без** `onnxruntime`; в `installer/weighing-system.spec` можно указать `excludes=['cv2', 'onnxruntime', …]` | Учёт без RTSP/ANPR (HTTP-snapshot камер всё ещё возможен через `requests`) |
| **Полная** | + `opencv-python-headless` (RTSP) + **`onnxruntime`** (ANPR) + файл модели на диске | Фото RTSP и локальное распознавание номеров |

`opencv-python-headless` уже перечислен в `server/requirements.txt` и в `server/requirements-cameras.txt`. **`onnxruntime` в requirements не входит** — ставится отдельно для полной сборки с ANPR.

Пример полной установки зависимостей перед `npm run build:win`:

```powershell
pip install -r server/requirements.txt -r server/requirements-build.txt
pip install onnxruntime
```

Модель `plate.onnx` **не** упаковывается в git и **не** должна лежать внутри `_MEIPASS` PyInstaller: её кладут **рядом с exe** в каталог данных приложения (см. ниже). Флаги `video_enabled` / `anpr_enabled` — runtime в `config.ini`, переустановка exe для их смены не нужна.

Секреты, боевые пароли, `.env`, `config.ini` и каталог `BD/` в репозиторий не коммитятся.


## Настройки

### Организация и печать
Реквизиты организации и макет печати:

| Макет | Что печатается |
|-------|----------------|
| **Акт** (по умолчанию) | 2 экземпляра акта на листе |
| **Талон (квитанция)** | 3 экземпляра талона (копии 3, 1, 2) |

Источник веса на печатные формы **не** выводится (только в журнале/CSV).

Экран настроек разбит на вкладки: организация и печать; площадка и весы; камеры и фото; режимы взвешивания; интеграции; год и данные. Активная вкладка запоминается в `sessionStorage` (`app_settings_tab`).

### Камеры и фото

Фотофиксация при сохранении провески (брутто/тара):

1. Включить **«Видеофиксация при сохранении брутто/тары»** (`video_enabled`) на вкладке **Камеры и фото** → подвкладка **Реестр**.
2. Добавить до **4 камер** на площадку: URL (HTTP snapshot или RTSP), тип захвата (`auto` / `http_snapshot` / `rtsp`), роль **въезд / выезд / обзор**.
3. Для обзорной камеры можно задать ROI (доля кадра 0…1).
4. Снять **эталоны primary / spare** для сверки при переключении комплекта весов.
5. **Сохранить настройки**.

#### Поиск камеры

Если известны только IP, логин и пароль (без path snapshot/RTSP):

1. Откройте **Настройки → Камеры и фото → Поиск камеры**.
2. Укажите **IP** (IPv4, опционально `:port`), при желании бренд, логин/пароль, порты HTTP/RTSP (по умолчанию 80 / 554).
3. Нажмите **Найти** — backend переберёт шаблоны URL; прогресс и превью обновляются на экране. **Отмена** прерывает перебор.
4. Выберите рабочий кандидат и **подставьте** в камеру реестра или **создайте** новую (лимит 4). Затем вернитесь в **Реестр** и нажмите **Сохранить**.

| Бренд | Типовые шаблоны |
|-------|-----------------|
| Hikvision | HTTP ISAPI `…/channels/101/picture`; RTSP `Streaming/Channels/101`, `102` |
| Dahua | HTTP `cgi-bin/snapshot.cgi`; RTSP `cam/realmonitor?channel=1&subtype=0\|1` |
| Axis | HTTP `axis-cgi/jpg/image.cgi` |
| Uniview | HTTP `images/snapshot.jpg` |
| Generic / перебор | `snapshot.jpg`, `cgi-bin/snapshot.cgi`; RTSP `/stream1`, `/h264` |

Если ничего не найдено: укажите URL вручную в реестре (подсказка из VLC/ONVIF-клиента вне продукта). Digest-only авторизация без Basic в URL — вне текущего MVP.

Поиск разрешён только к **частным/локальным** IPv4 (RFC1918, loopback, link-local). Пароль не хранится до применения URL и «Сохранить».

| Что | Где |
|-----|-----|
| Файлы JPEG | каталог `Photo/ГГГГ/ММ/ДД/` рядом с программой |
| Метаданные | таблица `ticket_photos` + stubs на провеске |
| RTSP | нужна **полная** сборка с OpenCV (`opencv-python-headless` в requirements) |
| HTTP snapshot | доступен в базовой сборке |

**Кнопки в настройках камеры** (`CameraSetupPreview`):

- **Показать снимок** / **Обновить снимок** — проверка URL без сохранения в журнал.
- **Эталон primary** / **Эталон spare** — снимок в эталон для режима камер.

**На форме взвешивания:**

- монитор **«Камеры на весах»** — живые превью (если видео включено);
- после успешного сохранения веса — автозахват по включённым камерам площадки (тикет сначала синхронизируется в SQLite, затем `POST /api/cameras/capture`).

**Где смотреть фото провески:** карточка после сохранения на форме взвешивания и просмотр провески в журнале (слоты по камерам со статусами ok / ошибка / пропуск).

Не коммитьте боевые URL с паролями и бинарники из `Photo/`.

### Распознавание номеров (ANPR)

Локальное распознавание госномера по **обзорной** камере (ONNX Runtime на CPU). По умолчанию выключено; взвешивание без ANPR работает как обычно.

#### Установка ПО и библиотек

Отдельных «программ ANPR» (EasyOCR, Paddle и т.п.) ставить **не нужно**. Нужны:

| Что | Зачем | Как поставить |
|-----|-------|---------------|
| Python **3.11 или 3.12** | Backend / сборка | Уже в требованиях проекта |
| `onnxruntime` | Движок инференса | `pip install onnxruntime` (в venv той же Python, что запускает API или собирает exe) |
| `opencv-python-headless` | RTSP-захват кадра (и fallback decode) | уже в `server/requirements.txt` / `pip install -r server/requirements-cameras.txt` |
| Файл весов **`plate.onnx`** | Модель номера | Скачать/получить у поставщика модели после спайка; **в репозиторий не коммитить** |

Dev / запуск из исходников:

```bash
pip install -r server/requirements.txt
pip install onnxruntime
# затем положить модель (см. каталоги ниже)
npm run build && npm start
# или npm run dev:api + npm run dev
```

Сборка Windows **полной** поставки (на машине разработчика):

```powershell
pip install -r server/requirements.txt -r server/requirements-build.txt
pip install onnxruntime
npm run build:win
```

В `installer/weighing-system.spec` для полной сборки **не** добавляйте `onnxruntime` / `cv2` в `excludes` (и при необходимости укажите их в `hiddenimports`). Для **базовой** сборки — наоборот: `excludes=['cv2', 'onnxruntime', …]` и не устанавливайте эти пакеты на машине сборки.

На ПК пользователя после установки Setup/portable **отдельно pip не нужен**, если зависимости уже попали в exe. Модель всё равно копируется вручную в каталог данных (ниже).

Ориентир размера: wheel `onnxruntime` ≈ 14–20 MB, на диске после установки ≈ 40–55 MB; OpenCV headless — ещё десятки MB. Модель — отдельно (часто единицы–десятки MB).

#### Где что лежит (каталоги)

Корень приложения (`app_root`):

- **из исходников** — корень репозитория (родитель каталога `server/`);
- **Windows exe** — каталог, где лежит `WeighingSystem.exe` (portable: `dist/WeighingSystem/`; после Setup — выбранный каталог, по умолчанию вроде `C:\Program Files\Система учёта взвешиваний`).

Модель ищется **только** по фиксированному пути относительно `app_root`:

```text
{app_root}/models/anpr/plate.onnx
```

Код: `server/anpr.py` → `models/anpr/plate.onnx`. Каталог `/models/` в `.gitignore`.

**Разработка (клонированный репозиторий):**

```text
weighing-system/                 ← app_root
├── models/
│   └── anpr/
│       └── plate.onnx           ← положить сюда (создайте папки вручную)
├── config.ini
├── BD/
├── Photo/
├── logs/                        ← у exe; при dev часто server/logs
├── server/
└── …
```

```bash
mkdir -p models/anpr
# скопируйте полученный файл весов:
cp /path/to/your-weights.onnx models/anpr/plate.onnx
```

**Windows (portable / установленная программа):**

```text
…\WeighingSystem\                ← app_root (рядом с WeighingSystem.exe)
├── WeighingSystem.exe
├── models/
│   └── anpr/
│       └── plate.onnx           ← скопировать после установки Setup
├── config.ini
├── BD/
├── Photo/
└── logs/
```

В проводнике: создать `models\anpr` **рядом с exe**, положить файл с именем ровно **`plate.onnx`**.  
Не кладите модель внутрь временных/служебных каталогов PyInstaller (`_internal`, распаковка `_MEIPASS`) — при обновлении exe она пропадёт; путь чтения всегда `{каталог exe}/models/anpr/plate.onnx`.

Если конкретной модели нужны sidecar-файлы (словарь, yaml и т.п.) — по документации модели, обычно в тот же `models/anpr/`. Пока I/O конкретной сети не зафиксирован спайком, даже при наличии `plate.onnx` recognize может вернуть `failed` с понятным сообщением — это ожидаемо до выбора боевых весов (`docs/implementation/anpr-spike-checklist.md`).

Проверка: **Настройки → Камеры и фото → Реестр** — строка **«Модель: загружена»**. Если **«недоступна»** — нет `onnxruntime` в рантайме и/или нет файла по пути выше, либо API недоступен.

#### Что нужно на объекте (чеклист)

1. Полная поставка с `onnxruntime` + файл `models/anpr/plate.onnx` в `app_root`.
2. **Видеофиксация** включена; камера роли **обзор** с рабочим URL; ROI на зону номера.
3. Активный комплект — **основные** (primary). На **резерве** движок не вызывается.
4. После спайка с точностью ≥ 50% — включить **«Распознавание номеров (ANPR)»** и **Сохранить**.

#### Настройки в программе

| Где | Параметр | Смысл |
|-----|----------|--------|
| **Настройки → Камеры и фото → Реестр** | **Видеофиксация при сохранении брутто/тары** (`video_enabled`) | Нужна для снимка overview перед распознаванием |
| Там же | **Распознавание номеров (ANPR)** (`anpr_enabled`) | Глобальный выключатель; default **выкл.** |
| Там же | Строка **«Модель: …»** | `загружена` / `недоступна (нужна полная сборка с onnxruntime и файл models/anpr/plate.onnx)` |
| Камера роли **обзор** | **ROI** (x, y, w, h в долях 0…1) | Обрезка кадра под номерной знак |
| Площадка / комплект | Active set **primary** / **spare** | На spare кнопка ANPR недоступна |

Ключи `video_enabled`, `anpr_enabled` пишутся в `{app_root}/config.ini`.

#### На форме взвешивания

1. Убедитесь, что статус ANPR не говорит об отключении на резерве.
2. **«Распознать номер»** — снимок overview (+ ROI) и инференс; тикет сервером сам не пишется.
3. Примите, поправьте или введите номер вручную.

При сбое камеры / отсутствии модели / ошибке движка — `failed`, взвешивание вручную продолжается.

#### Журнал

Фильтр **ANPR**, статус в карточке, поля в CSV. Веса модели и кадры с номерами в git не коммитьте.

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
