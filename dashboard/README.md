# Live Dashboard (Cursor Agent Orchestrator)

Веб-UI для мониторинга задач weighing-system: доска, timeline executions, граф FSM, Room.

Источник данных: каталог `memory/` в корне репозитория (`TaskBoard.md`, `TASK_MEMORY_*.yml`).

## Запуск из корня репозитория

```bash
npm run orchestrator:dashboard:install
npm run orchestrator:dashboard
```

- UI: `http://127.0.0.1:5174` (не путать с продуктовым Vite `:5173`)
- API / SSE: `http://127.0.0.1:3001`

Переменные:

| Переменная | Default | Смысл |
|------------|---------|--------|
| `PORT` | `3001` | порт API |
| `DASHBOARD_DATA_DIR` | `<repo>/memory` | каталог с TaskBoard и YAML |
| `VITE_DEV_PORT` | `5174` | порт UI |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:3001` | прокси `/api` |

## Локально из этого каталога

```bash
npm install
npm run dev
```

## Стек

React + Vite (клиент), Express + chokidar + SSE (сервер), `@xyflow/react` (FSM graph).
