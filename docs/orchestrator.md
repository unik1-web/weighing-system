# Cursor Agent Orchestrator в weighing-system

Как запускать мультиагентный пайплайн и live-дашборд. Протокол данных: [`orchestrator-protocol.md`](../orchestrator-protocol.md). План миграции: [`orchestrator-integration.md`](orchestrator-integration.md).

## Состав

| Путь | Назначение |
|------|------------|
| `.cursor/skills/` | Роли: orchestrator, analysis, architect, developer, code-reviewer, tester, tech-writer |
| `.cursor/skills/_weighing-system-context.md` | Ограничения и стек продукта для всех ролей |
| `memory/TaskBoard.md` | Доска активных задач |
| `memory/TASK_MEMORY_*.yml` | Память executions (локально, в `.gitignore`) |
| `dashboard/` | Live UI (SSE), порт UI **5174**, API **3001** |

## Установка дашборда

```bash
npm run orchestrator:dashboard:install
```

## Запуск мониторинга

```bash
npm run orchestrator:dashboard
```

Откроется UI на `http://127.0.0.1:5174` (API `http://127.0.0.1:3001`). Каталог данных по умолчанию — `<repo>/memory`. Переопределение: `DASHBOARD_DATA_DIR=/abs/path/to/memory`.

Продукт по-прежнему: Vite `:5173` + Flask `:5001` — порты не пересекаются.

## Точка продолжения roadmap

- Влито: этап **01** (PR [#13](https://github.com/unik1-web/weighing-system/pull/13)) + bugfix PR [#23](https://github.com/unik1-web/weighing-system/pull/23).
- Очередь постановок: [docs/tasks/README.md](tasks/README.md).
- **Следующий запуск — этап 02** (не подмешивать невлитый стек PR #15–#21).

## Запуск пайплайна (чат Cursor)

```text
/orchestrator создай задачу на доске по docs/tasks/02-weight-source.md и начни выполнять
```

или, если задача уже на доске:

```text
/orchestrator продолжить
```

Оркестратор читает `memory/TaskBoard.md`, создаёт `execution` и запускает субагентов по FSM. Смотри прогресс в дашборде.

## FSM

```text
analysis → architect → development → code-review → testing → tech-writer
```

После `fail` оркестратор выбирает следующий этап по истории (лимит 15 executions на задачу).

## Артефакты

- Промежуточные результаты этапов — в `output_data` внутри `memory/TASK_MEMORY_*.yml`.
- Финальная документация прогона — `docs/{task_id}/` (tech-writer).
- Черновики старого пайплайна — `docs/implementation/` (deprecated для нового процесса).

## Старый пайплайн

Submodule `agents/` ([rdudov/agents](https://github.com/rdudov/agents)) и запуск через Cursor CLI `agent -f --model …` — **deprecated**. Используйте skills и `/orchestrator`.
