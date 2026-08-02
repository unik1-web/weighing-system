# Реестр проблем: 37cc69-photo-capture

## Итог

Задача завершена. Зафиксировано проблем: **2** критических / серьёзных (исправлены) + несколько некритичных замечаний (оставлены as-is).

## Проблемы в процессе разработки

### ISSUE-1: FK IntegrityError при sync после capture (ticket_photos → tickets)

- **Этап**: code-review (execution 4) → development (execution 5)
- **Описание**: `_replace_tickets` делал `DELETE FROM weighing_tickets` при ещё существующих строках `ticket_photos` → после `POST /api/cameras/capture` любой клиентский `POST /api/database` с тикетами падал с `FOREIGN KEY constraint failed` (HTTP 400).
- **Решение**: перед DELETE тикетов очищать `ticket_photos`; photos из того же POST восстанавливаются через `_replace_ticket_photos`. Добавлен `test_sync_after_capture_ok`.
- **Execution**: #4 (найдено), #5 (исправлено), #6 (подтверждено)

### ISSUE-2: FK IntegrityError при replace sites (cameras / site-граф)

- **Этап**: code-review (execution 4) → development (execution 5)
- **Описание**: `_replace_sites` удалял `sites` при существующих `cameras` / `scales` / `site_runtime` / `site_scale_switches` → повторный full sync ломался; реестр камер мог не доезжать в SQLite.
- **Решение**: `_clear_site_children` (cameras → switches → runtime → scales) до DELETE sites; children перевставляются своими `_replace_*`. Добавлен `test_full_site_camera_sync_twice`.
- **Execution**: #4 (найдено), #5 (исправлено), #6 (подтверждено)

### ISSUE-3: Нет жёсткого wall-clock timeout на parallel capture

- **Этап**: code-review (execution 4) → development (execution 5)
- **Описание**: HTTP timeout был, RTSP/`as_completed` без общего wall-clock — зависший RTSP мог держать HTTP-запрос неопределённо долго (нарушение NFR архитектуры ≤5–6 s).
- **Решение**: `CAPTURE_WALL_CLOCK=6`; `wait(..., timeout=6)` + `shutdown(wait=False, cancel_futures=True)`; not_done → `status=failed` «Таймаут захвата». Тест `test_capture_wall_clock_timeout`.
- **Execution**: #4 (найдено), #5 (исправлено), #6 (подтверждено)

## Замечания код-ревью

Некритичные (не блокировали Approve после фиксов, не исправлялись в рамках задачи):

1. **Коллизия имён JPEG** при двух камерах одной role в одну секунду (`{ticket}_{phase}_{role}_{stamp}.jpg`) — желательно camera_id/uuid в имени.
2. **Partial POST** только `app_sites` / только `app_weighing_tickets` побочно очищает children (нужно для FK); UI sync шлёт полный набор ключей — в норме безопасно.
3. **Зависшие RTSP-потоки** после `shutdown(wait=False)` могут ещё жить в фоне — HTTP уже не блокируется.

## Проблемы тестирования

Возвратов testing → development не было. Suite зелёный:

- Backend: 91 passed (`test:server`); cameras/path/rotation: 15 passed.
- Frontend: 126 passed (Vitest); typecheck OK.

Некритичные пробелы покрытия (предложены тестировщиком, не блокируют):

- Отдельного API-теста `save_reference` нет.
- Нет автотеста «failed не затирает ok stub» / capture при `rotated_for_spare`.
- Нет unit на UI SpareSwitchWizard / TicketPhotoPreview (поведение покрыто кодом + serve/photoUrl).
