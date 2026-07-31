# Acceptance report: yearly DB archive (stage 6)

| ID | Status | Evidence | Note |
|---|---|---|---|
| EC-01 | PASS | `server/persistence.py`, `server/sqlite_store.py`, `config.ini` + `BD/weighing-YYYY.db` | Стек SQLite + config.ini сохранён. |
| EC-02 | PASS | `server/year_context.py`, `server/tests/test_active_year_service.py` | Доступ к БД через selector `db_path/year`. |
| EC-03 | PASS | `server/tests/test_stage6_migration.py`, `server/tests/test_stage6_primary_migration.py` | Mixed legacy → один `weighing-ГГГГ.db`. |
| EC-04 | PASS | `src/lib/__tests__/archive-flow.test.tsx`, `src/lib/__tests__/archive-read-flow.test.ts`, smoke `archive` | Год архива по имени файла; mixed legacy warning. |
| EC-05 | PASS | `src/hooks/useAuth.tsx`, `src/App.tsx`, `src/lib/__tests__/year-rotation-flow.test.ts` | Авто-ротация при входе, если календарный год > `active_year`. |
| EC-06 | PASS | `server/tests/test_stage6_rotation.py` (`test_tf05_*`), `docs/reports/yearly-db-archive/yearly-archive-parallel-lock.md` | Single-flight lock + `409 rotation_in_progress`. |
| EC-07 | PASS | `server/tests/test_stage6_rotation.py` (TF-02/TF-04), smoke `fail-retry` | Backup до переключения `active_year`. |
| EC-08 | PASS | `server/tests/test_stage6_rotation.py` (`test_tf04_*`), `docs/reports/yearly-db-archive/yearly-archive-fail-retry.md` | `.tmp` target, безопасный retry без ручной чистки. |
| EC-09 | PASS | `server/tests/test_stage6_rotation.py` (`test_deny_by_default_*`, TF-02) | Запрещённые таблицы/ключи не публикуются в новый год. |
| EC-10 | PASS | `src/App.tsx` (`useYearRotation(signOut)`), `src/lib/__tests__/year-rotation-flow.test.ts`, `yearly-archive-stub-flow.test.ts` | Успешный commit → logout / повторный вход. |
| EC-11 | PASS | `server/tests/test_stage6_archive_edit.py`, smoke `archive` forbidden branch | Whitelist UC-05; `reo_status` не меняется. |
| EC-12 | PASS | `server/tests/test_archive_edit_flow.py`, smoke `archive` sent-REO | `archive_reo_sent_warning` + `reo_divergence_warning`. |
| EC-13 | PASS | `server/tests/test_archive_read_flow.py`, smoke `archive` | Archive read/edit не пишут в active year. |
| EC-14 | PASS | `docs/api.md`, `scripts/smoke_yearly_archive.py`, `docs/reports/yearly-db-archive/*` | API-контракты и evidence stage 6. |
| TF-01 | PASS | `server/tests/test_stage6_migration.py` | Mixed legacy migration. |
| TF-02 | PASS | `server/tests/test_stage6_rotation.py`, smoke `active` | Rotation preview/commit. |
| TF-03 | PASS | `server/tests/test_stage6_archive_edit.py`, smoke `archive` | Archive edit with sent REO. |
| TF-04 | PASS | `docs/reports/yearly-db-archive/yearly-archive-fail-retry.md` | Fail/retry после backup. |
| TF-05 | PASS | `docs/reports/yearly-db-archive/yearly-archive-parallel-lock.md` | Parallel rotation lock. |

## Runtime smoke

| Scenario | Status | Report |
|---|---|---|
| active | PASS | `yearly-archive-smoke.md` / `.json` |
| archive | PASS | `yearly-archive-archive.md` / `.json` |
| fail-retry | PASS | `yearly-archive-fail-retry.md` / `.json` |
| parallel-lock | PASS | `yearly-archive-parallel-lock.md` / `.json` |

## Ограничения среды / ручные проверки

- Полный UI-smoke (`single`/`dual`/печать/РЭО/импорты) после `npm run build && npm start` остаётся ручным checklist в `yearly-archive-smoke.md`.
- `fail-retry` / `parallel-lock` используют изолированный HTTP-server с test hooks inject (реальные маршруты `server/app.py`, без мутации live `BD/`).
