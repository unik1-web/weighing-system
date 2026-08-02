# История изменений: 20e99b-scale-adapters

## Описание задачи

Источник: `docs/tasks/05-scale-adapters.md`

Цель: pluggable ScaleAdapter (connect/read/subscribe); 4 профиля (Микросим, Ньютон, CAS, Мидл) как адаптеры; адаптер произвольного разбора (regex/маска); параметры в scales.connection; сохранить Web Serial; backend I/O (pyserial/TCP) и `/api/scales/*` для primary+spare и exe; ручной ввод с опциональной/обязательной причиной (`manual_weight_reason`).

Зависимости: этап 4 (активный комплект), этапы 1–2 (WeightSource). Вне скоупа: камеры, ANPR, ротация, этап 9.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: зафиксированы FR1–FR9 и NFR1–NFR7. Интерфейс ScaleAdapter; 4 встроенных профиля + `custom`; источник параметров — `Scale.connection` активного комплекта; Web Serial обязателен; backend MVP — контракт `/api/scales/*` + один транспорт; `manual_weight_reason` с mode default `optional`. Критических блокирующих вопросов нет.

### [Архитектура] Execution 2
- Статус: done
- Результат: разделение Adapter/Transport/Session; первый backend-транспорт TCP (stdlib); serial — stub 501; модель connection с transport + parseRegex/parseMask; soft-миграция; API `/api/scales/*`; валидация причины; файловая структура `src/lib/scales/` + `server/scale_io.py`. Возврат в analysis не требуется.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `src/lib/scales/types.ts`, `parse.ts`, `registry.ts`, `session.ts`, `index.ts`
  - `src/lib/scales/adapters/builtins.ts`, `adapters/custom.ts`
  - `src/lib/scales/web-serial-transport.ts`, `backend-client.ts`
  - `src/lib/scales.ts` (thin re-export)
  - `src/lib/manual-weight-reason.ts`
  - `src/lib/storage.ts`, `src/lib/site-runtime.ts`
  - `src/hooks/useScale.ts`
  - `src/components/ScalePanel.tsx`, `SettingsView.tsx`, `WeighingForm.tsx`
  - `server/scale_io.py`, `server/app.py`, `server/sqlite_store.py`
  - `docs/api.md`
  - тесты: `scales-parse`, `scales-session-context`, `manual-weight-reason`, `test_scales_api_tcp`, `test_manual_weight_reason_roundtrip`
- Проверки: typecheck OK; Vitest 113 passed; pytest 68 passed.

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: сверка с architecture — соответствует. Критических и серьёзных проблем нет. Некритичные замечания: cleanup adapterId при ошибке Web Serial open; у spare нет полного UI framing; поле причины видно при source===manual даже с пустыми весами. Передача в testing.

### [Тестирование] Execution 5
- Статус: done
- Результат: typecheck OK; Vitest 113 passed (0 failed); pytest 68 passed (0 failed). Покрытие FR1–FR9 / NFR4 подтверждено (UI E2E вне suite — для MVP достаточно unit/API). Опциональные доп. тесты предложены текстом (на диск не писались). Передача в tech-writer.

### [Документация] Execution 6
- Статус: done
- Результат: созданы `architecture.md`, `changelog.md`, `issues.md` в `docs/20e99b-scale-adapters/`.

## Git история

Коммиты по файлам реализации этапа 5:

```
dec0391 feat(scales): pluggable adapters, TCP API, and manual weight reason
```

`dec0391` — основная реализация (+2614/−298 по 26 файлам): каталог `src/lib/scales/`, `server/scale_io.py`, UI/settings/form, `/api/scales/*`, колонка `manual_weight_reason`, тесты и обновление `docs/api.md`.
