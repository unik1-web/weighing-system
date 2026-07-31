# Fixture: rotation-source.sqlite

Описание программной фикстуры источника ротации для stage-6 backend integration.

## Как собрать

Использовать helper `build_stage6_active_year_db(...)` из `server/tests/stage6_fixtures.py` (реэкспорт в `conftest.py`):

- файл `BD/weighing-ГГГГ.db` с `active_year = ГГГГ` в `config.ini`;
- два `open`-тикета:
  - `t-dictionary` — госномер есть в `dictionary_entries` (`vehicles`) с `default_tare_weight`;
  - `t-default` — госномера нет в словаре, тара берётся из `tara_default`;
- минимум один тикет с `reo_status = pending`;
- whitelist-сущности: `users`, `profiles`, dictionary vehicles;
- `app_sessions` с активной сессией (не переносится в новый год).

Опционально для deny-by-default:

- `extra_app_tables={"app_ephemeral_cache": [...]}` — лишние `app_*` runtime/session данные вне whitelist.

## Ожидаемое поведение (TF-02..TF-05)

- preview: оба кандидата в `open_candidates`, `pending_reo_count > 0`, без записи в БД;
- commit: backup, auto-close + `ticket_audit`, publish `weighing-(ГГГГ+1).db` с пустым журналом;
- fail/retry: после сбоя `active_year` не переключается, повтор без двойного auto-close;
- parallel: вторая сессия получает `409 rotation_in_progress`;
- deny-by-default: target с лишними `app_*` не публикуется.
