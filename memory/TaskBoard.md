# TaskBoard

Доска активных задач Cursor Agent Orchestrator для weighing-system.

Формат: [orchestrator-protocol.md](../orchestrator-protocol.md).

Постановки: [docs/tasks/](../docs/tasks/). Очередь: [docs/tasks/README.md](../docs/tasks/README.md).

---

## 7b2254-weight-source

State: done
Description: |
  Источник: docs/tasks/02-weight-source.md

  Цель: расширить WeightSource до instrument/manual/dictionary/default;
  исправить запись автотары как manual; бейджи на форме; фильтр в журнале;
  сводка в отчётах; печатные формы не менять.

  Завершено: 2026-08-01T19:47:11Z. Артефакты: docs/7b2254-weight-source/.

---

## 13e79e-vehicle-resolve

State: code-review
Description: |
  Источник: docs/tasks/03-vehicle-resolve.md

  Цель: при выборе/вводе госномера заполнять реквизиты рейса за 1–2 действия
  (марка, тара, ФИО, груз, грузоотправитель) на основе предпочтений ТС,
  последнего рейса и истории водителей; настроить driver_input_mode
  (vehicle|all|free); сущность vehicle_drivers; nullable audit-поля
  (plate_source, scale_role, фото); показ источника веса/устройства/оператора
  в карточке и CSV; сохранение модели весов в config.ini.

  Зависимости: этапы 1–2. Артефакты: docs/implementation/.
  Вне скоупа: primary/spare, камеры, ANPR, годовая ротация БД, полный UI архива.

---
