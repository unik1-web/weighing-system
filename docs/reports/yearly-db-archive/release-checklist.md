# Release checklist: yearly DB archive (stage 6)

Перед merge/релизом stage 6 все пункты должны быть выполнены. Evidence: `docs/reports/yearly-db-archive/`. CI: `.github/workflows/yearly-db-archive.yml`. Операционный runbook: `docs/yearly-db-archive-deploy.md`.

## Backup и данные

- [ ] Снята согласованная пара backup legacy/`config.ini` (+ активный `BD/weighing-ГГГГ.db` при уже мигрированной среде) **вне** каталога приложения
- [ ] Каталоги `BD/`, `backup/`, `logs/` существуют рядом с приложением (не в `_MEIPASS`)
- [ ] Права записи на `config.ini`, `BD/`, `backup/`, `logs/` проверены

## Миграция (UC-01)

- [ ] Success: legacy `BD/weighing.db` → `BD/weighing-ГГГГ.db`, записан `active_year`, есть `backup/*.legacy-before-stage6*.bak`
- [ ] Fail / conflict: сценарий `migration_target_exists` понятен оператору; legacy не изменён in-place
- [ ] Mixed legacy: один годовой файл + warning `mixed_legacy_year_mismatch` (не нарезка по годам)
- [ ] Evidence / тесты: `yearly-archive-acceptance.md` EC-03 / TF-01, `test_stage6_migration.py`

## Ротация года (UC-02)

- [ ] Success: preview → commit → новый `active_year`, backup `*.before-rotation-*.bak`, logout / повторный вход
- [ ] Fail / retry: сбой после backup безопасен; повтор без ручной чистки lock/`.tmp` (`fail-retry`)
- [ ] Parallel rotation: вторая сессия получает `409 rotation_in_progress` (`parallel-lock`)
- [ ] Write-gate during rotation: запись в active DB блокируется, пока держится lock
- [ ] Evidence: `yearly-archive-smoke.md`, `yearly-archive-fail-retry.md`, `yearly-archive-parallel-lock.md`

## Active year (UC-03)

- [ ] CRUD / импорты / РЭО / печать / нумерация идут в активный `BD/weighing-<active_year>.db`
- [ ] Production-like smoke `active` против `npm start` (не Vite) проходит
- [ ] Команда: `npm run smoke:stage6`

## Archive read / reprint (UC-04)

- [ ] Список лет, журнал, карточка, перепечатка **без** записи в active year
- [ ] Production-like smoke `archive` проходит
- [ ] Команда: `npm run smoke:stage6-archive`
- [ ] Evidence: `yearly-archive-archive.md`

## Archive edit (UC-05)

- [ ] Forbidden-field matrix: denylist-ключи отклоняются (`archive_edit_forbidden_field`)
- [ ] Sent-REO warning: `archive_reo_sent_warning` + подтверждение / `reo_divergence_warning`
- [ ] Admin-only UI; user не видит «Редактировать»
- [ ] Diff пишется в `ticket_audit` годовой БД

## CI / smoke / packaging

- [ ] Workflow `yearly-db-archive.yml`: `frontend-tests`, `backend-tests`, `build`, `production-smoke`, `windows-package`, `evidence-gate`
- [ ] Локально: `npm run test:stage6` (backend + frontend subsets)
- [ ] Production-like: `npm run build && npm start`, затем smoke `active` / `archive` / `fail-retry` / `parallel-lock`
- [ ] Windows packaging: `npm run build:win:exe` — данные (`BD/`, `backup/`, `logs/`) рядом с exe, не в bundle/`_MEIPASS`
- [ ] Evidence-gate: все `docs/reports/yearly-db-archive/*.md` на месте; в acceptance нет строк `FAIL`
- [ ] Acceptance branches закрыты: mixed legacy, rotation preview/commit, fail/retry, parallel lock, write-gate, archive read/reprint, forbidden-field, sent-REO

## Acceptance contracts

- [ ] `EC-01` … `EC-14` = PASS в `yearly-archive-acceptance.md`
- [ ] `TF-01` … `TF-05` = PASS
- [ ] Runtime smoke table: `active` / `archive` / `fail-retry` / `parallel-lock` = PASS
