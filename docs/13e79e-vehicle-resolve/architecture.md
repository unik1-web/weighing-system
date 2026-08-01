# Архитектура: 13e79e-vehicle-resolve

## Обзор

Этап 3 roadmap: автоподстановка реквизитов рейса по госномеру (предпочтения ТС → последний completed → дефолты), история `vehicle_drivers`, настройка `driver_input_mode`, nullable audit-stubs в тикете, показ источника веса / устройства / оператора в журнале и CSV, сохранение `scale_device_id` в AppSettings/config.ini.

Подход — доработка существующего React + Flask + SQLite приложения по паттерну этапа 2: чистый доменный модуль `vehicle-resolve.ts`, prefs ТС в payload справочника `vehicles`, таблица SQLite `vehicle_drivers` с зеркалом `app_vehicle_drivers`, soft-read audit-полей, обучение prefs/history best-effort при `completed`. Новых HTTP-путей `/api/*` нет.

## Компоненты

| Компонент | Назначение |
|-----------|------------|
| `src/lib/vehicle-resolve.ts` | `resolveVehicle`, кандидаты водителей, нормализация `plate_source` / `DriverInputMode` |
| `src/lib/vehicle-learning.ts` | `applyVehicleLearningOnComplete` — prefs + `vehicle_drivers`, try/catch + лог; dispatch `DICTIONARIES_UPDATED_EVENT` |
| `src/lib/weight-source.ts` | Расширен `resolveTareAutofill`: слот last-completed tare → `dictionary` |
| `src/lib/storage.ts` | Типы тикета/settings/словарей; `VehicleDriversStorage`; soft-read audit; hooks complete → learning |
| `src/components/WeighingForm.tsx` | Resolve при смене номера; UI водителя по mode; hydrate/persist `scale_device_id`; `plate_source` |
| `src/components/SettingsView.tsx` | Селекты `driver_input_mode` и модели весов |
| `src/components/WeighingJournal.tsx` | CSV-колонки источников/устройства; modal «Просмотр» |
| `server/sqlite_store.py` | Таблица `vehicle_drivers`; audit-колонки тикета; sync read/write |

### Зависимости

```
WeighingForm
  ├─► vehicle-resolve.resolveVehicle
  ├─► weight-source.resolveTareAutofill
  ├─► DictionaryStorage.getTable (vehicles/drivers) — прямое чтение, без stale hook
  ├─► VehicleDriversStorage
  └─► SettingsStorage (driver_input_mode, scale_device_id, tara_default)

TicketStorage.create / update / createMany (→ completed)
  └─► vehicle-learning.applyVehicleLearningOnComplete
        ├─► DictionaryStorage.update/add (vehicles prefs + default_tare_weight)
        ├─► VehicleDriversStorage.upsert
        └─► DICTIONARIES_UPDATED_EVENT

WeighingJournal ──► WEIGHT_SOURCE_LABELS + ticket fields
storage-sync ──► app_vehicle_drivers ──► sqlite_store
```

## Структура файлов

```
src/lib/vehicle-resolve.ts                 # NEW
src/lib/vehicle-learning.ts                # NEW
src/lib/__tests__/vehicle-resolve.test.ts  # NEW
src/lib/weight-source.ts                   # EDIT — lastCompletedTareWeight
src/lib/__tests__/weight-source.test.ts    # EDIT
src/lib/storage.ts                         # EDIT — types, settings, VehicleDriversStorage, hooks
src/lib/__tests__/storage-weighing.test.ts  # EDIT — defaults, audit soft-read, learning
src/components/WeighingForm.tsx            # EDIT — resolve, driver UI, scale hydrate, plate_source
src/components/SettingsView.tsx            # EDIT — driver_input_mode, модель весов
src/components/WeighingJournal.tsx         # EDIT — CSV + modal
server/sqlite_store.py                     # EDIT — vehicle_drivers + ticket columns + sync
server/tests/test_vehicle_drivers_roundtrip.py  # NEW
docs/api.md                                # EDIT — config keys / app_vehicle_drivers / audit stubs
```

Без изменений (вне скоупа): `PrintAct.tsx`, `reo.ts`, импорт-мапперы Vescom/Metra/WA (кроме косвенного learning через create), `DictionaryManager` preferred_* UI (опционально), `dashboard/`, installer.

## Модели данных

### Предпочтения ТС (vehicles payload)

