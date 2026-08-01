# Контекст продукта: weighing-system

Обязательный контекст для всех ролей Cursor Agent Orchestrator в этом репозитории.

## Что это

Веб-приложение учёта автомобильных взвешиваний на полигоне отходов: регистрация взвешиваний, журнал, печать актов/талонов, интеграция с РЭО, импорт Vescom / Metra / WA.

## Стек

| Слой | Технологии |
|------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS (`src/`) |
| Backend | Python 3.11/3.12, Flask на `127.0.0.1:5001` (`server/`) |
| Данные | SQLite `BD/weighing.db`, `config.ini` |
| UI-кэш | `localStorage` (`app_*`), синхронизация с API |
| Сборка Windows | PyInstaller + Inno Setup (`installer/`) — не трогать без явной задачи |

Подробности: `docs/project-for-agents.md`, `docs/architecture.md`, `docs/api.md`, корневой `README.md`.

## Ограничения (обязательны)

- Не коммитить и не создавать в git: секреты, `config.ini`, `BD/`, `server/data/`, `.env*`.
- Сохранять существующие API-контракты из `docs/api.md`, если задача явно не меняет их.
- Python: ориентироваться на 3.11/3.12 (`fdb` может ломаться на 3.13).
- Импорт справочников: нормализация госномеров и ФИО через `server/dictionary_import.py` — не дублировать логику.
- UI на русском; печатные формы и РЭО-форматы менять осторожно.
- Каталог `dashboard/` — tooling оркестратора, **не** часть продукта и Windows-установщика.
- Рабочая память агентов: только `memory/` и (для tech-writer) `docs/{task_id}/`.

## Проверки

| Команда | Назначение |
|---------|------------|
| `npm test` | Vitest (frontend) |
| `npm run typecheck` | TypeScript |
| `npm run test:server` | pytest (`server/tests`) |
| `npm run lint` | ESLint |

## Постановки задач

Человеческие постановки лежат в `docs/tasks/`. Оркестратор может создать задачу на доске по такому файлу: `Description` должен включать путь к постановке и её суть.
