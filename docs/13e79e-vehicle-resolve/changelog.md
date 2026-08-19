# История изменений: 13e79e-vehicle-resolve

## Описание задачи

Источник: `docs/tasks/03-vehicle-resolve.md`.

Цель: при выборе/вводе госномера заполнять реквизиты рейса за 1–2 действия (марка, тара, ФИО, груз, грузоотправитель) на основе предпочтений ТС, последнего рейса и истории водителей; настроить `driver_input_mode` (`vehicle` \| `all` \| `free`); сущность `vehicle_drivers`; nullable audit-поля (`plate_source`, `scale_role`, фото); показ источника веса / устройства / оператора в карточке и CSV; сохранение модели весов в config.ini.

Зависимости: этапы 1–2 (weighing_mode, WeightSource dictionary/default). Вне скоупа: primary/spare, камеры, ANPR, годовая ротация БД, полный UI архива.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR1–FR9 — resolve по plate с приоритетами prefs → last completed → defaults; модуль `vehicle-resolve.ts`; `vehicle_drivers`; `driver_input_mode`; learning на complete; audit stubs; UI журнала/CSV/настроек; импорт bulk seed — follow-up. Приёмка: частая машина → 1–2 действия; WeightSource автотары; sync prefs/history.

### [Архитектура] Execution 2
- Статус: done
- Результат: доменный модуль + learning; prefs в payload vehicles; таблица `vehicle_drivers` + `app_vehicle_drivers`; soft-read audit; default mode `all`; modal журнала; расширение `resolveTareAutofill` (lastCompleted); без новых HTTP-путей; критерии готовности для development.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `src/lib/vehicle-resolve.ts` (NEW)
  - `src/lib/vehicle-learning.ts` (NEW)
  - `src/lib/__tests__/vehicle-resolve.test.ts` (NEW)
  - `src/lib/weight-source.ts`, `src/lib/__tests__/weight-source.test.ts`
  - `src/lib/storage.ts`, `src/lib/__tests__/storage-weighing.test.ts`
  - `src/components/WeighingForm.tsx`, `SettingsView.tsx`, `WeighingJournal.tsx`
  - `server/sqlite_store.py`, `server/tests/test_vehicle_drivers_roundtrip.py` (NEW)
  - `docs/api.md`
- Не реализовано (опционально/follow-up): UI preferred_* в DictionaryManager; bulk seed из импортов.

### [Код-ревью] Execution 4
- Статус: done (Request Changes → возврат в development)
- Результат: stale prefs после learning — `applyVehicleLearningOnComplete` не диспатчит `DICTIONARIES_UPDATED_EVENT`, а `WeighingForm` берёт vehicles из stale `useDictionary`. Ломает FR6 в той же сессии. Некритично: пересчёт candidates при смене mode; отсутствие UI preferred_*.

### [Разработка] Execution 5
- Статус: done
- Реализованные файлы (fix):
  - `src/lib/vehicle-learning.ts` — dispatch `DICTIONARIES_UPDATED_EVENT`
  - `src/components/WeighingForm.tsx` — `DictionaryStorage.getTable` напрямую в resolve
  - `src/lib/__tests__/storage-weighing.test.ts` — тест dispatch
- Проверки: typecheck OK; vitest storage-weighing / vehicle-resolve / weight-source — 36 passed.

### [Код-ревью] Execution 6
- Статус: done (Approve)
- Результат: оба варианта исправления применены; FR6 закрыт; typecheck OK; vitest 36 passed; pytest 60 passed. Некритичные UX-замечания оставлены as-is.

### [Тестирование] Execution 7
- Статус: done
- Результат: `npm run typecheck` OK; `npm test` — **77 passed**; узкий прогон этапа 3 — **36 passed**; `pytest` — **60 passed** (в т.ч. 3 vehicle_drivers roundtrip). FR1–FR8 покрыты существующими тестами + smoke кода; FR9 вне скоупа. Предложены доп. edge-кейсы (на диск не записывались). Вердикт: pass → tech-writer.

### [Документация] Execution 8
- Статус: done
- Результат: созданы `docs/13e79e-vehicle-resolve/{architecture,changelog,issues}.md`.

## Git история

```
96e95fc fix(vehicle-resolve): refresh vehicle prefs after learning
3b2b3f8 feat(vehicle-resolve): autofill trip fields from plate and driver history
e8c7b36 feat: expand WeightSource with dictionary/default and UI visibility
fc281cf fix: dual open ticket sync loss and capture threshold mismatch (#23)
a656c06 Weighing modes: single/dual (stage 1) (#13)
```

Основной коммит этапа (`3b2b3f8`): 14 файлов, +1282 / −45 — домен resolve/learning, storage, UI формы/журнала/настроек, SQLite `vehicle_drivers` + audit stubs, тесты, `docs/api.md`.

Fix после ревью (`96e95fc`): 3 файла — инвалидация словарей после learning и прямое чтение storage в resolve.
