# Интеграция Cursor Agent Orchestrator в weighing-system

Предложение по замене текущего пайплайна (`agents/` + Cursor CLI) на [denistv/cursor-agent-orchestrator](https://github.com/denistv/cursor-agent-orchestrator) с live-дашбордом.

## 1. Краткий вердикт

Текущий пайплайн weighing-system — **shell-оркестрация через Cursor CLI** и submodule `rdudov/agents`. Оркестратор denistv — **FSM + Cursor Skills + субагенты + файловая память + SSE-дашборд**. Для weighing-system выгоднее **встроить оркестратор нативно в репозиторий продукта** (skills, protocol, `memory/`, `dashboard/`), а не держать его отдельным «чужим» репо: агенты должны знать стек Flask/React/SQLite и ограничения из `docs/project-for-agents.md`.

Рекомендуемый путь: **миграция с адаптацией** (не слепой submodule всего оркестратора).

## 2. Что есть сейчас (weighing-system)

| Элемент | Как устроено |
|--------|----------------|
| Роли | Submodule `agents/` → [rdudov/agents](https://github.com/rdudov/agents) |
| Запуск | Cursor Agent mode + shell: `agent -f --model … -p …` |
| Вход | Markdown в `docs/tasks/` |
| Артефакты | `docs/implementation/` (в `.gitignore`) |
| Контекст продукта | `docs/project-for-agents.md`, `architecture.md`, `api.md` |
| Наблюдаемость | Нет UI: только файлы и логи чата |
| Связь этапов | Неформальный сценарий из `01_orchestrator.md` |

Проблемы текущего подхода:

- Зависимость от внешнего CLI и ручного выбора моделей в промпте.
- Нет единой модели состояния задачи (кто сейчас работает, что уже сделано, почему вернулись назад).
- Нет живого мониторинга параллельных/длинных прогонов.
- Промпты ролей общие (rdudov), слабо привязаны к домену взвешиваний.
- Каталог `agents/` в рабочей копии сейчас пуст без `git submodule update --init`.

## 3. Что даёт cursor-agent-orchestrator

### 3.1. Ядро

- **Протокол** (`orchestrator-protocol.md`): сущности `Task` / `Execution`, статусы `new → in-progress → done|fail`, лимит 15 executions.
- **FSM этапов** (после `done`):

```text
analysis → architect → development → code-review → testing → tech-writer
              ↑______________|              |           |
              └──── analysis / architect ←──┘           └→ development (при fail-петлях)
```

- **Skills** в `.cursor/skills/`: `orchestrator`, `analysis`, `architect`, `developer`, `code-reviewer`, `tester`, `tech-writer`.
- **Память**: `memory/TaskBoard.md` + `memory/TASK_MEMORY_{hex}.yml`.
- **Запуск**: в чате Cursor — `/orchestrator …`; оркестратор создаёт execution и вызывает **субагента** (изолированный контекст), а не shell `agent`.

### 3.2. Дашборд (`dashboard/`)

Отдельное Vite + Express-приложение:

- Читает `memory/` (или `DASHBOARD_DATA_DIR`).
- `GET /api/tasks` + SSE `/api/events` (chokidar).
- UI: список задач, summary, timeline executions, граф FSM, детальный `output_data`, режим **Room** (пиксельные персонажи ролей).
- Порты по умолчанию: API **3001**, Vite рядом; **не пересекается** с weighing API `:5001` / Vite `:5173`.

Дашборд **не оркестрирует** — только визуализирует файлы памяти.

## 4. Сравнение подходов

| Критерий | Сейчас (rdudov/agents) | denistv orchestrator |
|----------|------------------------|----------------------|
| Механизм запуска | Cursor CLI shell | Cursor Skills + Task/subagent |
| Состояние | Markdown-артефакты | YAML executions + TaskBoard |
| Маршрутизация | Сценарий оркестратора в md | Жёсткий FSM + анализ при `fail` |
| Изоляция ролей | Отдельные CLI-процессы | Субагенты с чистым контекстом |
| Live UI | Нет | Dashboard + Room |
| Привязка к продукту | Через `docs/project-for-agents.md` в промпте | Нужно явно добавить в skills |
| Сложность внедрения | Уже описана в README | Копирование/адаптация skills + memory + dashboard |

## 5. Целевая архитектура в weighing-system

```text
weighing-system/
├── .cursor/skills/          # роли оркестратора (адаптированные)
├── orchestrator-protocol.md # протокол (из denistv, без правок смысла)
├── memory/
│   ├── TaskBoard.md
│   └── TASK_MEMORY_*.yml
├── dashboard/               # live UI (из denistv, data dir → ../../memory)
├── docs/
│   ├── project-for-agents.md
│   ├── tasks/               # человеческие постановки (источник Description)
│   └── {task_id}/           # выход tech-writer (как в оркестраторе)
├── src/ … server/ …         # продукт без изменений контракта
└── agents/                  # deprecate → удалить submodule
```

Принцип разделения:

- **Продукт** (`src/`, `server/`) — не смешивать с UI дашборда агентов.
- **Оркестрация** — skills + protocol + memory.
- **Мониторинг** — `dashboard/` как dev-tooling, не часть Windows-установщика.

## 6. План миграции (поэтапно)

### Этап A — каркас (без смены процесса разработки)

1. Скопировать в корень:
   - `orchestrator-protocol.md`
   - `.cursor/skills/**`
   - `dashboard/**`
   - пустой `memory/TaskBoard.md` (+ `.gitkeep` / пример)
2. Добавить в `.gitignore` рабочие YAML при необходимости политики (или коммитить только примеры; для live-мониторинга файлы должны быть на диске локально).
3. npm scripts в корне:

```json
"orchestrator:dashboard": "npm --prefix dashboard run dev",
"orchestrator:dashboard:install": "npm --prefix dashboard install"
```

4. Документировать: `DASHBOARD_DATA_DIR` по умолчанию = `<repo>/memory`.

**Риск низкий:** продукт не затрагивается.

### Этап B — адаптация skills под weighing-system

В каждый skill добавить блок **«Контекст продукта»**:

- Обязательное чтение: `docs/project-for-agents.md`, при необходимости `docs/architecture.md`, `docs/api.md`, `README.md`.
- Ограничения: не коммитить `config.ini` / `BD/`; Python 3.11/3.12; не ломать API без явной задачи; UI на русском; нормализация госномеров через `dictionary_import`.
- Команды проверки для `tester` / `developer`:
  - `npm test`, `npm run typecheck`, `npm run test:server`
- `tech-writer`: писать в `docs/{task_id}/` **и** обновлять пользовательскую доку (`README`, `docs/architecture.md`, `docs/api.md`) только если задача это требует; не дублировать секреты.

Опционально: skill `analysis` при старте подтягивает текст из `docs/tasks/*.md`, если в Description указан путь к постановке.

### Этап C — мост `docs/tasks` → TaskBoard

Сохранить привычный вход:

1. Автор кладёт постановку в `docs/tasks/0N-….md` (как сейчас).
2. Запуск:

```text
/orchestrator создай задачу на доске по docs/tasks/01-weighing-modes.md и начни выполнять
```

3. Оркестратор:
   - генерирует `task_id` вида `{hex}-weighing-modes`;
   - пишет секцию в `memory/TaskBoard.md` с `Description` = содержимое/ссылка на постановку;
   - создаёт `TASK_MEMORY_*.yml` и стартует `analysis`.

Старый шаблон с `agent -f --model …` пометить deprecated в README.

### Этап D — вывод из эксплуатации `agents/` submodule

1. Обновить README: раздел «Мультиагентная разработка» → новый протокол.
2. Обновить `docs/project-for-agents.md`: таблица каталогов (`memory/`, `.cursor/skills/`, `dashboard/`).
3. Удалить submodule `agents/` и запись из `.gitmodules` после одного успешного пилотного прогона.
4. `docs/implementation/` оставить как опциональный scratch **или** перестать использовать — источник истины становится `output_data` в YAML + `docs/{task_id}/` от tech-writer.

### Этап E — пилот на реальной задаче

Прогнать маленькую задачу из roadmap (или узкий bugfix), не весь этап weighing-modes:

1. Терминал: `npm run orchestrator:dashboard`
2. Чат: `/orchestrator …`
3. В дашборде проверить: фаза, timeline, FSM, Room, SSE reconnect.
4. Критерии успеха:
   - полный проход до `tech-writer` или осознанный `fail` с возвратом;
   - код/тесты соответствуют ограничениям проекта;
   - дашборд отражает каждый execution без ручного refresh.

## 7. Что адаптировать обязательно (иначе оркестратор «общий»)

| Место | Зачем |
|-------|--------|
| Skills: контекст продукта | Иначе агенты пишут generic-код мимо Flask/SQLite/localStorage |
| `tester` → команды vitest/pytest | Сейчас skill ориентирован на абстрактный suite |
| `tech-writer` → пути docs | Согласовать с существующей структурой `docs/` |
| `developer` → границы слоёв | `src/lib/*`, `server/*.py`, не трогать installer без задачи |
| `.gitignore` / политика memory | Решить: коммитить ли историю прогонов или только локально |
| README / project-for-agents | Единая точка входа для людей и агентов |

**Не менять** без нужды: Flask API, схему SQLite, печать, РЭО, импорты — оркестратор только процесс разработки.

## 8. Варианты подключения кода оркестратора

| Вариант | Плюсы | Минусы | Рекомендация |
|---------|-------|--------|--------------|
| **A. Vendor copy** skills+protocol+dashboard в этот репо | Простая адаптация, нет submodule hell | Нужно вручную подтягивать апстрим | **Да, основной** |
| **B. Git submodule** на весь denistv-репо | Легко обновлять upstream | Skills живут не в корне продукта; пути memory ломаются; сложно кастомизировать | Нет как единственный способ |
| **C. Monorepo package** / npm workspace только для dashboard | Чистое разделение UI | Лишняя сложность для одного tooling-приложения | Опционально позже |
| **D. Оставить оба пайплайна** | Мягкий переход | Два конфликтующих процесса, путаница | Только на время Этапа C–D |

Рекомендация: **A + короткий переходный период D**.

## 9. Порты, процессы, Windows-сборка

| Процесс | Порт | Нужен в prod-установщике? |
|---------|------|---------------------------|
| Vite продукт | 5173 | Нет |
| Flask | 5001 | Да |
| Dashboard API | 3001 | **Нет** |
| Dashboard Vite | (vite default / proxy) | **Нет** |

`installer/`, PyInstaller, Inno Setup — **не включать** `dashboard/` и `memory/` в пользовательский пакет.

## 10. Риски и митигации

| Риск | Митигация |
|------|-----------|
| Skills без доменного контекста дают неверный код | Этап B обязателен до пилота |
| Раздувание `output_data` в YAML | В analysis/architect ссылаться на файлы в `docs/tasks` и короткие резюме |
| Конфликт с cloud/background agents | Оркестратор — локальный Cursor chat workflow; не смешивать с prod CI без явной задачи |
| React 19 в dashboard vs React 18 в продукте | Держать отдельные `package.json` (уже так в denistv) |
| Пустой `agents/` ломает старые инструкции | Сразу обновить README при Этапе A |

## 11. Предлагаемый порядок работ (чеклист PR)

1. [ ] Добавить `orchestrator-protocol.md`, `.cursor/skills/`, `dashboard/`, `memory/TaskBoard.md`
2. [ ] npm scripts + краткий `docs/orchestrator.md` (how-to)
3. [ ] Адаптировать skills под weighing-system
4. [ ] Обновить README и `docs/project-for-agents.md`
5. [ ] Пилотный прогон + скрин/проверка дашборда
6. [ ] Удалить submodule `agents/`
7. [ ] (Опционально) шаблон задачи: скрипт `docs/tasks` → секция TaskBoard

## 12. Пример целевого UX

```bash
# терминал 1 — продукт (как обычно)
npm run dev:api
npm run dev

# терминал 2 — мониторинг агентов
npm run orchestrator:dashboard
# → http://localhost:5174 (или порт Vite dashboard) + API :3001
```

```text
# чат Cursor
/orchestrator создай задачу на доске по docs/tasks/01-weighing-modes.md и начни выполнять
```

Дашборд показывает: задача на analysis → architect → development → … → Room с «разработчиком» за столом, пока execution `in-progress`.

## 13. Итог

Преобразование = **замена CLI-пайплайна на FSM-оркестратор Cursor Skills** и **подключение live-дашборда как dev-инструмента**, с обязательной привязкой ролей к документации weighing-system. Продуктовый код и Windows-дистрибутив остаются вне контура оркестрации; меняется способ ведения задач разработки внутри репозитория.
