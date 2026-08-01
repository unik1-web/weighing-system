# История изменений: 7b2254-weight-source

## Описание задачи

Источник: `docs/tasks/02-weight-source.md`.

Цель: расширить `WeightSource` до `instrument` / `manual` / `dictionary` / `default`; исправить запись автотары как `manual`; бейджи на форме; фильтр в журнале; сводка в отчётах; печатные формы не менять.

Зависимости: этап 1 (single/dual) уже влит (PR #13 + #23).

Критерии: корректные `gross_source`/`tare_source` на новых тикетах; `dictionary`/`default` для автотары; правка оператором не откатывается эффектом; бейджи; фильтр журнала; сводка отчётов; печать без источника; тесты.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: ФТ на 4 литерала WeightSource; автотара dictionary/default только для тары в single; анти-эффект после правки оператора; бейджи; фильтр журнала (OR); UI-сводка отчётов; печать/РЭО/импорты без изменений; миграция только soft-read без массовой переклассификации; unit/регрессии для приёмки.

### [Архитектура] Execution 2
- Статус: done
- Результат: модуль `weight-source.ts`; soft-read + forward-fix; `tareAutofillBlocked`; бейджи при `weight != null`; фильтр MultiSelect; сводка только UI; список файлов для development; тесты normalize/resolve/filter/count + опциональный server smoke.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `src/lib/weight-source.ts` (NEW)
  - `src/lib/__tests__/weight-source.test.ts` (NEW)
  - `src/lib/storage.ts`
  - `src/components/WeighingForm.tsx`
  - `src/components/WeighingJournal.tsx`
  - `src/components/ReportsView.tsx`
  - `server/tests/test_database_weighing_mode_roundtrip.py`
- Проверки: typecheck OK; `npm test` 61 passed; `npm run test:server` 57 passed.

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: реализация соответствует архитектуре; PrintAct/импорты/DDL вне диффа. Некритичные замечания: фильтр по source без учёта `weight != null` для open dual; смена ТС при заполненной таре не пересчитывает autofill (as-is).

### [Тестирование] Execution 5
- Статус: done
- Результат: `npm test` — 61 passed (в т.ч. 10 weight-source); typecheck OK; `npm run test:server` — 57 passed. Покрыты normalize/resolve/filter/count и SQLite round-trip. Анти-эффект подтверждён ревью кода (компонентного unit нет). Предложены доп. кейсы для development (на диск не записывались).

### [Документация] Execution 6
- Статус: done
- Результат: созданы `docs/7b2254-weight-source/{architecture,changelog,issues}.md`.

## Git история

```
e8c7b36 feat: expand WeightSource with dictionary/default and UI visibility
fc281cf fix: dual open ticket sync loss and capture threshold mismatch (#23)
a656c06 Weighing modes: single/dual (stage 1) (#13)
bcbd371 Add WA («Весы Авто») SQL/Firebird database import. (#5)
81e54cb Fix Vescom import UI and add compact navigation tab mode.
```

Основной коммит этапа (`e8c7b36`): 7 файлов, +413 / −18 — доменный модуль, тесты, правки формы/журнала/отчётов, server smoke round-trip.
