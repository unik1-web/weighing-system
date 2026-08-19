# История изменений: 82cfbc-site-primary-spare

## Описание задачи

Источник: `docs/tasks/04-site-primary-spare.md`

Цель: модель площадки с комплектами основные/резервные весы; runtime активного комплекта; журналируемое переключение (причина, оператор, время); новые талоны пишут `site_id`/`scale_id`/`scale_role`; на spare `anpr_mode=disabled_by_configuration`; wizard/чеклист на резерв без блокировки взвешивания до камер; миграция текущего Web Serial → primary.

Зависимости: этапы 1–3. Вне скоупа: полные адаптеры (5), фото/ANPR (7–8), годовая ротация (6).

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: зафиксированы FR1–FR9 и NFR1–NFR8. Сущности Site/Scale/site_runtime, миграция primary из `scale_device_id`, журналируемое переключение primary↔spare с wizard, запись комплекта в новые талоны, `anpr_mode=disabled_by_configuration` на spare. Критических открытых вопросов нет; предпочтение SQL+sync по аналогии с `vehicle_drivers`.

### [Архитектура] Execution 2
- Статус: done
- Результат: SQL-таблицы `sites`/`scales`/`site_runtime`/`site_scale_switches` ↔ `app_*` ключи; доменный модуль `site-runtime.ts`; enums camera/anpr/switch_reason; идемпотентная миграция с disabled spare-placeholder; без новых HTTP-путей. Возврат в analysis не требуется.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `src/lib/site-runtime.ts` (NEW)
  - `src/lib/__tests__/site-runtime.test.ts` (NEW)
  - `src/lib/storage.ts` (EDIT)
  - `src/lib/__tests__/storage-weighing.test.ts` (EDIT)
  - `src/components/SpareSwitchWizard.tsx` (NEW)
  - `src/components/SettingsView.tsx` (EDIT)
  - `src/components/WeighingForm.tsx` (EDIT)
  - `src/hooks/useAuth.tsx` (EDIT)
  - `server/sqlite_store.py` (EDIT)
  - `server/tests/test_site_scales_roundtrip.py` (NEW)
  - `docs/api.md` (EDIT)
- Проверки: typecheck OK; Vitest 88 passed; pytest (вкл. roundtrip).

### [Код-ревью] Execution 4
- Статус: done (Request Changes)
- Результат: критических нет; серьёзная проблема — disable spare при `active_scale_set=spare` → split-brain (UI «Резервные», тикеты primary). Возврат в development.

### [Разработка] Execution 5
- Статус: done
- Реализованные файлы:
  - `src/lib/site-runtime.ts` — `disableSpareScale()`, warn+self-heal в `getActiveScaleContext`
  - `src/components/SettingsView.tsx` — save через `disableSpareScale`, UI-блок галочки
  - `src/lib/__tests__/site-runtime.test.ts` — 3 новых теста
- Проверки: typecheck OK; site-runtime + storage-weighing 28 passed.

### [Код-ревью] Execution 6
- Статус: done (Approve)
- Результат: фикс CR#4 закрыт; выбран запрет (не скрытый switch); silent fallback убран. Передача в testing.

### [Тестирование] Execution 7
- Статус: done
- Результат: typecheck OK; Vitest 91 passed (0 failed); pytest 62 passed. Покрытие FR1–FR9 / NFR4 и фикса disable-spare подтверждено. Опциональные доп. тесты предложены текстом (на диск не писались). Передача в tech-writer.

### [Документация] Execution 8
- Статус: done
- Результат: созданы `architecture.md`, `changelog.md`, `issues.md` в `docs/82cfbc-site-primary-spare/`.

## Git история

Коммиты по файлам реализации этапа 4:

```
2b87538 fix(site): forbid disabling spare while active on spare
51bf122 feat(site): primary/spare scale sets and logged switching
```

`51bf122` — основная реализация (+2174/−18 по 12 файлам).  
`2b87538` — фикс disable-spare-while-on-spare (`site-runtime.ts`, `SettingsView.tsx`, тесты).
