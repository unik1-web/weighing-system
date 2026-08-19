# Реестр проблем: 13e79e-vehicle-resolve

## Итог

Задача завершена. Зафиксировано проблем, блокировавших пайплайн: **1** (возврат code-review → development). Цепочка: analysis → architect → development → code-review (Request Changes) → development (fix) → code-review (Approve) → testing (pass) → tech-writer.

## Проблемы в процессе разработки

### ISSUE-1: Stale prefs после learning (FR6)

- **Этап**: code-review → development
- **Описание**: `applyVehicleLearningOnComplete` писал `preferred_*` / `default_tare_weight` в `DictionaryStorage`, но не диспатчил `DICTIONARIES_UPDATED_EVENT`. `WeighingForm.runVehicleResolve` передавал в `resolveVehicle` `vehicles.entries` из `useDictionary`, который обновляется только по событию (или reload). После complete в той же сессии prefs в React-state оставались старыми; т.к. prefs приоритетнее last completed (FR2), следующий ввод того же номера подставлял устаревшие driver/cargo/shipper/tare. История `vehicle_drivers` читалась напрямую и была свежей — баг только в цепочке prefs vehicles.
- **Решение**: (1) в конце успешного learning — `window.dispatchEvent(new Event(DICTIONARIES_UPDATED_EVENT))`; (2) в `runVehicleResolve` — `DictionaryStorage.getTable('vehicles'|'drivers')` напрямую. Оба варианта применены в execution 5; Approve в execution 6.
- **Execution**: #4 (выявлено), #5 (исправлено), #6 (подтверждено)

## Замечания код-ревью

### ISSUE-2: Смена `driver_input_mode` не пересчитывает candidates

- **Этап**: code-review → сведения (не блокер)
- **Описание**: при уже введённом номере смена режима ввода водителя в настройках не пересчитывает `driver_candidates`, пока не изменится plate / entries.
- **Решение**: оставлено as-is (UX-мелочь); вне scope fix execution 5.
- **Execution**: #4, #6

### ISSUE-3: UI preferred_* в DictionaryManager не сделан

- **Этап**: code-review → сведения (не блокер)
- **Описание**: показ/правка preferred_* в справочнике автомобилей опционален по архитектуре; prefs пишутся на complete через learning.
- **Решение**: принято; follow-up вне этапа 3.
- **Execution**: #4, #6

## Проблемы тестирования

Возвратов testing → development не было. Все прогоны зелёные:

- `npm run typecheck` — OK
- `npm test` — 77 passed (узкий этап 3: 36 passed)
- `npm run test:server` / pytest — 60 passed

### ISSUE-4: Нет component-тестов UI формы/журнала/настроек

- **Этап**: testing → сведения
- **Описание**: поведение WeighingForm / Journal / Settings подтверждено unit-слоем (`vehicle-resolve`, `weight-source`, `storage-weighing`) + code-review Approve; отдельных component-тестов нет. Тестировщик предложил доп. edge-кейсы (независимый fallback полей; learning на open→completed), на диск не записывал.
- **Решение**: принято для этапа; доп. тесты — опционально на будущее.
- **Execution**: #7
