# Описание проекта для агентов

Краткий контекст для мультиагентного пайплайна (Cursor Agent Orchestrator). Подробности: [architecture.md](architecture.md), [api.md](api.md), [roadmap.md](roadmap.md), [orchestrator.md](orchestrator.md), корневой [README.md](../README.md). Ограничения для skills: [`.cursor/skills/_weighing-system-context.md`](../.cursor/skills/_weighing-system-context.md).

## Назначение

Веб-приложение учёта автомобильных взвешиваний на полигоне отходов: регистрация взвешиваний, журнал, печать актов/талонов, интеграция с РЭО, импорт из Vescom, Metra и WA.

## Стек

| Слой | Технологии |
|------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Python 3.11/3.12, Flask на `127.0.0.1:5001` |
| Данные | SQLite (`BD/weighing.db`), `config.ini` |
| UI-кэш | `localStorage` (ключи `app_*`), синхронизация с API |
| Сборка Windows | PyInstaller + Inno Setup (`installer/`) |

## Архитектура (кратко)

```
Браузер (React + localStorage)
        │  /api/*
        ▼
Flask (server/app.py)  ──►  config.ini
                       ──►  BD/weighing.db
                       ──►  logs/app.log
```

- Production: `npm run build` + `npm start` → один процесс Flask раздаёт `dist/` и API.
- Dev: Vite `:5173` + `npm run dev:api` (прокси `/api` → `:5001`). У `localhost:5173` и `127.0.0.1:5001` разный `localStorage`.
- Orchestrator dashboard (отдельно): UI `:5174`, API `:3001`, данные из `memory/`.

## Ключевые модули

**Backend (`server/`):** `app.py`, `persistence.py`, `sqlite_store.py`, `config_ini.py`, `vescom.py`, `metra.py`, `wa.py`, `dictionary_import.py`, `reo_client.py`, `browse.py`.

**Frontend (`src/`):** `lib/storage.ts`, `lib/storage-sync.ts`, `lib/api.ts`, `lib/reo.ts`, `lib/scales.ts`, `components/*ImportView.tsx`, `components/PrintAct.tsx`, `components/SettingsView.tsx`.

## Ограничения и правила

- Не коммитить секреты, `config.ini`, `BD/`, `server/data/`, `.env*`.
- Память оркестратора: `memory/TaskBoard.md`, `memory/TASK_MEMORY_*.yml` (YAML в `.gitignore`).
- Сохранять существующие API-контракты из `docs/api.md`, если задача явно не меняет их.
- Python: ориентироваться на 3.11/3.12 (`fdb` может ломаться на 3.13).
- Импорт справочников: нормализация госномеров и ФИО через `dictionary_import` — не дублировать логику в обход.
- UI на русском; печатные формы и РЭО-форматы менять осторожно.
- Не включать `dashboard/` оркестратора в Windows-установщик.

## Каталоги для пайплайна

| Путь | Назначение |
|------|------------|
| `.cursor/skills/` | Роли оркестратора (SKILL.md) |
| `.cursor/skills/_weighing-system-context.md` | Стек и ограничения для всех ролей |
| `memory/` | TaskBoard и память executions |
| `dashboard/` | Live-мониторинг агентов |
| `orchestrator-protocol.md` | Форматы Task / Execution |
| `docs/tasks/` | Постановки задач (вход оркестратора) |
| `docs/{task_id}/` | Документы tech-writer после прогона |
| `docs/implementation/` | Черновики старого CLI-пайплайна (deprecated) |
| `agents/` | Deprecated submodule [rdudov/agents](https://github.com/rdudov/agents) |

## Запуск пайплайна

См. [orchestrator.md](orchestrator.md) и раздел «Мультиагентная разработка» в корневом README.
