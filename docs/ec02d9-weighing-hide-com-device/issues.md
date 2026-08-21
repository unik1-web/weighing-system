# Реестр проблем: ec02d9-weighing-hide-com-device

## Итог

Задача завершена. Зафиксировано проблем: 0 (возвратов по FSM не было).

Задача прошла все этапы без возвратов.

## Проблемы в процессе разработки

Нет. Executions analysis → architect → development → code-review → testing → tech-writer завершились со `status: done` без возвратов на предыдущие этапы.

## Замечания код-ревью

Некритичные замечания из Execution 4 (Approve, без возврата):

1. **`ScalePanel` и обновление `canConnect`** — в state хранится только `transport`; при `SITE_RUNTIME_UPDATED_EVENT` с тем же transport React может не перерисовать, и `canConnect` (по `serialPath`) теоретически устареет до remount. В текущем UX смена комплекта/COM идёт с вкладки Настройки (`WeighingForm` размонтируется) — на практике не бьёт. Опционально: счётчик epoch на событии.
2. **`ioHint` упоминает «COM3»** — осознанно оставлено по архитектуре (некритично по analysis).

## Проблемы тестирования

Нет. `npm run typecheck` — exit 0; `npm test` — 153 passed, 0 failed. Возвратов testing → development не было.

Предложенные тестировщиком unit-кейсы для spare serial / empty path в `scales-session-context.test.ts` на диск не записывались (по протоколу testing) — backlog для отдельной доработки при необходимости.
