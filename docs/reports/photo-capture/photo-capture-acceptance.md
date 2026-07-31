# Acceptance report: photo capture (stage 7)

| ID | Status | Evidence | Note |
|---|---|---|---|
| EC-01 | PASS | `test_cameras_capture_api.py`, `smoke:photo-capture-degrade` | Отказ/таймаут камеры не блокирует фиксацию веса. |
| EC-02 | PASS | `test_stage7_database_cameras_roundtrip.py` | JPEG/base64 не в sync JSON / SQLite blob. |
| EC-03 | PASS | `test_stage7_packaging_tokens.py`, `docs/photo-capture-deploy.md` | `Photo/` рядом с exe, не в `_MEIPASS`. |
| EC-04 | PASS | `smoke:photo-basic-import`, packaging tokens | Basic старт без OpenCV. |
| EC-05 | PASS | `test_video_settings_config.py`, full packaging | Full: `video_enabled` без переустановки. |
| EC-06 | PASS | `requirements.txt` vs `requirements-full.txt`, dual spec/iss | Exclude opencv только в сборке basic. |
| EC-07 | PASS | `docs/photo-capture-deploy.md`, постановка stage 7 | ANPR вне скоупа этапа 7. |
| EC-08 | PASS | runbook secrets checklist, CI evidence-gate, `camera_logging` | Нет секретов RTSP / бинарников фото в git. |
| EC-09 | PASS | `print-act-format.test.ts` | Печать не требует фото. |
| EC-10 | PASS | `test:stage7-backend`, `test_ticket_photos_replace.py` | Метаданные + degrade в CI. |
| EC-11 | PASS | `test_stage7_migration.py`, path helpers | Каталог `Photo/`; stubs `photo_*` заполняются. |
| EC-12 | PASS | `test_cameras_capture_rtsp_timeout.py`, config timeout ≤ 3 с | Таймаут камеры; вес не откатывается. |

## Runtime smoke

| Mode | Status | Command |
|---|---|---|
| capability | PASS | `npm run smoke:photo-capability` |
| capture-noop | PASS | `npm run smoke:photo-capture-noop` |
| capture-http | PASS | `npm run smoke:photo-capture-http` (нужен HTTP fixture) |
| capture-degrade | PASS | `npm run smoke:photo-capture-degrade` |
| basic-import | PASS | `npm run smoke:photo-basic-import` |
| full-import | PASS | `npm run smoke:photo-full-import` (нужен opencv) |

## Вне скоупа (явно)

- ANPR-инференс и порог точности (этап 8)
- Обязательное включение фото в печатные формы
- Retention/автоочистка `Photo/`

## Ограничения среды / ручные проверки

- Полный UI CRUD камер / эталоны / wizard spare после `npm start` — ручной checklist по runbook.
- Windows full PyInstaller на Linux CI недоступен; gate = packaging tokens + import-smoke basic/full + windows-package job на `windows-latest`.
