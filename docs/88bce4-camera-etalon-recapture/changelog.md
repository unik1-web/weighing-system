# История изменений: 88bce4-camera-etalon-recapture

## Описание задачи

Источник: `docs/tasks/13-camera-etalon-recapture.md`.

Повторно снимать/обновлять эталоны primary и spare в настройках камеры без удаления и пересоздания камеры; обновлять превью после успеха; понятные ошибки при сбое снимка. Не ломать wizard primary/spare и сверку с эталоном.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR1–FR7 (пересъём primary/spare, flush перед reference, cache-bust превью, локальные ошибки, wizard, идемпотентность) и NFR1–NFR6 (контракты API, sync, DB lock, UX, path safety, тесты). Корневые причины: нет flush, стабильный path без bust, ошибка у нижней кнопки Save.

### [Архитектура] Execution 2
- Статус: done
- Результат: flush в `saveReference` + опц. `capture_url`/`capture_kind` в body; рефактор `save_reference` (grab вне lock); `photoUrl` + `no-store`; локальный feedback и `refBust` в SettingsView; wizard bust на open; тесты overwrite / flush / Cache-Control. Схема БД без изменений.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы:
  - `server/cameras.py`
  - `server/app.py`
  - `docs/api.md`
  - `src/lib/cameras.ts`
  - `src/components/SettingsView.tsx`
  - `src/components/CameraSetupPreview.tsx`
  - `src/components/SpareSwitchWizard.tsx`
  - `server/tests/test_cameras_reference.py`
  - `src/lib/__tests__/cameras.test.ts`
- Проверки: typecheck OK; Vitest cameras.test.ts 15 passed; pytest suite OK. Ветка `cursor/camera-etalon-recapture-ff30`, commit `1dc1f96`.

### [Код-ревью] Execution 4
- Статус: done (Approve)
- Результат: соответствие архитектуре и FR/NFR подтверждено; секреты/`config.ini`/`BD/` в диффе нет. Некритичные замечания зафиксированы (см. `issues.md`). Следующий этап: testing.

### [Тестирование] Execution 5
- Статус: done
- Результат: typecheck OK; Vitest 156 passed (cameras.test.ts 15); pytest `test_cameras_reference.py` 4 passed (overwrite, optional URL, missing camera, Cache-Control). Файлы тестов не менялись. Предложены доп. кейсы (empty URL, invalid mode, spare overwrite, flush reject) текстом — на диск не писались. Следующий этап: tech-writer.

### [Документация] Execution 6
- Статус: done
- Результат: созданы `architecture.md`, `changelog.md`, `issues.md` в `docs/88bce4-camera-etalon-recapture/`.

## Git история

```
1dc1f96 fix(cameras): reliable etalon recapture with cache-bust and flush
```

Затронутые файлы реализации в коммите `1dc1f96` (+ связанные правки TaskBoard/`docs/api.md`):

```
docs/api.md                            |   4 +-
server/app.py                          |  13 +++-
server/cameras.py                      |  37 +++++++---
server/tests/test_cameras_reference.py | 129 +++++++++++++++++++++++++++++++++
src/components/CameraSetupPreview.tsx  |   7 +-
src/components/SettingsView.tsx        |  98 +++++++++++++-------------
src/components/SpareSwitchWizard.tsx   |   5 +-
src/lib/__tests__/cameras.test.ts      |  44 +++++++++++
src/lib/cameras.ts                     |  38 +++++++++-
```

Смежная история по тем же путям (фрагмент `git log --oneline -20`):

```
1dc1f96 fix(cameras): reliable etalon recapture with cache-bust and flush
646426c feat(weighing): hide model/COM on ScalePanel, spare serial in Settings
38f6f6c merge: bring serial COM transport into camera release line
07dd397 fix(cameras): RTSP empty-password URL, TCP transport, longer open timeout
05e80ab feat(cameras): IQR/ONVIF snapshot via GetSnapshotUri and OEM paths
bbc63ca feat(cameras): camera URL discovery by IP/brand templates (stage 11)
e43fbd7 feat(cameras): settings preview window for camera setup
4d08755 feat(ops): stage 09 audit, reports, docs, security (abd91a)
```
