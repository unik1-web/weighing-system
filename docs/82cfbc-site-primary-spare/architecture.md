# Архитектура: 82cfbc-site-primary-spare

## Обзор

Этап 4 roadmap weighing-system: модель площадки с комплектами весов primary/spare, runtime активного комплекта и журналируемым переключением. Новые талоны пишут `site_id` / `scale_id` / `scale_role` активного комплекта; на spare `anpr_mode = disabled_by_configuration`. Доработка существующего React + Flask + SQLite без новых HTTP-путей и без новых npm/pip зависимостей.

Источник истины комплекта — таблицы/ключи `scales` + `site_runtime`; `AppSettings.scale_device_id` остаётся быстрым кэшем `adapter_id` активного scale для ScalePanel/WeighingForm.

## Компоненты

```
SettingsView / SpareSwitchWizard
        │
        ▼
site-runtime.ts  ──► SitesStorage / ScalesStorage /
        │            SiteRuntimeStorage / SiteScaleSwitchesStorage
        │                      │
        │                      ▼
        │              storage.ts persist → scheduleDatabaseSync
        │                      │
WeighingForm ──► getActiveScaleContext() ──► TicketStorage.create
        │                      │
        ▼                      ▼
ScalePanel (scale_device_id)   sqlite_store (sites/scales/…)
```

| Компонент | Назначение |
|-----------|------------|
| `src/lib/site-runtime.ts` | Домен: типы/enums, `ensureSiteMigrated()`, `getActiveScaleContext()`, `switchScaleSet()`, `enableSpareScale()`, `disableSpareScale()`, событие `site-runtime-updated` |
| `src/lib/storage.ts` | STORAGE_KEYS, CRUD `SitesStorage` / `ScalesStorage` / `SiteRuntimeStorage` / `SiteScaleSwitchesStorage`, поля тикета `site_id`/`scale_id`, soft-read в `normalizeTicket` |
| `src/components/SpareSwitchWizard.tsx` | Модальный wizard primary→spare (причина / терминал / камеры / ANPR / confirm) и короткое подтверждение spare→primary |
| `src/components/SettingsView.tsx` | Секция «Площадка и весы»: имя site, primary/spare профили, enable spare, индикация активного, кнопка переключения, журнал |
| `src/components/WeighingForm.tsx` | `auditCreateFields` из runtime; смена device → активный scale; индикатор комплекта |
| `src/hooks/useAuth.tsx` | Вызов `ensureSiteMigrated` после load/init |
| `server/sqlite_store.py` | DDL `sites`/`scales`/`site_runtime`/`site_scale_switches`, TICKET_COLUMNS `site_id`/`scale_id`, roundtrip sync |

## Структура файлов

```
src/lib/site-runtime.ts                         # NEW — домен
src/lib/__tests__/site-runtime.test.ts          # NEW — миграция, switch, anpr, ticket fields, disable-spare
src/lib/storage.ts                              # EDIT — keys, ticket fields, storage facades
src/lib/__tests__/storage-weighing.test.ts       # EDIT — soft-read site_id/scale_id; create с комплектом
src/components/SpareSwitchWizard.tsx            # NEW
src/components/SettingsView.tsx                 # EDIT — секция площадки/весов
src/components/WeighingForm.tsx                 # EDIT — fill site/scale; device → active scale
src/hooks/useAuth.tsx                           # EDIT — ensureSiteMigrated после load
server/sqlite_store.py                          # EDIT — DDL, columns, sync
server/tests/test_site_scales_roundtrip.py      # NEW — roundtrip app_* + ticket site fields
docs/api.md                                     # EDIT — новые ключи и колонки
```

Не затронуты: `resolveVehicle`, weight-source, PrintAct, reo, импорты Vescom/Metra/WA, installer/, dashboard/.

## Модели данных

### TypeScript

- `Site`: id, name («Основная площадка»), is_default, created_at
- `Scale`: id, site_id, role (`primary`|`spare`), name, adapter_id (`ScaleDeviceId`), connection (Web Serial профиль без OS-порта/секретов), enabled, created_at
- `SiteRuntime`: site_id, active_scale_set, camera_mode, anpr_mode, switch_reason / switch_by_operator_* / switch_at
- `SiteScaleSwitchEvent`: append-only журнал (from_set, to_set, reason, operator, at, camera_ack)
- `ActiveScaleContext`: site + runtime + activeScale + site_id/scale_id/scale_role/adapter_id

