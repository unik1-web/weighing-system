# Описание проекта для агентов

Краткий контекст для мультиагентного пайплайна (`agents/`). Подробности: [architecture.md](architecture.md), [api.md](api.md), [roadmap.md](roadmap.md), корневой [README.md](../README.md).

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

## Ключевые модули

**Backend (`server/`):** `app.py`, `persistence.py`, `sqlite_store.py`, `config_ini.py`, `vescom.py`, `metra.py`, `wa.py`, `dictionary_import.py`, `reo_client.py`, `browse.py`.

**Frontend (`src/`):** `lib/storage.ts`, `lib/storage-sync.ts`, `lib/api.ts`, `lib/reo.ts`, `lib/scales.ts`, `components/*ImportView.tsx`, `components/PrintAct.tsx`, `components/SettingsView.tsx`.

## Ограничения и правила

- Не коммитить секреты, `config.ini`, `BD/`, `server/data/`, `.env*`.
- Артефакты пайплайна писать только в `docs/implementation/` (каталог в `.gitignore`).
- Сохранять существующие API-контракты из `docs/api.md`, если задача явно не меняет их.
- Python: ориентироваться на 3.11/3.12 (`fdb` может ломаться на 3.13).
- Импорт справочников: нормализация госномеров и ФИО через `dictionary_import` — не дублировать логику в обход.
- UI на русском; печатные формы и РЭО-форматы менять осторожно.

## Каталоги для пайплайна

| Путь | Назначение |
|------|------------|
| `agents/` | Промпты ролей (submodule [rdudov/agents](https://github.com/rdudov/agents)) |
| `docs/project-for-agents.md` | Этот файл — описание проекта |
| `docs/tasks/` | Постановки задач (вход оркестратора) |
| `docs/implementation/` | ТЗ, архитектура, план, статус пайплайна (не коммитить) |

## Запуск пайплайна

См. раздел «Мультиагентная разработка» в корневом README.
