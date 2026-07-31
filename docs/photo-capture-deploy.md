# Развёртывание фотофиксации (stage 7)

Операционный runbook выката dual-поставки basic/full, миграции schema v7 и graceful degrade камер. Команды запуска совпадают с production entrypoint: `npm run build`, `npm start`, Windows `WeighingSystem.exe` / `WeighingSystem-Full-Setup.exe`.

ANPR-инференс и обязательная печать фото в актах/талонах — **вне скоупа** этапа 7.

## Подготовка окружения

### Требуемые каталоги рядом с приложением

Данные живут **рядом с приложением** (`get_app_root()`), не внутри PyInstaller `_MEIPASS`:

| Каталог / файл | Назначение |
|----------------|------------|
| `config.ini` | Настройки, в т.ч. `video_enabled`, `camera_capture_timeout_sec`, `camera_jpeg_quality`, `active_year` |
| `BD/` | Годовые БД `BD/weighing-ГГГГ.db` (таблицы `cameras`, `ticket_photos` после migration v7) |
| `backup/` | Backup миграций/ротаций |
| `logs/` | `logs/app.log` (в т.ч. camera/photo события с маскированием URL) |
| `Photo/` | JPEG снимков тикетов и эталонов (`Photo/ГГГГ/ММ/ДД/…`, `Photo/etalons/…`) |

Каталог `Photo/` создаётся лениво при первой записи. Installer (Inno Setup) заранее готовит `BD/`, `backup/`, `logs/`, `Photo/` с правами записи пользователя.

### Недопустимость хранения данных в `_MEIPASS`

В frozen-сборке UI берётся из `sys._MEIPASS/dist`, а `config.ini`, `BD/`, `backup/`, `logs/`, `Photo/` всегда рядом с exe. Запись постоянных данных в `_MEIPASS` запрещена.

### Выбор поставки basic / full

| Поставка | Артефакт | OpenCV | Камеры в runtime |
|----------|----------|--------|------------------|
| basic | `WeighingSystem-Setup.exe` | нет | `GET /api/cameras/capability` → `available=false`, `build=basic` |
| full | `WeighingSystem-Full-Setup.exe` | `opencv-python-headless` | `available=true`, `build=full`; `video_enabled` без переустановки |

Dev/full smoke deps: `pip install -r server/requirements-full.txt`. Basic: `server/requirements.txt` (без opencv).

## Preflight / Backup перед обновлением

1. Остановить все процессы приложения (`npm start`, `WeighingSystem.exe`).
2. Сделать согласованную копию **вне** каталога приложения:
   - `config.ini` → например `config.pre-stage7.ini`
   - активный `BD/weighing-ГГГГ.db` (и при необходимости другие годовые файлы)
   - существующий каталог `Photo/` (если уже был на площадке)
3. Зафиксировать текущий `active_year`, `video_enabled` и список файлов в `BD/` / `Photo/`.

## Установка basic / full

### Basic (без OpenCV)

```powershell
# сборка
pip install -r server/requirements.txt -r server/requirements-build.txt
npm run build:win
# установщик: release/WeighingSystem-Setup.exe
```

После установки: capability `available=false`; секция «Видео» недоступна / noop capture.

### Full (фотофиксация / RTSP)

```powershell
pip install -r server/requirements-full.txt -r server/requirements-build.txt
npm run build:win:full
# установщик: release/WeighingSystem-Full-Setup.exe
```

После установки: capability `available=true`; `video_enabled` включается в Настройки → Видео без переустановки.

Локальный (не-Windows) запуск full для smoke:

```bash
npm run build
pip install -r server/requirements-full.txt
OPEN_BROWSER=0 npm start
```

## Миграция schema v7

На первом запуске после релиза `init_schema` / `migrate_schema_stage_7` идемпотентно:

1. Создаёт таблицы `cameras`, `ticket_photos` (и индексы).
2. Выставляет `PRAGMA user_version = 7`.
3. Повторный запуск безопасен (idempotent).

