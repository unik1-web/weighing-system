# Архитектура: abd91a-audit-reports-security (этап 9)

## Обзор решения

Доработка weighing-system (React + Flask + SQLite): закрыть операционный UI площадки, полный audit правок тикета (активный год + архив), расширенные фильтры/CSV/карточку журнала, серверный hash паролей с принуждением смены дефолтного admin, актуализацию docs/README (в т.ч. dual-build).

Ключевые решения:

1. **Единая модель audit** — без новых таблиц: `ticket_audit` (событие `created|completed|auto_closed|updated`) + `ticket_revisions` (построчный diff). Активный год пишет revisions на клиенте при `TicketStorage.update`; архив — как сейчас в `year_rotation.update_archive_ticket`. Общий whitelist значимых полей.
2. **Auth на сервере** — PBKDF2-HMAC-SHA256 (stdlib), endpoints `/api/auth/*`; plaintext пароль не в localStorage и не в sync `app_users`. Transparent upgrade legacy `btoa`.
3. **`must_change_password`** — колонка в `users`; дефолтный admin создаётся с флагом `1`; UI блокирует основной контур до смены.
4. **Фильтры/CSV** — только клиентская фильтрация (как сейчас); без серверной пагинации.
5. **Graceful degradation** — индикаторы ANPR/камер скрыты или «недоступно», если `video_enabled`/`anpr_enabled` выкл. или capabilities недоступны.
6. **Печать** — источник веса на акт/талон не выводить (без изменений PrintAct).

## Компоненты системы

### Backend

| Компонент | Назначение |
|-----------|------------|
| `server/auth_passwords.py` | **NEW**: `hash_password`, `verify_password`, `is_legacy_btoa_hash`, `needs_rehash`, константы PBKDF2 |
| `server/auth_api.py` или блок в `app.py` | Routes `/api/auth/login`, `/change-password`, `/register` |
| `server/sqlite_store.py` | Колонка `must_change_password`; load users **без** `passwordHash` в sync-ответе (флаг отдельно); write users не перетирает hash пустым значением с клиента |
| `server/year_rotation.py` | Расширить `ARCHIVE_EDITABLE_FIELDS`; при no-op diff не писать пустой `updated` (исправить известный issue этапа 6 при касании) |
| `server/app.py` | Регистрация auth routes; docs dual-build не трогает installer без явной правки скриптов |

### Frontend

| Компонент | Назначение |
|-----------|------------|
| `src/lib/auth-api.ts` | **NEW**: fetch login / change-password / register |
| `src/lib/ticket-audit-fields.ts` | **NEW**: `SIGNIFICANT_TICKET_FIELDS`, `diffTicketFields`, stringify как на сервере |
| `src/lib/storage.ts` | `TicketRevisionStorage`; revisions+`updated` в `TicketStorage.update`; UserStorage без btoa; `must_change_password` soft-read |
| `src/lib/journal-filters.ts` | **NEW** (реком.): helpers фото/ANPR/site/scale/mode/operator match |
| `src/hooks/useAuth.tsx` | Login/register через API; `mustChangePassword` в контексте; `changePassword` |
| `src/components/ForceChangePasswordModal.tsx` | **NEW**: блокирующий экран смены пароля |
| `src/components/TicketHistoryPanel.tsx` | **NEW**: хронология audit + revisions |
| `src/components/WeighingForm.tsx` | Индикатор режима площадки (комплект + ANPR + камеры) |
| `src/components/SettingsView.tsx` | Полный журнал `listSwitchHistory` (scroll / «показать все») |
| `src/components/WeighingJournal.tsx` | Фильтры, CSV, карточка + история |
| `src/components/ArchiveView.tsx` | История в карточке/модалке; правки admin без изменений прав |
| `docs/architecture.md`, `docs/api.md`, `README.md` | Актуализация + dual-build |

### Зависимости потоков

