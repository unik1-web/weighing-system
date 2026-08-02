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

State: done
Description: |
  Источник: docs/tasks/03-vehicle-resolve.md

  Цель: при выборе/вводе госномера заполнять реквизиты рейса за 1–2 действия
  (марка, тара, ФИО, груз, грузоотправитель) на основе предпочтений ТС,
  последнего рейса и истории водителей; настроить driver_input_mode
  (vehicle|all|free); сущность vehicle_drivers; nullable audit-поля
  (plate_source, scale_role, фото); показ источника веса/устройства/оператора
  в карточке и CSV; сохранение модели весов в config.ini.

  Завершено: 2026-08-01T20:25:13Z. Артефакты: docs/13e79e-vehicle-resolve/.

---

## 82cfbc-site-primary-spare

State: done
Description: |
  Источник: docs/tasks/04-site-primary-spare.md

  Цель: модель площадки с комплектами основные/резервные весы; runtime
  активного комплекта; журналируемое переключение (причина, оператор, время);
  новые талоны пишут site_id/scale_id/scale_role; на spare anpr_mode=
  disabled_by_configuration; wizard/чеклист на резерв без блокировки
  взвешивания до камер; миграция текущего Web Serial → primary.

  Завершено: 2026-08-01T20:52:59Z. Артефакты: docs/82cfbc-site-primary-spare/.

---

## 20e99b-scale-adapters

State: done
Description: |
  Источник: docs/tasks/05-scale-adapters.md

  Цель: pluggable ScaleAdapter (connect/read/subscribe); 4 профиля
  (Микросим, Ньютон, CAS, Мидл) как адаптеры; адаптер произвольного
  разбора (regex/маска); параметры в scales.connection; сохранить Web Serial;
  backend I/O (pyserial/TCP) и /api/scales/* для primary+spare и exe;
  ручной ввод с опциональной/обязательной причиной (manual_weight_reason).

  Завершено: 2026-08-02T01:53:04Z. Артефакты: docs/20e99b-scale-adapters/.

---

## 3aa7f0-yearly-db-archive

State: code-review
Description: |
  Источник: docs/tasks/06-yearly-db-archive.md

  Цель: годовые файлы SQLite BD/weighing-ГГГГ.db; активный год в config.ini;
  ротация года (закрытие забытых open с auto_closed, перенос справочников/
  пользователей/vehicle_drivers/настроек, НЕ журнала; бэкап; нумерация с 1);
  архивный просмотр/перепечатка; admin-правка с audit/revisions и
  предупреждением при reo_status=sent.

  Зависимости: этапы 1–3; параллельно с 4–5. Артефакты: docs/implementation/.
  Не коммитить BD/, бэкапы, секреты.

---
