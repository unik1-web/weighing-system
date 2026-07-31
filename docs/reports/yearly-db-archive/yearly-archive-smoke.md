# Stage 6 yearly archive smoke evidence

## Контекст
- Entrypoint: `PORT=5031 .venv/bin/python server/app.py` (production-like, текущий код; эквивалент `npm start`)
- Isolated HTTP server: сценарии `fail-retry` / `parallel-lock` (реальные маршруты `server/app.py` + TCP)

## Итог по сценариям
- `active`: `PASS` (4/4 steps)
- `archive`: `PASS` (8/8 steps)
- `fail-retry`: `PASS` (7/7 steps)
- `parallel-lock`: `PASS` (4/4 steps)

## Active year
- Base URL: `http://127.0.0.1:5031`
- Steps: health=PASS, config=PASS, seed_session=PASS, rotation_preview=PASS
- `active_year` из config: `2026`
- preview_token формата `rotprev_...` (не stub)

## Archive
- Base URL: `http://127.0.0.1:5031` (+ seeded `BD/weighing-2025.db`)
- Покрыто: years → tickets → ticket, `archive_edit_forbidden_field`, `archive_reo_ack_required`, `archive_reo_sent_warning`

## Parallel lock
- status: `PASS`
- Вторая сессия: `409 rotation_in_progress`

## Связанные файлы
- `yearly-archive-smoke.json` — active scenario JSON
- `yearly-archive-archive.md` / `.json` — archive scenario
- `yearly-archive-fail-retry.md` / `.json` — TF-04
- `yearly-archive-parallel-lock.md` / `.json` — TF-05

## Ручные UI-проверки (обязательные, не автоматизированы smoke HTTP)
- [ ] Вход, `single`/`dual`, журнал, печать, РЭО, импорты после `npm run build && npm start`
- [ ] Диалог ротации: blocking tickets, ack pending REO, logout после commit
- [ ] Архив: список лет → журнал → карточка → печать без записи в active year
- [ ] Admin видит «Редактировать», user — нет