```
[Auth]
LoginForm ──► useAuth.signIn ──POST /api/auth/login──► auth_passwords.verify
                │                         │
                │                         ├─ legacy btoa → rehash PBKDF2
                │                         └─ { user, profile, must_change_password }
                ▼
         must_change? ──► ForceChangePasswordModal ──POST /api/auth/change-password
                │
                ▼
              App UI

[Audit active year]
TicketStorage.update
  ├─ diff(SIGNIFICANT_TICKET_FIELDS)
  ├─ TicketRevisionStorage.appendMany
  ├─ TicketAuditStorage.append(action=updated)  // только если был diff
  └─ persist → scheduleDatabaseSync → app_ticket_revisions / app_ticket_audit

[Audit archive]
ArchiveView ──POST /api/database/archive/<year>/ticket──► year_rotation
                                                         (тот же whitelist + revisions)

[Journal filters]
WeighingJournal ── client AND-filters ── CSV export / TicketHistoryPanel
```

## Структуры данных

### Пароли и пользователи

**Формат hash (сервер):**

```
pbkdf2_sha256$<iterations>$<salt_b64>$<dk_b64>
```

- Алгоритм: PBKDF2-HMAC-SHA256, `hashlib` + `secrets` (stdlib).
- `iterations`: **260000** (рекомендация; константа в одном месте).
- Salt: 16 bytes, random.
- Legacy: значение без префикса `pbkdf2_sha256$` считается `btoa` (latin1/utf-8 base64 как в браузере). При успешной проверке — сразу перезаписать PBKDF2.

**SQLite `users` — добавить:**

| Колонка | Тип | Смысл |
|---------|-----|--------|
| `must_change_password` | INTEGER NOT NULL DEFAULT 0 | 1 — блокировать UI до смены |

Миграция: `ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0` в `ensure_*` / init_schema.

**Sync `app_users` (ответ GET `/api/database`):**

```json
{ "id", "email", "username", "mustChangePassword": true|false }
```

**Не** отдавать `passwordHash` / `password_hash` клиенту. POST sync: игнорировать попытки клиента записать `passwordHash`; hash меняется только через `/api/auth/*`. Флаг `must_change_password` — **server-owned**: `_replace_users` всегда сохраняет значение из БД (`existing_flags`), клиентский `mustChangePassword` игнорируется (нельзя сбросить gate через sync).

**Создание дефолтного admin** (`initializeStorage` / серверный bootstrap при пустой БД):

- username `admin`, password `admin123`, `must_change_password=1`.
- Предпочтительно: первый admin создаётся через серверный путь (register/bootstrap), чтобы hash сразу PBKDF2. Если клиент ещё создаёт локально до sync — после первого login/register сервер перехеширует.

**Детект дефолта дополнительно:** при login, если `username==admin` и plaintext==`admin123`, выставлять `must_change_password=1` даже если флаг был сброшен ошибочно (защита от отката). После успешной смены на другой пароль — флаг `0`.

### Значимые поля тикета (whitelist)

Общий список `SIGNIFICANT_TICKET_FIELDS` / расширение `ARCHIVE_EDITABLE_FIELDS`:

Существующие archive fields **плюс**:

```
photo_entry_path, photo_exit_path, photo_overview_path,
anpr_plate_raw, plate_confidence, anpr_accepted, anpr_status
```

Не аудитить как «значимую правку» сам `version`, служебные инкременты без смены полей, и чистый `completed` transition (для перехода open→completed остаётся action `completed`; если одновременно менялись значимые поля — `completed` + revisions по diff, без отдельного `updated` в том же update, **или** `updated`+revisions затем `completed` — рекомендация: **один** audit `completed` + revisions по всем изменившимся значимым полям, без дублирующего `updated`).

Правило для `TicketStorage.update`:

1. Посчитать diff по whitelist (stringify null/bool/number как в `year_rotation._stringify_revision_value`).
2. Если diff пуст и нет перехода в `completed` — ничего в audit/revisions.
3. Если diff непуст и не переход в completed — `updated` + revisions.
4. Если переход в completed — `completed` (+ revisions если были значимые изменения весов/полей в том же update).
5. `operator_id` / `operator_name` для revisions: из `merged.operator_*` или опционального `options.auditOperator` (рекомендация: добавить `options?: { expectedVersion?; auditOperator?: { id, name } }` и передавать из UI текущую сессию при правках).

