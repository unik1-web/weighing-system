# Описание проекта для агентов

Краткий контекст для мультиагентного пайплайна (`agents/`). Подробности: [architecture.md](architecture.md), [api.md](api.md), [roadmap.md](roadmap.md), корневой [README.md](../README.md).

## Назначение

Веб-приложение учёта автомобильных взвешиваний на полигоне отходов: регистрация взвешиваний, журнал, печать актов/талонов, интеграция с РЭО, импорт из Vescom, Metra и WA.

## Стек

| Слой | Технологии |
|------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Python 3.11/3.12, Flask на `127.0.0.1:5001` |
| Данные | SQLite (`BD/weighing-ГГГГ.db`), `config.ini` (`active_year`), `backup/`, `BD/.year_rotation.lock` |
| UI-кэш | `localStorage` (ключи `app_*`), синхронизация с API |
| Сборка Windows | PyInstaller + Inno Setup (`installer/`): basic `WeighingSystem-Setup.exe` (без OpenCV) и full `WeighingSystem-Full-Setup.exe` (`requirements-full.txt` + OpenCV) |

## Архитектура (кратко)

```
Браузер (React + localStorage)
        │  /api/*
        ▼
Flask (server/app.py)  ──►  config.ini (+ active_year)
                       ──►  BD/weighing-ГГГГ.db
                       ──►  backup/
                       ──►  logs/app.log
```

- Production: `npm run build` + `npm start` → один процесс Flask раздаёт `dist/` и API.
- Dev: Vite `:5173` + `npm run dev:api` (прокси `/api` → `:5001`). У `localhost:5173` и `127.0.0.1:5001` разный `localStorage`.

## Ключевые модули

**Backend (`server/`):** `app.py`, `scale_api.py`, `scale_api_guard.py`, `scale_runtime.py`, `scale_transports/serial_backend.py`, `persistence.py`, `sqlite_store.py`, `config_ini.py`, `year_context.py`, `year_rotation.py`, `archive_service.py`, `archive_edit_service.py`, `ticket_audit_stage6.py`, `stage6_logging.py`, `camera_logging.py` (structured camera/photo logs + URL redaction), `cameras.py` (HTTP/RTSP capture + capability), `photo_storage.py` (атомарная запись под `Photo/`), `ticket_photos.py` (`TicketPhotosService` + `run_phase_capture`: parallel capture, replace, F-08 stubs), `vescom.py`, `metra.py`, `wa.py`, `dictionary_import.py`, `reo_client.py`, `browse.py`, `scale_registry.py`, `scale_registry_contract.py`.

**Frontend (`src/`):** `lib/storage.ts`, `lib/storage-sync.ts`, `lib/api.ts`, `lib/cameras.ts` (типы, validation/mask URL, etalon merge/flush), `lib/photo-capture.ts` (flush→capture→upsert→flush оркестрация после persist веса), `lib/ticket-photos-preview.ts` (группировка превью / archive stubs), `lib/reo.ts`, `lib/scales.ts`, `lib/scale-runtime-client.ts`, `lib/scale-adapters/*`, `hooks/useScale.ts`, `components/ScalePanel.tsx`, `components/WeighingForm.tsx`, `components/SiteScalesSettingsSection.tsx`, `components/VideoSettingsSection.tsx` (CRUD камер + video_enabled + съёмка эталонов), `components/TicketPhotosPreview.tsx`, `components/PhotoLightbox.tsx`, `components/ScaleSetSwitchWizard.tsx` (spare: сверка эталон vs live через `postCameraSnapshot`), `components/ScaleConnectionFields.tsx`, `components/SettingsView.tsx`, `components/ArchiveView.tsx`, `components/ArchiveTicketCard.tsx`, `components/*ImportView.tsx`, `components/PrintAct.tsx`.

**Runtime smoke (`scripts/`):** `smoke_scale_api.py` (production-like smoke `/api/scales/*`), `smoke_yearly_archive.py` (сценарии `active` / `archive` / `fail-retry` / `parallel-lock` для stage-6 yearly archive; wrapper-команды `npm run smoke:stage6*`), `smoke_photo_capture.py` (stage-7 production-like smoke: `capability` / `capture-noop` / `capture-http` / `capture-degrade` / `basic-import` / `full-import`; wrappers `npm run smoke:photo*`), `run_05_resume.sh` (служебный скрипт пайплайна).

