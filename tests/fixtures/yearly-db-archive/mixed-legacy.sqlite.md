# Fixture: mixed-legacy.sqlite

Описание программной фикстуры mixed legacy для stage-6 backend integration.

## Как собрать

Использовать helper `build_stage6_legacy_db(...)` из `server/tests/stage6_fixtures.py` (реэкспорт в `conftest.py`):

- путь: `BD/weighing.db` во временном app root;
- минимум два тикета с датами из разных календарных лет (например `2024-02-02` и `2026-05-06`);
- `ticket_audit` содержит legacy-события `created`;
- `config.ini[settings].active_year` отсутствует.

## Ожидаемое поведение (TF-01)

- `GET /api/config` выполняет первичную миграцию;
- создаётся ровно один файл `BD/weighing-ГГГГ.db` (год = max ticket year);
- mixed legacy не дробится на несколько файлов;
- bootstrap warning `mixed_legacy_year_mismatch` содержит оба года;
- архивный журнал по году имени файла показывает warning для тикета с датой вне `ГГГГ`.
