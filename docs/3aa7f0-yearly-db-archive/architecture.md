# Архитектура: 3aa7f0-yearly-db-archive

## Обзор

Доработка weighing-system (Flask + SQLite + React): вместо одного `BD/weighing.db` — годовые файлы `BD/weighing-ГГГГ.db`, активный год в `config.ini` (`[settings] active_year`). Рабочий контур (`/api/database`, `/api/storage`, весы, РЭО, импорты) читает и пишет только активный файл. Ротация года — явная admin-операция на сервере (`year_rotation.py`): бэкап, auto-close open-тикетов, копирование справочников/users/sites, пустой журнал. Архив — отдельный read-only API с admin-правкой и аудитом revisions.

## Компоненты

### Backend

| Компонент | Назначение |
|-----------|------------|
| `server/year_db.py` | Годовые пути, list years, legacy-миграция `weighing.db` → `weighing-YYYY.db`, каталог бэкапов |
| `server/year_rotation.py` | Preview/commit ротации, auto-close open, ATTACH+INSERT копирование сущностей, admin-правка архивного тикета |
| `server/sqlite_store.py` | Путь по `active_year`, схема `auto_closed` / `ticket_revisions`, `connect(path=)`, `read_database_at` |
| `server/persistence.py` | Хук миграции, guard `active_year` в `write_config`, поля `paths.active_year` / `backups_dir` |
| `server/app.py` | Routes: years, rotate preview/commit, archive GET, archive ticket POST |

### Frontend

| Компонент | Назначение |
|-----------|------------|
| `src/lib/year-archive.ts` | Fetch years / rotate / archive / edit; reload storage после ротации |
| `src/lib/print-date.ts` | `formatTicketPrintTitle` → «№ N от ДД.ММ.ГГГГ» |
| `src/lib/storage.ts` | `auto_closed`, `TicketRevision`, расширенные audit actions, soft-read |
| `src/lib/storage-sync.ts` | `StoragePaths.active_year` / `backups_dir` |
| `src/components/ArchiveView.tsx` | Выбор года, read-only журнал, admin-edit modal |
| `src/components/SettingsView.tsx` | Блок «Год и архив» / ротация (admin) |
| `src/components/PrintAct.tsx` | Заголовок печати с датой |
| `src/components/WeighingJournal.tsx` | Badge «закрыт при ротации» |
| `src/App.tsx` | Вкладка «Архив» |

### Зависимости потоков

```
config.ini (active_year)
      │
      ▼
year_db.resolve_active_path() ──► sqlite_store.connect()
      │
      ├── year_rotation (archive path → new year)
      ├── /api/database (active only)
      └── /api/database/archive/<year> (read-only / admin patch)
```

## Структура файлов

```
server/
  year_db.py                         # NEW
  year_rotation.py                   # NEW
  sqlite_store.py                    # EDIT
  persistence.py                     # EDIT
  app.py                             # EDIT
  tests/
    conftest.py                      # EDIT
    test_year_db_migrate.py          # NEW
    test_year_rotation.py            # NEW
    test_archive_ticket_edit.py      # NEW
src/
  lib/
    storage.ts                       # EDIT
    storage-sync.ts                  # EDIT
    year-archive.ts                  # NEW
    print-date.ts                    # NEW
    __tests__/
      print-date.test.ts             # NEW
      auto-closed-soft-read.test.ts  # NEW
  components/
    ArchiveView.tsx                  # NEW
    PrintAct.tsx                     # EDIT
    SettingsView.tsx                 # EDIT
    WeighingJournal.tsx              # EDIT
  App.tsx                            # EDIT
docs/
  api.md                             # EDIT: yearly DB + новые endpoints
```

## Модели данных

### Конфиг

```ini
[settings]
active_year = 2026
```

- Тип: строка из 4 цифр (`^\d{4}$`).
- Смена `active_year` через обычный `/api/config` блокируется; меняется только через `/api/database/rotate`.

### Файлы на диске

