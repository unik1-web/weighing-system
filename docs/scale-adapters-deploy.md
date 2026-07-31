# Развёртывание scale-adapters (stage 5)

## Предусловия
- Python `3.11` или `3.12`
- Установлены зависимости `server/requirements.txt` (включая `pyserial`)
- Остановлены все процессы приложения перед обновлением (`npm start`, `WeighingSystem.exe`)
- Есть доступ к каталогу приложения с файлами `config.ini` и `BD/weighing.db`

## Backup перед обновлением
1. Скопировать `config.ini` в безопасное место.
2. Скопировать `BD/weighing.db` в безопасное место.
3. Зафиксировать, что backup хранится как согласованная пара (один момент времени).

Рекомендуемое имя:
- `config.pre-stage5.ini`
- `weighing.pre-stage5.db`

## Порядок обновления и миграции `schema_version = 5`
1. Обновить код приложения и зависимости:
   - `pip install -r server/requirements.txt`
2. Запустить приложение (`npm start` для локального режима, либо `WeighingSystem.exe` для packaged runtime).
3. На первом старте выполняется migration stage 5:
   - backup `config.ini` -> `backup/config.stage5.bak.ini` (если ещё не создан),
   - backup `BD/weighing.db` -> `backup/weighing.stage5.bak.db` (если ещё не создан),
   - SQL migration add-only:
     - добавление `manual_weight_reason` в `weighing_tickets` (если колонки нет),
     - `PRAGMA user_version = 5`,
   - config migration:
     - добавление `manual_weight_reason_policy=optional`, если ключ отсутствует,
   - post-check:
     - колонка `manual_weight_reason` существует,
     - `PRAGMA user_version >= 5`,
     - `manual_weight_reason_policy` присутствует в `config.ini`.
4. Повторный запуск безопасен: миграция идемпотентна, destructive rebuild не используется.

## Проверка настроек `primary/spare` и transport
1. Открыть настройки площадки.
2. Проверить заполнение `primary` и `spare`:
   - `adapter_id`,
   - `connection.transport`,
   - параметры `serial_backend` для backend-чтения.
3. Для активного комплекта проверить соответствие expected контекста:
   - `site_id`,
   - `scale_id`,
   - `scale_role`.

## Smoke для локального backend (`serial_backend`)
1. Запустить `npm start`.
2. Выполнить:
   - `python scripts/smoke_scale_api.py --base-url http://127.0.0.1:5001 --origin http://127.0.0.1:5001 --expected-site-id default-site --expected-scale-id scale-primary --expected-scale-role primary`
3. Проверить прохождение последовательности:
   - `connect -> status -> read -> disconnect`.

## Smoke для Windows `.exe`
1. Собрать пакет: `npm run build:win` (или `npm run build:win:exe`).
2. Запустить `dist/WeighingSystem/WeighingSystem.exe`.
3. Повторить smoke `/api/scales/*` через `scripts/smoke_scale_api.py`.
4. Убедиться, что используется backend-path (`serial_backend`), а не браузерный Web Serial.

## Действия при ошибках runtime

### `manual_only`
- Причина: ошибка чтения/подключения или недоступный backend.
- Действие: продолжить ручной ввод веса, заполнить `manual_weight_reason` по policy.
- Проверка: сохранение талона не блокируется.

### `stale_session`
- Причина: переключение активного комплекта `primary/spare` во время/после открытия сессии.
- Действие:
  1. Закрыть старую сессию (или игнорировать устаревший `session_id`),
  2. Выполнить новый `connect` с актуальным `expected_*`.

### `unsupported_transport`
- Причина: выбран transport, не поддерживаемый этим релизом (например, `tcp_client`).
- Действие:
  1. Переключить transport на `web_serial` или `serial_backend`,
  2. Повторить `connect/read`,
  3. До перенастройки использовать ручной ввод.

## Rollback
1. Остановить приложение.
2. Восстановить backup-пару:
   - `config.pre-stage5.ini` -> `config.ini`
   - `weighing.pre-stage5.db` -> `BD/weighing.db`
3. Запустить старую версию приложения.
4. Проверить:
   - чтение `/api/config`, `/api/database`, `/api/storage` без ошибок,
   - доступность ручного ввода,
   - корректное чтение существующих талонов.

## Recovery после частичного сбоя миграции
- Ошибка до SQL `COMMIT`: повторный старт выполнит migration повторно, БД остаётся в консистентном состоянии.
- Ошибка после SQL migration и до config-step: повторный старт завершит недостающий config-step (`manual_weight_reason_policy`) без повторного DDL.
- Если post-check не проходит, выполнить rollback согласованной пары `config.ini + BD/weighing.db`.
