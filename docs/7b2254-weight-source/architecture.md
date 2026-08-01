# Архитектура: 7b2254-weight-source

## Обзор

Этап 2 roadmap: расширение источника веса (`WeightSource`) до четырёх литералов — `instrument`, `manual`, `dictionary`, `default`. Доменная логика вынесена в модуль `src/lib/weight-source.ts`. Исправлены классификация автоподстановки тары и анти-эффект повторной подстановки после правки оператора. Добавлены бейджи на форме, фильтр в журнале и UI-сводка в отчётах. Печатные формы, РЭО, импорты и HTTP API `/api/*` не менялись; DDL SQLite не расширялся.

## Компоненты

| Компонент | Назначение |
|-----------|------------|
| `src/lib/weight-source.ts` | Тип, константы, нормализация, resolve автотары, фильтр OR, счётчики отчётов |
| `src/lib/storage.ts` | Реэкспорт `WeightSource`; soft-read `gross_source`/`tare_source` в `normalizeTicket` |
| `src/components/WeighingForm.tsx` | Автотара `dictionary`/`default`; `tareAutofillBlocked`; бейджи при `weight != null` |
| `src/components/WeighingJournal.tsx` | Мультивыбор фильтра по источнику (OR); компактные метки Б/Т в строке |
| `src/components/ReportsView.tsx` | Блок «Источники веса» (gross/tare/total); CSV группировок без изменений |
| `src/components/MultiSelectDropdown.tsx` | Переиспользован для фильтра журнала |
| `server/tests/test_database_weighing_mode_roundtrip.py` | Smoke round-trip литералов `dictionary`/`default` |
| Импорты / PrintAct / РЭО / DDL | Вне скоупа изменений |

### Зависимости

```
WeighingForm ──► weight-source (resolve + labels)
WeighingJournal ──► weight-source (filter + labels) + storage
ReportsView ──► weight-source (count) + storage
TicketStorage.normalizeTicket ──► weight-source.normalizeWeightSource
```

## Структура файлов

```
src/lib/weight-source.ts                    # NEW — домен источников
src/lib/__tests__/weight-source.test.ts     # NEW — unit-тесты
src/lib/storage.ts                          # EDIT — тип + normalizeTicket
src/components/WeighingForm.tsx             # EDIT — autofill, anti-effect, badges
src/components/WeighingJournal.tsx          # EDIT — фильтр + индикация
src/components/ReportsView.tsx              # EDIT — UI-сводка
server/tests/test_database_weighing_mode_roundtrip.py  # EDIT — smoke round-trip
```

Без изменений (регрессии): `PrintAct.tsx`, импорты Vescom/Metra/WA, `reo.ts`, DDL `server/sqlite_store.py`, `dashboard/`, установщик.

## Модели данных

### WeightSource

```ts
export type WeightSource = 'instrument' | 'manual' | 'dictionary' | 'default';

export const WEIGHT_SOURCE_LABELS: Record<WeightSource, string> = {
  instrument: 'Прибор',
  manual: 'Вручную',
  dictionary: 'Справочник',
  default: 'По умолчанию',
};
```

| Значение | Смысл | Где выставляется в UI |
|----------|--------|------------------------|
| `instrument` | Фиксация с терминала весов | Брутто / тара |
| `manual` | Ввод/правка оператором | Брутто / тара |
| `dictionary` | Автотара из `vehicle.default_tare_weight` | Только тара (single) |
| `default` | Автотара из `tara_default` | Только тара (single) |

### Нормализация и миграция

- `normalizeWeightSource`: известный литерал → как есть; `null` / пусто / неизвестное → `manual`.
- Массовой переклассификации истории нет: старые `manual`/`instrument` сохраняются; автотара этапа 1, записанная как `manual`, остаётся `manual`.
- SQLite: колонки `gross_source` / `tare_source` — `TEXT NOT NULL DEFAULT 'manual'`, CHECK enum не добавлялся.

### Автоподстановка тары

`resolveTareAutofill` (после guard `shouldAutofillTare` и `!tareAutofillBlocked`):

1. `default_tare_weight != null` → `{ tare_source: 'dictionary' }`
2. иначе `tara_default > 0` → `{ tare_source: 'default' }`
3. иначе `null`

Флаг `tareAutofillBlocked` (`useRef` в форме): после явного действия оператора над тарой блокирует повторную автоподстановку до смены ТС / режима / reset / загрузки completion.

## API / Интерфейсы

### HTTP API

Новых эндпоинтов нет. Контракты `docs/api.md` сохранены; в JSON тикетов допустимы литералы `dictionary` / `default` в `gross_source` / `tare_source`.

### Публичные функции модуля `weight-source.ts`

- `normalizeWeightSource(raw)` / `isWeightSource(raw)`
- `resolveTareAutofill({ defaultTareWeight, taraDefault })`
- `ticketMatchesWeightSources(ticket, selected)` — OR по полям; пустой `selected` → без ограничения
- `countWeightSources(tickets)` — счётчики только по non-null весам, раздельно gross/tare

### UI-контракты

- **Форма**: бейдж только при `weight != null`; подписи из `WEIGHT_SOURCE_LABELS`.
- **Журнал**: `sourceFilter: WeightSource[]` + MultiSelect; в строке компактные метки «Б: … / Т: …» (пустой вес → «—»).
- **Отчёты**: таблица 4 источника × Брутто / Тара / Всего; `exportCSV` группировок не расширен.
- **Печать**: источник веса не выводится.

## Стек технологий

Без изменений: React 18 + TypeScript + Vite + Tailwind; Python 3.11/3.12 + Flask; SQLite. Новых npm/pip зависимостей нет.

## Решения и обоснования

1. **Доменный модуль** — unit-тесты без React; единая точка для normalize/filter/count/labels.
2. **Forward-fix + soft-read** — эвристическая переклассификация истории недостоверна (справочник/`tara_default` могли измениться).
3. **`tareAutofillBlocked` через `useRef`** — UI от флага напрямую не зависит; эффект читает `.current`.
4. **Сводка источников только в UI** — без регрессии существующего CSV.
5. **Бейдж скрыт при `weight == null`** — пустой dual-слот с заглушкой `manual` не показывает «Вручную».
6. **Backend DDL не трогать** — TEXT уже принимает новые литералы; опциональный smoke round-trip добавлен.
