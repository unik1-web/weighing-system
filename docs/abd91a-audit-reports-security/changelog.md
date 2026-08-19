# История изменений: abd91a-audit-reports-security

## Описание задачи

Источник: `docs/tasks/09-audit-reports-security.md` (этап 9 roadmap).

Цель: режим площадки в шапке формы (primary/spare, ANPR, камеры); полный журнал переключений комплекта; полный `ticket_audit` / `ticket_revisions` (активный год + архив) и история в карточке; расширенные фильтры/CSV/карточка журнала (площадка, весы, источники веса, фото, ANPR, режим, оператор); актуальные `docs/architecture.md`, `docs/api.md`, README (dual-build); серверный PBKDF2 hash паролей, принудительная смена дефолтного admin, миграция legacy `btoa`.

Зависимости: этапы 1–8 по факту. Вне скоупа: OAuth, источник веса на печати, сводки ReportsView по новым измерениям, logout всех сессий при смене пароля.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR1–FR11 / NFR1–NFR5 — индикатор шапки, полный switch-history, audit+revisions (активный год + архив), история в карточке (просмотр user+admin), фильтры/CSV, docs+dual-build, PBKDF2 auth + must_change + legacy upgrade, регрессии/тесты. Критических открытых вопросов нет.

### [Архитектура] Execution 2
- Статус: done
- Результат: единая модель `ticket_audit`+`ticket_revisions`; auth PBKDF2 + `/api/auth/login|change-password|register`; `must_change_password`; клиентские фильтры; graceful ANPR/камеры; артефакт `docs/abd91a-audit-reports-security/architecture.md`. Возврат в analysis не требуется.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы: `server/auth_passwords.py`, `server/app.py` (auth routes), `server/sqlite_store.py`, `server/year_rotation.py`, тесты auth/archive; `src/lib/auth-api.ts`, `ticket-audit-fields.ts`, `journal-filters.ts`, `storage.ts` (TicketRevisionStorage + revisions в update), `api.ts` (redaction паролей), `useAuth.tsx`, `ForceChangePasswordModal`, `TicketHistoryPanel`, правки WeighingForm/SettingsView/WeighingJournal/ArchiveView/App; `docs/architecture.md`, `docs/api.md`, `README.md`. Проверки: typecheck OK; vitest 136; pytest 109.

### [Код-ревью] Execution 4
- Статус: done (Request Changes → development)
- Результат: критическая дыра — `change-password` при `must_change=1` без `current_password` (LAN takeover по публичному `user_id`); серьёзная — sync `_replace_users` может сбросить `mustChangePassword`. Некритично: открытый register, client-only UI gate.

### [Разработка] Execution 5 (auth rework)
- Статус: done
- Реализованные файлы: `server/app.py` (всегда `current_password`), `server/sqlite_store.py` (server-owned flag), `ForceChangePasswordModal` (+ текущий пароль), `useAuth`/`auth-api`, тесты атак, правки `docs/api.md` / `docs/architecture.md`. Pytest auth suite: 112 passed.

### [Код-ревью] Execution 6
- Статус: done (Approve)
- Результат: critical/serious закрыты; spot-check этап 09 (audit, фильтры, шапка, switch history, PrintAct без источника веса) — ok. Переход к testing.

### [Тестирование] Execution 7
- Статус: done
- Результат: vitest **136 passed**; typecheck OK; pytest **112 passed**. Покрыты FR3–6, FR8–11 / NFR1 (hash, force-change, sync-bypass, filters, revisions, archive no-op, регрессии). Опциональные доп. тесты предложены текстом, на диск не писались.

### [Документация] Execution 8
- Статус: done
- Результат: `docs/abd91a-audit-reports-security/{architecture,changelog,issues,deploy-notes}.md`; точка продолжения в `docs/tasks/README.md` — этап 09 выполнен, очередь roadmap закрыта.

## Git история

```
f2db6a7 fix(auth): require current password; protect mustChangePassword
ab7b70b feat(ops): audit trail, journal filters, and server password hash
3c786e7 docs(ops): architecture for stage 09 (abd91a)
b27ef5e chore(orchestrator): add abd91a-audit-reports-security for stage 09
```

Коммит `3c786e7`: архитектурный документ этапа 9.

Коммит `ab7b70b`: 26 файлов, +2059/−120 — auth, audit/revisions, фильтры/CSV/карточка, индикатор шапки, switch history, docs/README.

Коммит `f2db6a7`: 9 файлов, +170/−20 — закрытие auth-дыр (current_password always + server-owned `must_change_password`).
