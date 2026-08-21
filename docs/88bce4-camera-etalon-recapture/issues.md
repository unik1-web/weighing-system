# Реестр проблем: 88bce4-camera-etalon-recapture

## Итог

Задача завершена. Зафиксировано проблем: 0 возвратов по FSM. Некритичные замечания код-ревью: 3 (для сведения, без возврата в development).

Задача прошла все этапы без возвратов.

## Проблемы в процессе разработки

Возвратов analysis ↔ architect, architect ↔ development, code-review → development или testing → development не было. Executions 1–5 закрыты со `status: done`.

## Замечания код-ревью

Из execution 4 (Approve, некритичные):

1. **Первый показ refs без bust** — до первого пересъёма в сессии превью опирается на `Cache-Control: no-store`; после пересъёма `refBust` обязателен. Соответствует дизайну.
2. **SpareSwitchWizard** — bust только на mount/open; при уже открытом wizard после пересъёма нужен повторный вход. Как в архитектуре.
3. **Гонка delete между grab и UPDATE** — если камеру удалят между `grab_frame` и UPDATE, `fetchone` может вернуть `None`; редкий edge case, не блокер этой задачи.

## Проблемы тестирования

Упавших тестов и возвратов из testing не было.

Запуск (ветка `cursor/camera-etalon-recapture-ff30` @ `1dc1f96`):

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | OK |
| `npm test` | 19 files, 156 passed |
| `npm test -- src/lib/__tests__/cameras.test.ts` | 15 passed |
| `pytest server/tests/test_cameras_reference.py -v` | 4 passed |

Тестировщик предложил доп. сценарии (empty URL → 400, invalid mode, spare overwrite, flush reject → skip post) текстом в `output_data`; на диск suite не расширялся.