| Путь | Смысл |
|------|--------|
| `BD/weighing-YYYY.db` | Активный или архивный год |
| `BD/backups/weighing-YYYY-YYYYMMDD-HHMMSS.db` | Бэкап при ротации |
| `BD/weighing.db.migrated-YYYYMMDD-HHMMSS` | Legacy после миграции |

### `weighing_tickets.auto_closed`

| Поле | Тип | Смысл |
|------|-----|--------|
| `auto_closed` | INTEGER NULL DEFAULT 0 | 1 — закрыт при ротации; soft-read: отсутствие → false |

### `ticket_audit.action`

`'created' | 'completed' | 'auto_closed' | 'updated'`

### `ticket_revisions` (новая таблица)

```sql
CREATE TABLE IF NOT EXISTS ticket_revisions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  at TEXT NOT NULL,
  operator_id TEXT,
  operator_name TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);
```

Одна строка на изменённое поле за один save. Для архива отдаётся в archive GET; полная выгрузка в localStorage активного года — вне минимума этапа 6.

### Переносимые сущности при ротации

`users`, `profiles`, `dictionary_entries`, `vehicle_drivers`, `sites`, `scales`, `site_runtime`, `site_scale_switches`.

**Не переносятся:** `weighing_tickets`, `ticket_audit`, `ticket_revisions`, `app_sessions`.

### Auto-close open

1. Тара: `default_tare_weight` ТС → last completed tare того же ТС → `tara_default` из config.
2. При наличии тары и брутто: net = max(0, gross−tare), total = (net/1000)×price.
3. Без тары: всё равно `completed` + `auto_closed=1`, notes с маркером, `attention: true` в отчёте.
4. Audit `auto_closed`, `version += 1`.

### Печатная дата

`completed_at || created_at` → локаль `ru-RU`, формат `ДД.ММ.ГГГГ`.

## API / Интерфейсы

### Расширения существующих

**`GET /api/storage/paths`** — добавлены `active_year`, `backups_dir`; `database_file` указывает на `weighing-YYYY.db`. Старые ключи сохранены.

**`GET/POST /api/database`**, **`/api/storage`**, **`/api/config`** — контракт без ломающих изменений; I/O только на активный год.

### Новые endpoints

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/api/database/years` | Список годов + `active_year` |
| GET | `/api/database/rotate/preview` | Счётчики open / reo_pending, suggested year |
| POST | `/api/database/rotate` | Commit ротации (admin, lock, backup, auto-close, copy) |
| GET | `/api/database/archive/<year>` | Read-only снимок ключей из архивного файла |
| POST | `/api/database/archive/<year>/ticket` | Admin-правка: revisions + audit `updated`, 409 при reo sent / version conflict |

Auth: сервер проверяет `profiles.role == 'admin'` по `operator_id` в **активной** БД (403 иначе).

## Стек технологий

- Backend: Python 3.11/3.12, Flask, stdlib `sqlite3` / `shutil.copy2` / `re` — без новых зависимостей.
- Frontend: React 18, TypeScript, Vite, Tailwind.
- Тесты: pytest (`tmp_path`), Vitest.
- Данные: SQLite в `BD/` рядом с приложением (не в `_MEIPASS`).

## Решения и обоснования

1. **Имя файла `weighing-{YYYY}.db`** — явная годовая схема вместо одного `weighing.db`; `DB_FILENAME` заменён путём от `active_year`.
2. **`active_year` в `[settings]`** — секция `[database]` уже занята бэкап-INI; ключ рядом с прочими настройками через `read_config`/`write_config`.
3. **Legacy: copy + rename в `.migrated-*`** — безопаснее, чем delete; не оставляет два рабочих файла.
4. **`ticket_revisions` + audit `updated`/`auto_closed`** — нормализованный diff без поломки существующих `created`/`completed`; задел под этап 9.
5. **Архивная запись только через dedicated endpoint** — обычный POST `/api/database` не направляется в архив.
6. **ATTACH+INSERT** для копирования таблиц (commit перед DETACH) — надёжнее JSON round-trip.
7. **РЭО из архива вне скоупа** — warning только при ротации и при admin-edit `sent`.
8. **Ротация синхронная с threading.Lock** — редкая операция (раз в год); при занятом lock → 503.
