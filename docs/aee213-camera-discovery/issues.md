# Реестр проблем: aee213-camera-discovery

## Итог

Задача завершена. Зафиксировано проблем: **1** возврат (code-review → development). После фикса повторный code-review — Approve; testing — PASS без возвратов.

## Проблемы в процессе разработки

### ISSUE-1: Утечка пароля в логи и игнорирование IP:port

- **Этап**: code-review (execution 4) → development (execution 5)
- **Описание**:
  1. **Критично:** в `_try_template` при неуспехе логировался сырой `str(exc)`. `requests` `HTTPError` содержит полный URL с userinfo → пароль попадал в `logs/app.log` (нарушение FR-6 / NFR-1).
  2. **Серьёзно:** UI всегда передавал `http_port`/`rtsp_port` (default 80/554), из-за чего backend не применял embedded `:port` из поля IP (`192.168.1.64:8080` бил в 80).
- **Решение**:
  1. `safe_exc_message()` = `mask_url(str(exc))` во всех путях fail/batch/worker; unit-тесты подтверждают отсутствие секрета в логе.
  2. Поля портов на форме пустые по умолчанию (auto); в POST уходят только явно заполненные; backend `parse_ip_and_ports` применяет embedded port.
  3. Дополнительно закрыты некритичные замечания ревью: max-4 из React `cameras`; omit userinfo при пустом username; дедуп сообщения «RTSP пропущен».
- **Execution**: #4 (Request Changes), #5 (fix), #6 (Approve)

## Замечания код-ревью

### Execution 4 (Request Changes) — закрыты в #5

| Severity | Тема | Статус |
|----------|------|--------|
| Критическое | Пароль в логе через `error=%s` / `str(exc)` | Исправлено (`safe_exc_message`) |
| Серьёзное | `IP:port` игнорировался из-за всегда передаваемых портов | Исправлено (empty=auto) |
| Некритичное | max-4 из `CamerasStorage` vs React state | Исправлено |
| Некритичное | `http://:pass@` при пустом username | Исправлено в `render_url` |
| Некритичное | Дубль текста «RTSP пропущен» | Исправлено |
| Некритичное | Кратковременное перекрытие HTTP-пулов при авто-cancel | Допустимо по архитектуре, не трогали |

### Execution 6 (Approve) — для сведения

1. `logger.exception` во внешнем `except` worker'а теоретически может включить текст неожиданного исключения с URL; пути `_try_template`/batch уже маскируют. Риск низкий.
2. При пустом username пароль в URL не попадает (userinfo опускается) — ожидаемо для Basic; оператору нужен логин.

## Проблемы тестирования

Возвратов testing → development не было. Suite зелёный на момент приёмки:

- Backend discover/templates: 22 passed; полный server suite: 143 passed.
- Frontend cameras: 12 passed; typecheck OK.

Некритичные пробелы покрытия (предложены тестировщиком, не блокируют MVP):

1. Vitest на клиент discover: `startDiscover` без портов при `IP:port`; маршруты poll/cancel.
2. API-кейс POST без `http_port` с `ip` вида `host:port` (логика уже покрыта unit-парсером).

## Известные ограничения (продукт)

- ONVIF WS-Discovery по подсети — вне MVP (follow-up).
- Digest-only auth без Basic в URL — вне MVP; при полном fail — сообщение оператору проверить Basic/ручной URL.
- Discover разрешает только частные/локальные IPv4; hostname DNS не поддерживается.
- Сессии discover не переживают рестарт Flask (in-memory).
- Существующий ручной `POST /api/cameras/snapshot` SSRF-ограничением этой задачи не ужесточался.
