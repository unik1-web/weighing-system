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

State: done
Description: |
  Источник: docs/tasks/06-yearly-db-archive.md

  Цель: годовые файлы SQLite BD/weighing-ГГГГ.db; активный год в config.ini;
  ротация года (закрытие забытых open с auto_closed, перенос справочников/
  пользователей/vehicle_drivers/настроек, НЕ журнала; бэкап; нумерация с 1);
  архивный просмотр/перепечатка; admin-правка с audit/revisions и
  предупреждением при reo_status=sent.

  Завершено: 2026-08-02T02:29:14Z. Артефакты: docs/3aa7f0-yearly-db-archive/.

---

## 37cc69-photo-capture

State: done
Description: |
  Источник: docs/tasks/07-photo-capture.md

  Цель: фотофиксация IP/RTSP (полная сборка): video_enabled, реестр 1–4
  камер (role entry|exit|overview), снимок при фиксации брутто/тары,
  файлы на диске (Photo/ или BD/photos), метаданные ticket_photos,
  превью в форме и журнале; graceful degrade без блокировки взвешивания;
  эталоны primary/spare для wizard; базовая сборка без тяжёлых deps.

  Завершено: 2026-08-02T03:02:58Z. Артефакты: docs/37cc69-photo-capture/.

---

## cb0fb4-anpr

State: done
Description: |
  Источник: docs/tasks/08-anpr.md

  Цель: локальное ANPR с кадра overview → номер + confidence →
  подтверждение/правка оператором → plate_source / anpr_* в тикете →
  resolveVehicle; на spare движок не вызывается (disabled_by_configuration);
  порог релиза ≥ 50% на спайке объекта; при выкл./ниже порога ручной ввод
  без деградации. Зависимости: этапы 3, 4, 7.

  Завершено: 2026-08-02T17:55:33Z. Артефакты: docs/cb0fb4-anpr/.

---

## abd91a-audit-reports-security

State: done
Description: |
  Источник: docs/tasks/09-audit-reports-security.md

  Цель: режим площадки в шапке формы (primary/spare, ANPR, камеры);
  журнал переключений комплекта; полный ticket_audit/revisions;
  расширенные фильтры/CSV/карточка (площадка, весы, источники веса,
  фото, ANPR, режим, оператор); актуальные docs/* и README;
  серверный hash паролей и принудительная смена дефолтного admin.
  Зависимости: этапы 1–8 по факту.

  Завершено: 2026-08-03T03:59:36Z. Артефакты: docs/abd91a-audit-reports-security/.

---

## 875cc5-photo-proveska-settings

State: done
Description: |
  Источник: docs/tasks/10-photo-proveska-settings.md

  Цель: устранить «Фото недоступно» после взвешивания при рабочих
  камерах; превью фото в просмотре провески по числу камер;
  в UI заменить «тикет» на «провеска»; README — настройка камер и кнопки;
  настройки разнести по вкладкам, открываемым по выбору.
  Зависимости: этап 7 (+ UI камер).

  Завершено: 2026-08-03T07:38:57Z. Артефакты: docs/875cc5-photo-proveska-settings/.

---

## aee213-camera-discovery

State: new
Description: |
  Источник: docs/tasks/11-camera-discovery.md

  Цель: во вкладке настроек «Камеры и фото» добавить подраздел
  «Поиск камеры» — IP, наименование (бренд) из выпадающего списка,
  логин, пароль, окно превью; подбор рабочего HTTP/RTSP URL по
  каталогу шаблонов; при неизвестном бренде — перебор с прогрессом
  и отменой; найденный URL применить к камере реестра.
  Зависимости: этап 7 (захват) + этап 10 (вкладки настроек).

---