### `TicketRevisionStorage` (клиент)

```ts
TicketRevisionStorage = {
  ensureInitialized(): void;
  getAll(): TicketRevision[];
  getByTicketId(ticketId: string): TicketRevision[];
  appendMany(revisions: Omit<TicketRevision, 'id'>[]): void;
}
```

Ключ sync уже есть: `app_ticket_revisions`.

### Журнал фильтров (клиент)

| Фильтр | Логика |
|--------|--------|
| `site_id` | exact match; «не задано» = null/'' |
| `scale_id` / `scale_role` | exact; role `primary`\|`spare` |
| фото | `has` = есть строки в `TicketPhotosStorage` **или** любой soft-path `photo_*_path`; `none` = иначе |
| `anpr_status` | exact; пусто/null = «не задано» |
| `weighing_mode` | `single`\|`dual` |
| оператор | `operator_id` exact **или** подстрока по `operator_name` |

AND между группами; weight sources — OR внутри мультивыбора (как сейчас).

### CSV новые колонки

После существующих: `Площадка` (имя из SitesStorage или site_id), `Роль весов`, `Весы` (имя ScalesStorage / scale_id), `Есть фото` (`да`/`нет`), `ANPR`, `Режим` (`single`/`dual` русские подписи), оператор уже есть.

## API и интерфейсы

### Новые endpoints

| Метод | Путь | Тело | Ответ |
|-------|------|------|-------|
| `POST` | `/api/auth/login` | `{ username, password }` | `{ success, user: {id,email,username}, profile, must_change_password }` или 401 |
| `POST` | `/api/auth/change-password` | `{ user_id, current_password, new_password }` | `{ success, must_change_password: false }`; **`current_password` всегда обязателен** (в т.ч. при `must_change_password=1`) — verify против stored hash; иначе 401. Сервер: minLength≥6, `new_password != 'admin123'`. Закрывает LAN takeover по публичному `user_id` из `GET /api/database` |
| `POST` | `/api/auth/register` | `{ username, password, display_name }` | создаёт user+profile (роль admin если первый, иначе user); hash на сервере; `{ success, user, profile }` |

Ошибки — как в остальном API: `{ success: false, message }` + 4xx. **Не** логировать plaintext паролей.

Сессии по-прежнему клиентские (`app_sessions`); logout всех сессий при смене пароля — вне минимума.

### Существующие (без ломающих изменений)

- `/api/database` — users без hash; revisions/audit roundtrip как сейчас.
- `/api/database/archive/<year>/ticket` — тот же контракт; расширенный whitelist полей.
- Cameras/ANPR capabilities — только чтение для индикатора шапки.

## Технологический стек

| Выбор | Обоснование |
|-------|-------------|
| PBKDF2-HMAC-SHA256 stdlib | Без новых pip-зависимостей; Python 3.11/12; достаточно для локального single-user/LAN продукта |
| Клиентские фильтры | Совместимо с текущим журналом; NFR |
| Общий whitelist полей | Согласование с archive этапа 6; одна семантика diff |
| Без OAuth | Вне скоупа |

## Файловая структура