Проверка:

```bash
# в active-year DB
sqlite3 BD/weighing-ГГГГ.db "PRAGMA user_version;"
# ожидается: 7
sqlite3 BD/weighing-ГГГГ.db ".tables"
# ожидаются cameras, ticket_photos
```

Бинарники JPEG **не** пишутся в SQLite — только относительные пути/метаданные.

## Включение video и настройка камер (full)

1. Войти как `admin`.
2. Настройки → Видео → включить `video_enabled`.
3. Добавить 1–4 камеры (роли `entry` / `exit` / `overview`), HTTP snapshot и/или RTSP URL.
4. «Проверить» (`POST /api/cameras/test`) или snapshot для live-кадра.
5. Снять эталоны primary/spare (`POST /api/cameras/etalon`) при необходимости wizard spare.

Ключи `config.ini` (группа settings, не отдельная секция `[video]`):

```ini
[settings]
video_enabled = true
camera_capture_timeout_sec = 3
camera_jpeg_quality = 80
```

Секреты RTSP (логин/пароль в URL) хранятся только в SQLite / `config` площадки — **не** в git и не в evidence-отчётах. В логах URL маскируются (`mask_url`).

## Проверка capture / degrade

Production-like entrypoint: `npm run build && npm start` (не Vite).

```bash
# capability (basic vs full)
npm run smoke:photo-capability

# noop: video_enabled=false или 0 enabled камер
npm run smoke:photo-capture-noop

# HTTP success (нужен доступный HTTP snapshot fixture / камера)
npm run smoke:photo-capture-http

# degrade: недоступная камера → вес OK, ticket_photos.status=failed
npm run smoke:photo-capture-degrade

# import-smoke веток поставки
npm run smoke:photo-basic-import
npm run smoke:photo-full-import
```

Ожидания:

- При доступной камере после фиксации веса — JPEG под `Photo/ГГГГ/ММ/ДД/` рядом с exe, метаданные в `ticket_photos`.
- При таймауте/unreachable — взвешивание **не** блокируется (graceful degrade), stubs previous success не затираются failed-попыткой.
- Basic-import проходит без OpenCV; full-import требует OpenCV (fail без deps — не «тихий basic»).

## Rollback

1. Остановить приложение.
2. Восстановить preflight-пару:
   - `config.pre-stage7.ini` → `config.ini`
   - копию `BD/weighing-ГГГГ.db` → `BD/`
   - при необходимости — каталог `Photo/`
3. Вернуть предыдущий установщик (basic или full) при откате бинаря.
4. Не удалять `Photo/` «на глаз», если оператору нужны исторические кадры; retention — внеоперационная процедура.

## Секреты и запреты для git / CI

Checklist (CI evidence-gate + review):

- [ ] Нет RTSP/HTTP URL с паролями в коммитах, фикстурах и `docs/reports/photo-capture/`
- [ ] Нет бинарников JPEG / персональных кадров в git
- [ ] Evidence содержит только пути/коды статусов, не base64 кадров
- [ ] Логи в отчётах — с уже замаскированными URL

## Smoke / CI

- Локально: `npm run test:stage7` (backend + frontend)
- Workflow: `.github/workflows/photo-capture.yml` — jobs `frontend-tests`, `backend-tests`, `build`, `import-smoke-basic`, `import-smoke-full`, `windows-package` (basic/full при наличии runner), `evidence-gate`
- Release checklist: `docs/reports/photo-capture/release-checklist.md`
- Acceptance: `docs/reports/photo-capture/photo-capture-acceptance.md`

## Регрессия после выката

- primary/spare wizard (эталон vs live snapshot)
- single / dual взвешивание
- PrintAct / печать **без** обязательных фото
- Archive preview stubs-only (полный `ticket_photos` в archive API — вне stage 7)
- Stage 6 yearly archive / stage 5 scales — без регрессии
