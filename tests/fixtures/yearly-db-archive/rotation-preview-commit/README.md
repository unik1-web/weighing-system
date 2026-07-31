# Fixture: rotation-preview-commit

## Назначение
Фикстура для проверки ротации года (preview + commit) в stage 6.

## Состав данных
- активный год содержит минимум два `open`-тикета:
  - один тикет с `vehicle_number`, для которого есть `default_tare_weight` в `dictionary_entries` категории `vehicles`;
  - один тикет без записи в словаре, который закрывается через `tara_default` из `config.ini`.
- присутствует минимум один тикет с `reo_status = pending`.

## Ожидаемое поведение
- `POST /api/year/rotation/preview` возвращает оба кандидата в `open_candidates` и `pending_reo_count > 0`, без записи в БД;
- `POST /api/year/rotation/commit` под lock авто-закрывает кандидатов, пишет `ticket_audit.event_type = auto_close`, создаёт backup, публикует новый `weighing-ГГГГ.db` и очищает сессию.
