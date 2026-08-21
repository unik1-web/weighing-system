# История изменений: ec02d9-weighing-hide-com-device

## Описание задачи

Источник: `docs/tasks/14-weighing-hide-com-device.md`

Цель: на экране взвешивания убрать выбор модели прибора и COM-порта; оставить подключение/вес/фиксацию; модель и COM настраивать только в Настройках площадки/весов.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR-1…FR-6 — убрать модель и COM с `ScalePanel`/`WeighingForm`; Connect только из `getActiveScaleContext`; выбор модели/транспорта/COM — в Settings; закрыть пробел UI для spare serial (COM + pollCommand). API/БД не менять.

### [Архитектура] Execution 2
- Статус: done
- Результат: frontend-only; упрощение Props `ScalePanel`; Connect без `upsertScale`/merge path; `WeighingForm` сохраняет `deviceId` для `scale_device`; Settings spare — зеркальные COM + pollCommand; runtime/`useScale` API без изменений.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `src/components/ScalePanel.tsx`
  - `src/components/WeighingForm.tsx`
  - `src/components/SettingsView.tsx`
- Проверки: `npm run typecheck` OK; `npm test` — 153 passed.

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: критерии готовности выполнены; два некритичных замечания (устаревание `canConnect` при том же `transport`; `ioHint` с «COM3»). Возвратов на development нет.

### [Тестирование] Execution 5
- Статус: done
- Результат: typecheck OK; Vitest 19 files / 153 tests passed; FR-1…FR-6 покрыты статическим обзором + регрессией suite; предложены (не записаны на диск) доп. кейсы spare serial в `scales-session-context.test.ts`.

### [Документация] Execution 6
- Статус: done
- Результат: созданы `docs/ec02d9-weighing-hide-com-device/{architecture,changelog,issues}.md`.

## Git история

```
646426c feat(weighing): hide model/COM on ScalePanel, spare serial in Settings
79d5296 fix(scales): poll Microsim for weight and parse 0x81 copy frames
5a14fac fix(scales): COM port picker and serial data parsing
c1f0570 fix(scales,cameras): normalize COM port names and validate JPEG snapshots
54bf91a feat(scales): implement backend serial COM transport
```

Коммит реализации задачи: `646426c` — 3 файла (`ScalePanel.tsx`, `SettingsView.tsx`, `WeighingForm.tsx`), +100 / −69 строк.
