# Заметки по развёртыванию: abd91a-audit-reports-security (этап 9)

Кратко для поставки на объект после этапа 9 (аудит / отчёты / безопасность). Секреты, `config.ini`, `BD/`, `.env*` в git не коммитить.

## Dual-build (базовая vs полная)

| Сборка | Состав | Поведение UI этапа 9 |
|--------|--------|----------------------|
| Базовая | без камер / `onnxruntime` / модели ANPR | Индикаторы ANPR/камер в шапке скрыты или «недоступно»; фильтры фото/ANPR работают по soft-path stubs / пустым полям |
| Полная | `video_enabled` + onnxruntime + модель ANPR вне git | Индикаторы отражают runtime; фильтры по `ticket_photos` / `anpr_status` |

Installer и dual-build подробно: корневой `README.md`, `docs/architecture.md`. Каталог `dashboard/` оркестратора в продукт не включать.

## Auth / пароли (обязательно при первом запуске)

1. При пустой таблице `users` сервер создаёт bootstrap-admin: username `admin`, пароль `admin123`, `must_change_password=1` (hash PBKDF2).
2. Первый вход → модалка смены пароля: **текущий** + новый (≥6, ≠`admin123`) + подтверждение.
3. Legacy клиентские `btoa`-hash при успешном login прозрачно перехешируются в PBKDF2.
4. Sync `app_users` **не** отдаёт и **не** принимает `passwordHash`; флаг `must_change_password` меняется только через `/api/auth/*`.

### API

| Метод | Путь | Примечание |
|-------|------|------------|
| `POST` | `/api/auth/login` | `{ username, password }` → user, profile, `must_change_password` |
| `POST` | `/api/auth/change-password` | `{ user_id, current_password, new_password }` — **current всегда обязателен** |
| `POST` | `/api/auth/register` | серверный hash; без роли admin (LAN/bootstrap) |

Контракт: `docs/api.md`. Не логировать plaintext паролей.

## БД / миграции

При старте автоматически:

- `ALTER` / DDL: `users.must_change_password INTEGER NOT NULL DEFAULT 0`.
- Таблицы `ticket_audit` / `ticket_revisions` / `site_scale_switches` — без ломающих изменений DDL (расширяется использование).
- Soft-read старых тикетов без revisions — карточка показывает «История изменений отсутствует».

Отдельной ручной миграции не требуется. Не коммитить боевую `BD/weighing.db`.

## Операционный UI (после деплоя)

- Шапка формы взвешивания: комплект + (если собрано) ANPR/камеры.
- Settings → полный журнал переключений комплекта («показать все» / scroll).
- Журнал: фильтры site / scale / role / фото / ANPR / режим / оператор; CSV с новыми колонками; история в карточке (роли `user` и `admin`).
- Архив: просмотр истории; правка — только `admin`.

## Проверки на объекте

```bash
npm run typecheck
npm test
npm run test:server
```

Минимум ручной smoke: login admin123 → смена пароля → журнал фильтры → карточка с историей → печать без источника веса.

## Ссылки

- Архитектура задачи: `docs/abd91a-audit-reports-security/architecture.md`
- Продуктовые docs: `docs/architecture.md`, `docs/api.md`, `README.md`
- Постановка: `docs/tasks/09-audit-reports-security.md`
