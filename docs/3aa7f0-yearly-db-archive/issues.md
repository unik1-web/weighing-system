# Реестр проблем: 3aa7f0-yearly-db-archive

## Итог

Задача завершена. Зафиксировано проблем: 0 возвратов по FSM. Некритичных замечаний код-ревью: 3 (не блокировали testing).

Задача прошла все этапы без возвратов.

## Проблемы в процессе разработки

Возвратов analysis ← architect, architect ← development, development ← code-review, development ← testing не было. Pipeline: analysis → architect → development → code-review (Approve) → testing → tech-writer.

## Замечания код-ревью

Источник: execution 4 (code-review, Approve). Некритичные, для сведения.

### ISSUE-1: No-op bump version при archive edit

- **Этап**: code-review (замечание, без возврата)
- **Описание**: `update_archive_ticket` всегда инкрементирует `version` и пишет `ticket_audit` action `updated`, даже если ни одно поле из whitelist фактически не изменилось.
- **Решение**: не исправлялось в рамках этапа 6; рекомендация — early-return без side effects при отсутствии реальных изменений. Опциональный тест после фикса.
- **Execution**: #4

### ISSUE-2: UI archive edit ужее серверного whitelist

- **Этап**: code-review (замечание, без возврата)
- **Описание**: UI правки архива ограничен notes/driver/vehicle; серверный whitelist шире (веса, контрагенты, dates, cargo, price, vat, status и др.).
- **Решение**: для этапа 6 признано достаточным; расширение полей UI — по желанию позже.
- **Execution**: #4

### ISSUE-3: Узкое окно записи active_year через config

- **Этап**: code-review (замечание, без возврата)
- **Описание**: `write_config` блокирует смену `active_year` только если ключ уже валиден; при отсутствии ключа клиент теоретически может записать `active_year` в обход rotate.
- **Решение**: не блокировало приёмку; после `resolve_active_year` окно обычно закрыто. Рекомендация тестировщика — тест `test_write_config_rejects_active_year_change`; усиление guard — strip/ignore входящего `active_year` всегда.
- **Execution**: #4, #5

## Проблемы тестирования

Возвратов testing → development не было. Все suite зелёные:

| Suite | Результат |
|-------|-----------|
| `npm run test:server` | 80 passed |
| `npm test` | 120 passed |
| `npm run typecheck` | OK |

Опциональные доп. тесты (tara_default fallback, copy `site_runtime`, calendar year при migrate без дат, archive 404) предложены тестировщиком текстом в output_data execution 5 и на диск не записывались.
