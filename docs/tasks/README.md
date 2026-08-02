# Постановки задач для оркестратора

Постановки по этапам [docs/roadmap.md](../roadmap.md). Один файл — один запуск Cursor Agent Orchestrator.

Контекст продукта: [docs/project-for-agents.md](../project-for-agents.md).  
Запуск: [docs/orchestrator.md](../orchestrator.md).

## Точка продолжения

| Что | Значение |
|-----|----------|
| Последний **влитый** этап (base) | **01** — [PR #13](https://github.com/unik1-web/weighing-system/pull/13) (+ [PR #23](https://github.com/unik1-web/weighing-system/pull/23)) |
| На этой ветке оркестратора | **07** выполнен: задача `37cc69-photo-capture` (см. [docs/37cc69-photo-capture/](../37cc69-photo-capture/)); ранее **06**…**02** |
| **Следующий прогон** | [08-anpr.md](08-anpr.md) |
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
| 08 | [08-anpr.md](08-anpr.md) | 8. ANPR | 07 + `anpr_mode` из 04 | Порог релиза ≥ 50% |
| 09 | [09-audit-reports-security.md](09-audit-reports-security.md) | 9. Аудит / отчёты / пароли | 01–08 по факту | Финальный контур |

```text
01 → 02 → 03 → 04 ──┐
                 05 │  (параллельно после 04)
                 06 │  (параллельно с 04–05)
                    └─→ 07 → 08 → 09
```

Этапы **01–03 и 06** — рабочий контур **без камер** (базовая сборка).  
Этапы **04–05** — железо и протоколы.  
Этапы **07–08** — полная сборка после камер и спайка ANPR.

## Как запускать следующий этап

1. Дашборд (опционально): `npm run orchestrator:dashboard`
2. В чате Cursor:

```text
/orchestrator создай задачу на доске по docs/tasks/08-anpr.md и начни выполнять
```

Прогресс: `memory/TaskBoard.md`, `memory/TASK_MEMORY_*.yml`, UI на `http://127.0.0.1:5174`.