Поля в JSON payload справочника (без DDL category):

```ts
preferred_driver_name?: string | null;
preferred_cargo_name?: string | null;
preferred_shipper_name?: string | null;
// уже есть: vehicle_brand?, default_tare_weight?, vehicle_number?
```

Нормализация: plate — `formatVehiclePlate`, ФИО — `formatPersonName`, марка — `formatVehicleBrand`.

### vehicle_drivers

```ts
export interface VehicleDriverLink {
  id: string;
  vehicle_number: string;
  driver_name: string;
  last_used_at: string;   // ISO 8601
  use_count: number;
  driver_id?: string | null;
}
```

SQLite: таблица `vehicle_drivers` с UNIQUE `(vehicle_number, driver_name)` и индексом по `vehicle_number`. localStorage: `app_vehicle_drivers`. Совместимо с будущей годовой ротацией (этап 6): копирование строк целиком.

### WeighingTicket — audit stubs

Nullable поля (soft-read в `normalizeTicket`):

```ts
plate_source?: 'anpr' | 'operator' | 'directory' | null;
scale_role?: 'primary' | 'spare' | null;
photo_entry_path?: string | null;
photo_exit_path?: string | null;
photo_overview_path?: string | null;
```

На этапе 3: `plate_source` = `directory` при совпадении со справочником, иначе `operator`; `scale_role` и photo_* = `null`.

### AppSettings

```ts
driver_input_mode: 'vehicle' | 'all' | 'free';  // default: 'all'
scale_device_id: ScaleDeviceId;                 // default: 'microsim-m0601'
```

Плоские ключи в `app_settings` / config.ini. Невалидные значения → дефолты.

### Результат resolve

`resolveVehicle(plate, context)` → brand / driver / cargo / shipper, опционально tare + `tare_source`, `driver_candidates`, `plate_source`, `matched_vehicle_id`.

Приоритет текстовых полей (независимо): prefs ТС → последний completed → `''`.

Тара (`resolveTareAutofill`): `default_tare_weight` → dictionary; иначе last-completed tare → dictionary; иначе `tara_default > 0` → default; иначе null. Guards этапа 2 (`shouldAutofillTare`, `tareAutofillBlocked`) сохранены.

## API / Интерфейсы

Новых HTTP-эндпоинтов нет. Через существующие `/api/config` и `/api/database`:

| Контракт | Ключи / поля |
|----------|--------------|
| config | `driver_input_mode`, `scale_device_id` |
| database | `app_vehicle_drivers` |
| тикет | `plate_source`, `scale_role`, `photo_entry_path`, `photo_exit_path`, `photo_overview_path` |

Публичные функции домена: `normalizeDriverInputMode`, `normalizePlateSource`, `findLastCompletedTrip`, `resolveDriverCandidates`, `resolveVehicle`, `applyVehicleLearningOnComplete`.

## Стек технологий

Без изменений: React 18, TypeScript, Vite, Tailwind; Python 3.11/3.12, Flask; SQLite. Новых npm/pip зависимостей нет. Learning на клиенте; серверная нормализация plate/ФИО через `dictionary_import` не дублируется.

## Решения и обоснования

| Тема | Решение | Обоснование |
|------|---------|-------------|
| Дефолт `driver_input_mode` | `all` | Обратная совместимость UX (полный datalist) |
| Fallback `vehicle` без истории | Показать полный справочник | Неблокирующий UX |
| Photo stubs | Три TEXT-колонки | Простые заготовки под этап 7 |
| Карточка тикета | Modal «Просмотр» в журнале | Без greenfield CRM |
| Обновление `default_tare_weight` на complete | Да, если `tare_weight != null` | Ускоряет следующие single-рейсы |
| Stale prefs после learning | Dispatch события + прямое чтение `DictionaryStorage` | FR6: актуальная подстановка в той же сессии |
| Импорт → bulk seed prefs | Follow-up вне скоупа | Накопление через learning на create completed |

## Follow-up (вне этапа 3)

- Первичное заполнение `vehicle_drivers` / prefs из Vescom/Metra/WA без ожидания complete.
- UI preferred_* в DictionaryManager.
- Камеры/ANPR, `plate_source=anpr`, `scale_role`, реальные photo paths (этапы 4–7).
- Годовая ротация (этап 6) — учесть копирование `vehicle_drivers`.
