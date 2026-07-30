# Развёртывание: режимы взвешивания (этап 1)

Инструкция для обновления на версию с режимами `single` / `dual`. Детали схемы — в `docs/architecture.md`.

## Атомарный деплой

Обновляйте **frontend и Flask вместе** (один релиз). Не смешивайте новый UI со старым backend и наоборот: клиент пишет `weighing_mode` / `version` / `app_ticket_audit`, сервер должен уметь их читать и писать через `TICKET_COLUMNS` и таблицу `ticket_audit`.

Типичный prod-путь:

```bash
npm install
pip install -r server/requirements.txt
npm run build
npm start   # Flask раздаёт dist/ и API на 127.0.0.1:5001
```

## Миграция SQLite (первый старт Flask)

При старте `ensure_ticket_schema`:

1. Fresh install: `CREATE TABLE weighing_tickets` уже содержит `weighing_mode`, `version`; создаётся `ticket_audit`.
2. Существующая БД: `ALTER TABLE ... ADD COLUMN` при отсутствии колонок.
3. **Одноразовый backfill** — только если на этом прогоне колонка `weighing_mode` была только что добавлена:

```sql
UPDATE weighing_tickets SET weighing_mode = 'dual' WHERE status = 'open';
```

Completed остаются с DEFAULT `'single'`. Повторные старты **не** делают UPDATE `weighing_mode` по `status` (иначе затрутся dual-completed).

Клиент при загрузке `/api/database` нормализует **только отсутствующие** поля (`open`→`dual`, `completed`→`single`, нет `version`→`1`) и инициализирует локальный ключ `app_ticket_audit`.

## Defaults настроек режимов

Если ключи не заданы в `config.ini` / Настройках, клиент использует:

| Ключ | Default |
|------|---------|
| `weighing_mode_default` | `single` |
| `stable_mode` | `false` |
| `tara_threshold` | `15000` |
| `max_time_between` | `24` |
| `tara_default` | `0` |

При необходимости задайте их в UI «Настройки» (секция режимов взвешивания).

## После обновления — краткая проверка

1. Одиночное: «Сохранить и завершить» → `completed`, `weighing_mode=single`.
2. Двойное: первый проход → `open`; дозавершение → `completed`, `version` ≥ 2, audit `created`+`completed`.
3. Журнал обновляется после create и после complete; печать / РЭО / импорты Vescom·Metra·WA — без новых обязательных полей.

## Откат

Откатывайте **пару** клиент+сервер одной версии. Лишние колонки SQLite сами по себе безопасны, но рассинхрон `TICKET_COLUMNS` / UI недопустим.
