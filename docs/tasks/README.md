# Постановки задач для оркестратора

Постановки по этапам [docs/roadmap.md](../roadmap.md). Один файл — один запуск Cursor Agent Orchestrator.

Контекст продукта: [docs/project-for-agents.md](../project-for-agents.md).  
Запуск: [docs/orchestrator.md](../orchestrator.md).

## Точка продолжения

| Что | Значение |
|-----|----------|
| Последний **влитый** этап (base) | **01** — [PR #13](https://github.com/unik1-web/weighing-system/pull/13) (+ [PR #23](https://github.com/unik1-web/weighing-system/pull/23)) |
| На этой ветке оркестратора | **10** выполнен: задача `875cc5-photo-proveska-settings`; ранее **09**…**02**; UI-фиксы камер/шапки/таймаутов по отдельным PR |
| **Следующий прогон** | **11** — [11-camera-discovery.md](11-camera-discovery.md) (поиск камеры по IP/бренду/учётке) |
| Не брать как базу | Открытые PR #15–#21 (старый CLI-стек 2–7, не влиты) |

## Очередь

| # | Файл | Этап roadmap | Зависимости | Примечание |
|---|------|--------------|-------------|------------|
| 01 | [01-weighing-modes.md](01-weighing-modes.md) | 1. Режимы single/dual | — | **Сделано** (PR #13; [weighing-modes-deploy.md](../weighing-modes-deploy.md)) |
| 02 | [02-weight-source.md](02-weight-source.md) | 2. Источник веса | 01 | **Сделано на ветке** (`7b2254-weight-source`) |
| 03 | [03-vehicle-resolve.md](03-vehicle-resolve.md) | 3. Автоподстановка + водители | 01–02 | **Сделано на ветке** (`13e79e-vehicle-resolve`) |
| 04 | [04-site-primary-spare.md](04-site-primary-spare.md) | 4. Площадка primary/spare | 01–03 | **Сделано на ветке** (`82cfbc-site-primary-spare`) |
| 05 | [05-scale-adapters.md](05-scale-adapters.md) | 5. Адаптеры терминалов | 04 | **Сделано на ветке** (`20e99b-scale-adapters`) |
| 06 | [06-yearly-db-archive.md](06-yearly-db-archive.md) | 6. Годовая БД / архив | 01–03 | **Сделано на ветке** (`3aa7f0-yearly-db-archive`) |
| 07 | [07-photo-capture.md](07-photo-capture.md) | 7. Фотофиксация | 04 (+05) | **Сделано на ветке** (`37cc69-photo-capture`) |
| 08 | [08-anpr.md](08-anpr.md) | 8. ANPR | 07 + `anpr_mode` из 04 | **Сделано на ветке** (`cb0fb4-anpr`); порог релиза ≥ 50% |
| 09 | [09-audit-reports-security.md](09-audit-reports-security.md) | 9. Аудит / отчёты / пароли | 01–08 по факту | **Сделано на ветке** (`abd91a-audit-reports-security`) |
| 10 | [10-photo-proveska-settings.md](10-photo-proveska-settings.md) | 10. Фото / провеска / настройки | 07 (+ UI камер) | **Сделано на ветке** (`875cc5-photo-proveska-settings`) |
| 11 | [11-camera-discovery.md](11-camera-discovery.md) | 11. Поиск камеры (IP/бренд/учётка) | 07 + 10 (вкладка камер) | **К прогону** |

```text
01 → 02 → 03 → 04 ──┐
                 05 │  (параллельно после 04)
                 06 │  (параллельно с 04–05)
                    └─→ 07 → 08 → 09 → 10 → 11
```

Этапы **01–03 и 06** — рабочий контур **без камер** (базовая сборка).  
Этапы **04–05** — железо и протоколы.  
Этапы **07–08** — полная сборка после камер и спайка ANPR.  
Этап **09** — аудит, отчёты/фильтры, docs, серверные пароли.  
Этап **10** — надёжность фото, термин «провеска», README по камерам, вкладки настроек (**выполнен**).  
Этап **11** — поиск камеры по IP/бренду/логину/паролю внутри «Камеры и фото».

## Как запускать следующий этап

Очередь **01–10** закрыта; следующий — **11**:

1. Постановка: `docs/tasks/11-camera-discovery.md` (уже на доске как `aee213-camera-discovery`, либо создать заново).
2. Дашборд (опционально): `npm run orchestrator:dashboard`
3. В чате Cursor:

```text
/orchestrator создай задачу на доске по docs/tasks/11-camera-discovery.md и начни выполнять
```

Прогресс: `memory/TaskBoard.md`, `memory/TASK_MEMORY_*.yml`, UI на `http://127.0.0.1:5174`.