**Stage-6 test scripts (`package.json`):** `test:stage6-backend` (pytest suite миграции/ротации/архива + release-gate), `test:stage6-frontend` (vitest stage-6 включая `year-rotation-flow` / `archive-flow`), `test:stage6` (оба агрегата), `smoke:stage6` / `smoke:stage6-archive` / `smoke:stage6-fail-retry` / `smoke:stage6-parallel-lock`.

**Stage-7 test scripts (`package.json`):** `test:stage7-backend` (stub contract/skeleton + cameras roundtrip + migration/validation/rotation cameras + ticket_photos replace + capture API/HTTP/RTSP-timeout + photo_storage + video config admin + etalon API + photo-capture orchestration E2E + photos static API + camera_logging + release-gate + packaging tokens), `test:stage7-frontend` (cameras/photo-capture stub + orchestration/isolation + e2e-flow + video-settings/toggle + camera-registry-validation + etalon-capture + ticket-photos-preview + scale-switch-wizard-etalon + print-act-format), `test:stage7` (оба агрегата), `smoke:photo` / `smoke:photo-capability` / `smoke:photo-capture-noop` / `smoke:photo-capture-http` / `smoke:photo-capture-degrade` / `smoke:photo-basic-import` / `smoke:photo-full-import`, `build:win` / `build:win:full` (dual packaging).

**Stage-6 CI:** `.github/workflows/yearly-db-archive.yml` — jobs `frontend-tests`, `backend-tests`, `build`, `production-smoke`, `windows-package`, `evidence-gate` (отдельно от stage-5 `scale-adapters.yml`).

**Stage-6 evidence (`docs/reports/yearly-db-archive/`):** `yearly-archive-smoke.md`, `yearly-archive-archive.md`, `yearly-archive-fail-retry.md`, `yearly-archive-parallel-lock.md`, `yearly-archive-acceptance.md`, `release-checklist.md`.

**Stage-7 CI:** `.github/workflows/photo-capture.yml` — jobs `frontend-tests`, `backend-tests`, `build`, `import-smoke-basic`, `import-smoke-full`, `windows-package` (basic+full), `evidence-gate` (отдельно от stage-5/6).

**Stage-7 evidence (`docs/reports/photo-capture/`):** `photo-capture-acceptance.md`, `release-checklist.md`. Runbook: `docs/photo-capture-deploy.md` (backup, basic/full, migration v7, `Photo/` рядом с exe, capture/degrade, rollback, запрет секретов RTSP/бинарников в git).

## Ограничения и правила

- Не коммитить секреты, `config.ini`, `BD/`, `server/data/`, `.env*`.
- Артефакты пайплайна писать только в `docs/implementation/` (каталог в `.gitignore`).
- Сохранять существующие API-контракты из `docs/api.md`, если задача явно не меняет их.
- Python: ориентироваться на 3.11/3.12 (`fdb` может ломаться на 3.13).
- Импорт справочников: нормализация госномеров и ФИО через `dictionary_import` — не дублировать логику в обход.
- UI на русском; печатные формы и РЭО-форматы менять осторожно.

## Каталоги для пайплайна

| Путь | Назначение |
|------|------------|
| `agents/` | Промпты ролей (submodule [rdudov/agents](https://github.com/rdudov/agents)) |
| `docs/project-for-agents.md` | Этот файл — описание проекта |
| `docs/scale-adapters-deploy.md` | Runbook обновления/rollback stage 5 для scale-adapters |
| `docs/yearly-db-archive-deploy.md` | Runbook выката stage 6: миграция, ротация, rollback, smoke |
| `docs/photo-capture-deploy.md` | Runbook выката stage 7: dual basic/full, migration v7, Photo/, rollback |
| `docs/tasks/` | Постановки задач (вход оркестратора) |
| `docs/implementation/` | ТЗ, архитектура, план, статус пайплайна (не коммитить) |

## Запуск пайплайна

См. раздел «Мультиагентная разработка» в корневом README.