```
server/
  auth_passwords.py              # NEW
  app.py                         # EDIT — /api/auth/*
  sqlite_store.py                # EDIT — must_change_password; strip hash from load
  year_rotation.py               # EDIT — ARCHIVE_EDITABLE_FIELDS + skip empty updated
  tests/
    test_auth_passwords.py       # NEW — hash/verify/legacy upgrade
    test_auth_api.py             # NEW — login/change/register/must_change
    test_archive_ticket_edit.py  # EDIT — новые поля whitelist; no-op

src/
  lib/
    auth-api.ts                  # NEW
    ticket-audit-fields.ts       # NEW
    journal-filters.ts           # NEW (реком.)
    storage.ts                   # EDIT
    __tests__/
      auth-api.test.ts           # NEW (mock fetch) или storage-auth
      journal-filters.test.ts    # NEW
      ticket-revisions.test.ts   # NEW — update пишет revisions
  hooks/useAuth.tsx              # EDIT
  components/
    ForceChangePasswordModal.tsx # NEW
    TicketHistoryPanel.tsx       # NEW
    WeighingForm.tsx             # EDIT — site mode header
    SettingsView.tsx             # EDIT — full switch history
    WeighingJournal.tsx          # EDIT — filters/CSV/history
    ArchiveView.tsx              # EDIT — history panel
  App.tsx                        # EDIT — gate mustChangePassword

docs/
  architecture.md                # EDIT
  api.md                         # EDIT — /api/auth + users sync без hash
  README.md                      # EDIT — dual-build кратко
  abd91a-audit-reports-security/
    architecture.md              # этот документ
```

Не трогать: `installer/` скрипты (только документировать dual-build), `dashboard/`, PrintAct (источник веса), OAuth.

## UI детали (реализация)

### Шапка WeighingForm

Рядом с «Комплект: …»: компактный текст/бейджи:

- Комплект: подпись из `ACTIVE_SCALE_SET_LABELS`
- ANPR: если `anpr_enabled` или capabilities.available — статус runtime (`enabled` / `disabled_by_configuration` / недоступен); иначе скрыть
- Камеры: если `video_enabled` — «вкл.» / «выкл.» / «нет камер» по `CamerasStorage` для site; иначе скрыть

Обновление по `site-runtime-updated` + settings (уже есть паттерн).

### Журнал переключений

В `SettingsView`: убрать жёсткий `.slice(0, 10)` или добавить «Показать все» + `max-height` scroll по полному `listSwitchHistory(site.id)`.

### История в карточке

`TicketHistoryPanel({ ticketId, audit, revisions })`:

- Сортировка по `at` asc
- Строки audit (создан / завершён / авто-закрыт / обновлён)
- Под `updated`/`completed` с revisions — вложенный список поле: было → стало, оператор, время
- Пусто → «История изменений отсутствует»
- Видно ролям `user` и `admin`; кнопки правки архива — только admin

### Force change password

После login с `must_change_password`: рендер модалки поверх App (нельзя закрыть/обойти навигацией). Поля: **текущий пароль**, новый пароль, подтверждение; validation ≥6, ≠`admin123`, совпадение. Успех → обновить контекст, продолжить работу.

## Тесты (минимум для development/testing)

1. `hash_password` / `verify_password`; legacy btoa accept + rehash.
2. login + must_change для admin123; change-password сбрасывает флаг; reject short / admin123.
3. `TicketStorage.update` пишет revisions+updated; no-op без audit.
4. journal-filters: site/role/photo/anpr/mode.
5. Регрессия: archive edit по-прежнему пишет revisions; sync users без passwordHash.

## Зафиксированные решения (после code-review / auth rework)

| Тема | Итог |
|------|------|
| Имя модуля auth routes | `auth_passwords.py` + хендлеры в `app.py` |
| `current_password` при must_change | **Всегда обязателен** (закрыт unauth reset по `user_id`) |
| `must_change_password` sync | Server-owned; клиент не может clear-to-0 |
| Bootstrap admin | Сервер при пустой таблице users (PBKDF2 + `must_change=1`) |
| ReportsView сводки | Вне минимума — не делалось |
| Archive no-op | Без bump version и без пустого `updated` |
| Logout всех сессий при смене пароля | Вне минимума |
| Ограничение `/api/auth/register` ролью admin | Вне минимума (LAN/bootstrap) |

## Критерии готовности для development

- Разработчик знает файлы, whitelist полей, контракты `/api/auth/*`, правила strip hash из sync.
- Audit активного года согласован с archive revisions.
- UI: шапка, полный switch-history, история в карточке, фильтры/CSV, force-change modal.
- Docs/README в скоупе этапа 9.
