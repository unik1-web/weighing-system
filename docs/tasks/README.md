# Постановки задач для мультиагентного пайплайна

Постановки по этапам [docs/roadmap.md](../roadmap.md). Один файл — один запуск оркестратора (`agents/01_orchestrator.md`).

Артефакты пайплайна пишутся в `docs/implementation/` (не коммитятся). Контекст проекта: [docs/project-for-agents.md](../project-for-agents.md).

## Очередь

| # | Файл | Этап roadmap | Зависимости | Примечание |
|---|------|--------------|-------------|------------|
| 01 | [01-weighing-modes.md](01-weighing-modes.md) | 1. Режимы single/dual | — | Реализовано (см. `docs/weighing-modes-deploy.md`) |
| 02 | [02-weight-source.md](02-weight-source.md) | 2. Источник веса | 01 | Реализовано |
| 03 | [03-vehicle-resolve.md](03-vehicle-resolve.md) | 3. Автоподстановка + водители | 01–02 | Реализовано |
| 04 | [04-site-primary-spare.md](04-site-primary-spare.md) | 4. Площадка primary/spare | 01–03 | Реализовано |
| 05 | [05-scale-adapters.md](05-scale-adapters.md) | 5. Адаптеры терминалов | 04 | Следующий приоритет (параллельно с 06) |
| 06 | [06-yearly-db-archive.md](06-yearly-db-archive.md) | 6. Годовая БД / архив | 01–03 | Можно параллельно с 04–05 |
| 07 | [07-photo-capture.md](07-photo-capture.md) | 7. Фотофиксация | 04 (+05) | Полная сборка |
| 08 | [08-anpr.md](08-anpr.md) | 8. ANPR | 07 + `anpr_mode` из 04 | Порог релиза ≥ 50% |
| 09 | [09-audit-reports-security.md](09-audit-reports-security.md) | 9. Аудит / отчёты / пароли | 01–08 по факту | Финальный контур |

```text
01 → 02 → 03 → 04 ──┐
                 05 │  (параллельно после 04)
                 06 │  (параллельно с 04–05)
                    └─→ 07 → 08 → 09
```

Этапы **01–03 и 06** дают рабочий контур **без камер** (базовая сборка).  
Этапы **04–05** готовят железо и протоколы.  
Этапы **07–08** — полная сборка после камер и спайка ANPR.

## Как запускать

CLI-оркестратор (рекомендуется для последовательного прогона с `agent`):

```bash
./orchestrate.sh docs/tasks/05-scale-adapters.md
./orchestrate.sh --queue
make orchestrate TASK=docs/tasks/05-scale-adapters.md
```

Подробности: [README — Мультиагентная разработка](../../README.md#мультиагентная-разработка).

В Cursor (Agent mode) — шаблон из README, подставив путь к нужному файлу, например:

```text
Используя подход по оркестрации мультиагентной разработки (agents/01_orchestrator.md),
выполни доработку docs/tasks/02-weight-source.md.
…
Каталог артефактов пайплайна: docs/implementation
```

Рекомендуется отдельный каталог/префикс артефактов на задачу при параллельных прогонах (например `docs/implementation/02-weight-source/`), либо чистить/архивировать `docs/implementation/` между запусками — иначе артефакты этапов смешаются.
