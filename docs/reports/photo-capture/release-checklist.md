# Release checklist: photo capture (stage 7)

Перед merge/релизом stage 7 все пункты должны быть выполнены. Evidence: `docs/reports/photo-capture/`. CI: `.github/workflows/photo-capture.yml`. Операционный runbook: `docs/photo-capture-deploy.md`.

ANPR и обязательная печать фото — вне скоупа этапа 7.

## Backup и данные

- [ ] Снята согласованная копия `config.ini` + `BD/weighing-ГГГГ.db` (+ `Photo/` при наличии) **вне** каталога приложения
- [ ] Каталоги `BD/`, `backup/`, `logs/`, `Photo/` существуют рядом с приложением (не в `_MEIPASS`)
- [ ] Права записи на `config.ini`, `BD/`, `backup/`, `logs/`, `Photo/` проверены

## Миграция schema v7

- [ ] После первого запуска `PRAGMA user_version = 7`
- [ ] Таблицы `cameras`, `ticket_photos` на месте; повторный старт идемпотентен
- [ ] Evidence / тесты: `test_stage7_migration.py`, acceptance EC-11

## Dual packaging (UC-07)

- [ ] Basic: `server/requirements.txt` без opencv; `WeighingSystem-Setup.exe` / `build:win`
- [ ] Full: `server/requirements-full.txt` + `opencv-python-headless`; `WeighingSystem-Full-Setup.exe` / `build:win:full`
- [ ] Full spec/iss: `installer/weighing-system-full.spec`, `installer/weighing-system-full.iss`
- [ ] Capability: basic `available=false`; full `available=true`
- [ ] Import-smoke: `npm run smoke:photo-basic-import`, `npm run smoke:photo-full-import`

## Видео / захват (UC-01…UC-05)

- [ ] Full: `video_enabled` включается без переустановки
- [ ] Capture success → JPEG под `Photo/ГГГГ/ММ/ДД/`, метаданные в `ticket_photos`
- [ ] Degrade (timeout/unreachable) не блокирует вес; success не затирается failed
- [ ] Smoke: `smoke:photo-capability`, `smoke:photo-capture-noop`, `smoke:photo-capture-http`, `smoke:photo-capture-degrade`

## Секреты и запреты (EC-08)

- [ ] Нет RTSP/HTTP URL с паролями в git / evidence
- [ ] Нет бинарников JPEG / персональных кадров в git
- [ ] Логи маскируют URL (`mask_url` / camera_logging)

## CI / smoke / packaging

- [ ] Workflow `photo-capture.yml`: `frontend-tests`, `backend-tests`, `build`, `import-smoke-basic`, `import-smoke-full`, `windows-package`, `evidence-gate`
- [ ] Локально: `npm run test:stage7`
- [ ] Production-like: `npm run build && npm start`, затем photo smoke modes
- [ ] Windows packaging basic + full: `Photo/` рядом с exe, не в `_MEIPASS`
- [ ] Evidence-gate: acceptance без `FAIL`; release-gate + packaging tokens PASS
- [ ] Stage 5 / stage 6 workflows (`scale-adapters.yml`, `yearly-db-archive.yml`) не затронуты этим checklist

## Acceptance contracts

- [ ] `EC-01` … `EC-12` = PASS в `photo-capture-acceptance.md`
- [ ] Runtime smoke table: capability / capture-noop / capture-http / capture-degrade / basic-import / full-import = PASS (или явно BLOCKED окружением)
