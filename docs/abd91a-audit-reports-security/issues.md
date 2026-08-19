# Реестр проблем: abd91a-audit-reports-security

## Итог

Задача завершена. Зафиксировано проблем: **2** (возврат code-review → development на auth). Остальные этапы без возвратов.

## Проблемы в процессе разработки

### ISSUE-1: Неаутентифицированный сброс пароля при must_change=1

- **Этап**: code-review (execution 4) → development (execution 5)
- **Описание**: `POST /api/auth/change-password` при `must_change_password=1` принимал только `user_id` + `new_password`. `user_id` bootstrap-admin доступен через `GET /api/database` (`app_users`). Клиент в LAN мог сменить пароль до первого входа оператора.
- **Решение**: всегда требовать `current_password` и `verify_password` против stored hash (в т.ч. при force-change). В `ForceChangePasswordModal` — поле «Текущий пароль». Тесты: `test_change_password_requires_current_even_with_public_user_id`, `test_bootstrap_admin_and_force_change`.
- **Execution**: #4 → #5; подтверждено Approve в #6

### ISSUE-2: Клиентский sync сбрасывает must_change_password

- **Этап**: code-review (execution 4) → development (execution 5)
- **Описание**: `_replace_users` писал `mustChangePassword` с клиента. Можно было выставить `false`, сохранив hash от `admin123`, и обойти ForceChangePasswordModal при уже открытой сессии.
- **Решение**: флаг server-owned — `_replace_users` всегда берёт `existing_flags`; клиентский clear игнорируется. Тест: `test_sync_cannot_clear_must_change_password`.
- **Execution**: #4 → #5; подтверждено Approve в #6

## Замечания код-ревью

Некритичные (Approve после fix, as-is / вне минимума):

1. **`POST /api/auth/register` без роли admin** — ожидаемо для LAN/bootstrap; после появления admin ограничение ролью — вне минимума этапа 9.
2. **Gate `mustChangePassword` только на клиенте** — API журнала/БД не блокируются флагом; приемлемо для текущего threat model после закрытия ISSUE-1/2.
3. **`TicketHistoryPanel` группирует revisions по точному `at`** — ок при общей метке из `TicketStorage.update`; при рассинхроне orphan-строки уже обработаны.

## Проблемы тестирования

Возвратов testing → development не было. Suite зелёный на момент приёмки:

- Frontend: 136 passed (`npm test`); typecheck OK.
- Backend: 112 passed (`npm run test:server`), в т.ч. auth/archive и регрессии.

Некритичные пробелы покрытия (предложены тестировщиком, не блокируют):

1. Unit: `scaleId` + AND-комбинация групп в `journal-filters.test.ts`.
2. API: `test_login_wrong_password` → 401.

## Известные ограничения (продукт)

- ReportsView: сводки по site/scale/photo/ANPR — вне минимума этапа 9 (приоритет журнал/CSV/карточка).
- Logout всех сессий при смене пароля — не требуется в минимуме.
- Печатные формы: источник веса по-прежнему не выводится.
- Базовая сборка: индикаторы ANPR/камер скрыты или «недоступно» без ошибок.
