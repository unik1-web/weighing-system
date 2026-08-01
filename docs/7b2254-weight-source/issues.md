# Реестр проблем: 7b2254-weight-source

## Итог

Задача завершена. Задача прошла все этапы без возвратов. Зафиксировано проблем, блокировавших пайплайн: 0. Ниже — некритичные замечания ревью и пробелы покрытия тестами (не требовали возврата на development).

## Проблемы в процессе разработки

Возвратов analysis ↔ architect ↔ development ↔ code-review ↔ testing не было. Цепочка прошла линейно: analysis → architect → development → code-review (Approve) → testing (pass) → tech-writer.

## Замечания код-ревью

### ISSUE-1: Фильтр журнала по source без учёта пустого веса

- **Этап**: code-review → сведения (не блокер)
- **Описание**: `ticketMatchesWeightSources` смотрит только поля source (как в architecture). У open dual с заглушкой `tare_source='manual'` и `tare_weight=null` фильтр «Вручную» может захватить тикет по пустому слоту. UI-бейджи и отчёты вес уже учитывают.
- **Решение**: оставлено as designed; при желании позже ужесточить фильтр (`source` + `weight != null`).
- **Execution**: #4

### ISSUE-2: Смена ТС при заполненной таре не пересчитывает autofill

- **Этап**: code-review → сведения (не блокер)
- **Описание**: при смене номера ТС, если тара уже заполнена, guard `tareWeight != null` не даёт пересчитать автоподстановку. Сброс `tareAutofillBlocked` при смене номера работает.
- **Решение**: соответствует as-is / architecture; поведение сохранено намеренно.
- **Execution**: #4

## Проблемы тестирования

Возвратов testing → development не было. Все прогоны зелёные:

- `npm test` — 61 passed
- `npm run typecheck` — OK
- `npm run test:server` — 57 passed

### ISSUE-3: Нет unit на анти-эффект autofill в React

- **Этап**: testing → сведения
- **Описание**: анти-эффект после очистки тары покрыт логикой в `WeighingForm` (`tareAutofillBlocked` + guards); отдельного компонентного теста нет. Тестировщик предложил сценарий и доп. edge-кейсы для `weight-source.test.ts` / `storage-weighing.test.ts`, но на диск не записывал — приёмка этапа по зелёному suite + ревью кода.
- **Решение**: принято для этапа; доп. тесты — опционально на будущее.
- **Execution**: #5
