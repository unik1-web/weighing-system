# История изменений: 3aa7f0-yearly-db-archive

## Описание задачи

Источник: `docs/tasks/06-yearly-db-archive.md`

Цель: годовые файлы SQLite `BD/weighing-ГГГГ.db`; активный год в `config.ini`; ротация года (закрытие забытых open с `auto_closed`, перенос справочников/пользователей/`vehicle_drivers`/настроек, НЕ журнала; бэкап; нумерация с 1); архивный просмотр/перепечатка; admin-правка с audit/revisions и предупреждением при `reo_status=sent`.

Зависимости: этапы 1–3; параллельно с 4–5. Не коммитить `BD/`, бэкапы, секреты.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: зафиксированы FR1–FR9 и NFR1–NFR5 — годовые файлы и `active_year`, legacy-миграция, ротация (auto-close / REO warning / бэкап / copy сущностей / нумерация с 1), печать с датой, архивный просмотр, admin-правка с аудитом, поле `auto_closed`, регрессии этапов 1–5, тесты. Критических открытых вопросов нет.

### [Архитектура] Execution 2
- Статус: done
- Результат: модули `year_db.py` / `year_rotation.py`; путь по `active_year`; схема `auto_closed` + `ticket_revisions`; API years / rotate preview+commit / archive GET+ticket POST; UI ArchiveView + Settings блок ротации; печать «№ N от ДД.ММ.ГГГГ». Возврат в analysis не требовался.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `server/year_db.py`, `server/year_rotation.py` (NEW)
  - `server/sqlite_store.py`, `server/persistence.py`, `server/app.py` (EDIT)
  - `server/tests/conftest.py`, `test_year_db_migrate.py`, `test_year_rotation.py`, `test_archive_ticket_edit.py`
  - `src/lib/storage.ts`, `storage-sync.ts`, `year-archive.ts`, `print-date.ts`
  - `src/components/ArchiveView.tsx`, `PrintAct.tsx`, `SettingsView.tsx`, `WeighingJournal.tsx`, `App.tsx`
  - `src/lib/__tests__/print-date.test.ts`, `auto-closed-soft-read.test.ts`
  - `docs/api.md`
- Проверки: pytest 80 passed, vitest 120 passed, typecheck OK.

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: критических дефектов нет; pytest 80 / vitest print-date+auto-closed 7 / tsc OK. Три некритичных замечания (no-op version bump, UI whitelist ужее серверного, узкое окно active_year при отсутствии ключа) — не блокируют testing.

### [Тестирование] Execution 5
- Статус: done
- Результат: `npm run test:server` — 80 passed; `npm test` — 120 passed; `npm run typecheck` — OK. Покрыты FR1–FR9. Возвратов в development не было. Предложены опциональные доп. тесты (текст в output_data, на диск не писались).

### [Документация] Execution 6
- Статус: done
- Результат: созданы `docs/3aa7f0-yearly-db-archive/{architecture,changelog,issues}.md`.

## Git история

```
90fcf62 feat(year-db): yearly SQLite files, rotation, and admin archive edit
2a502b4 fix(ui): icon-only exit and switch-user header buttons
dec0391 feat(scales): pluggable adapters, TCP API, and manual weight reason
2b87538 fix(site): forbid disabling spare while active on spare
51bf122 feat(site): primary/spare scale sets and logged switching
3b2b3f8 feat(vehicle-resolve): autofill trip fields from plate and driver history
e8c7b36 feat: expand WeightSource with dictionary/default and UI visibility
fc281cf fix: dual open ticket sync loss and capture threshold mismatch (#23)
a656c06 Weighing modes: single/dual (stage 1) (#13)
bcbd371 Add WA («Весы Авто») SQL/Firebird database import. (#5)
```

Основной коммит задачи: `90fcf62` — 22 файла, +2650 / −71 строк (`server/year_db.py`, `year_rotation.py`, тесты, UI Archive/Settings, `docs/api.md` и др.).
