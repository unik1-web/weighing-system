# Реестр проблем: 20e99b-scale-adapters

## Итог

Задача завершена. Зафиксировано проблем: 0 (возвратов между этапами не было). Код-ревью сразу Approve; тестирование прошло без возвратов в development.

## Проблемы в процессе разработки

Задача прошла все этапы без возвратов.

## Замечания код-ревью

### Execution 4 (Approve) — некритичные (для сведения)

- [`src/lib/scales/session.ts`] при отмене/ошибке Web Serial open остаются `adapterId`/`transport` без cleanup (`connected=false`) — желателен try/finally с откатом; happy-path не ломает.
- [`SettingsView`] у spare нет UI parity/dataBits/stopBits/lineTerminator/serialPath (есть у primary); для 4 профилей хватает defaults `connectionFromDevice`.
- Поле причины видно при `source===manual` даже с пустыми весами (дефолт source=manual); валидация `required` корректно смотрит на наличие веса.

## Проблемы тестирования

Возвратов testing → development не было. Execution 5: все проверки зелёные (Vitest 113, pytest 68). Некритичные замечания code-review не воспроизведены как failing tests.

Опциональные усиления покрытия предложены текстом в `output_data` тестировщика (registry framing, Python↔JS parity parsers, доп. кейсы `manual-weight-reason`) и на диск не записывались — не блокеры приёмки. UI E2E (ScalePanel Web Serial, Settings regex editor) в репозитории нет — для MVP достаточно unit/API.