Enums:
- `camera_mode`: `normal` | `rotated_for_spare`
- `anpr_mode`: `enabled` | `disabled_by_configuration` | `failed`
- `switch_reason`: `repair` | `cleaning` | `verification` | `other` (+ русские labels)

### WeighingTicket (расширение)

- `site_id?: string | null` — soft-read
- `scale_id?: string | null` — soft-read
- `scale_role?: 'primary' | 'spare' | null` — уже было; для новых create заполняется из runtime

Старые/импортные тикеты: все три null. Dual complete не перезаписывает эти поля.

### SQLite

Таблицы: `sites`, `scales`, `site_runtime`, `site_scale_switches`.  
Индекс `idx_scales_site_role` + application-level enforce ≤1 enabled per (site, role).  
ALTER `weighing_tickets`: nullable `site_id`, `scale_id`.

### localStorage / `/api/database`

| Ключ | Формат |
|------|--------|
| `app_sites` | `Site[]` |
| `app_scales` | `Scale[]` |
| `app_site_runtime` | `SiteRuntime[]` |
| `app_site_scale_switches` | `SiteScaleSwitchEvent[]` |

Partial POST не очищает отсутствующие ключи (паттерн `vehicle_drivers`).

### Миграция `ensureSiteMigrated()` (идемпотентна)

При пустых sites/scales: default site + enabled primary из `scale_device_id` + disabled spare-placeholder + runtime primary / anpr enabled. Повторный вызов не дублирует.

### Переключение `switchScaleSet`

- Primary → spare: требуется enabled spare + `camera_ack`; атомарно runtime spare / `rotated_for_spare` / `disabled_by_configuration` + journal + sync `scale_device_id`
- Spare → primary: причина + confirm; restore camera/anpr primary-значения
- `disableSpareScale`: запрет при `active_scale_set=spare`; при split-brain — warn + self-heal runtime на primary

## API / Интерфейсы

Новых HTTP-путей нет.

- **GET/POST `/api/database`** — ключи `app_sites`, `app_scales`, `app_site_runtime`, `app_site_scale_switches`; тикеты могут содержать `site_id`/`scale_id`
- **GET/POST `/api/config`** — без новых обязательных ключей; `scale_device_id` — кэш активного профиля

Публичные функции `site-runtime.ts`: `ensureSiteMigrated`, `getDefaultSite`, `getActiveScaleContext`, `getSiteRuntime`, `listScalesForSite`, `updateSite`, `upsertScale`, `enableSpareScale`, `disableSpareScale`, `switchScaleSet`, `listSwitchHistory`, `updateActiveScaleDevice`.

Wizard props: `{ direction: 'to_spare' | 'to_primary'; onDone(); onCancel(); }`. Cancel не меняет runtime.

## Стек технологий

Без изменений: React 18, TypeScript, Vite, Tailwind CSS, Flask (`127.0.0.1:5001`), SQLite, Python 3.11/3.12. Web Serial как существующий `scales.ts` / ScaleConnection. Новых зависимостей нет.

## Решения и обоснования

1. **SQL + localStorage-зеркало** — журнал переключений должен переживать reload; паттерн как у `vehicle_drivers`.
2. **Источник истины комплекта** — scales + site_runtime; `scale_device_id` только кэш для UI весов.
3. **Spare placeholder при миграции** (`enabled=false`) — можно иметь primary сразу и включить spare позже; взвешивание на primary не блокируется.
4. **Отдельная таблица журнала** — критерий «журналируется» = восстановить кто/когда/причина, не только last-* на runtime.
5. **Application-level ≤1 enabled per role** + обычный INDEX вместо partial UNIQUE — проще и достаточно для одной площадки.
6. **Запрет disable spare на активном spare** (не скрытый switch) — не выдумываем reason/operator; UI + доменный throw; self-heal split-brain с logger.warn.
7. **Импорты Vescom/Metra/WA** — не фабрикуют комплект (поля null), без регрессии печати/РЭО.
