# История изменений: 37cc69-photo-capture

## Описание задачи

Источник: `docs/tasks/07-photo-capture.md`.

Цель: фотофиксация IP/RTSP (полная сборка): `video_enabled`, реестр 1–4 камер (role entry|exit|overview), снимок при фиксации брутто/тары, файлы на диске (`Photo/` или `BD/photos`), метаданные `ticket_photos`, превью в форме и журнале; graceful degrade без блокировки взвешивания; эталоны primary/spare для wizard; базовая сборка без тяжёлых deps.

Зависимости: этап 4 (camera_mode/площадка), желательно 5. Вне скоупа: ANPR. Не коммитить RTSP-секреты и бинарники фото.

## Хронология разработки

### [Анализ] Execution 1
- Статус: done
- Результат: FR1–FR11 и NFR1–NFR6 — включение видео / dual-build, реестр камер, эталоны primary/spare, захват при фиксации брутто/тары, graceful degrade, хранение JPEG на диске, `ticket_photos` + stubs, UI превью, связь с годовой БД, регрессии и тесты. Рекомендации архитектору: раскладка A (`Photo/ГГГГ/ММ/ДД`), захват в момент фиксации веса, stubs = latest ok по role.

### [Архитектура] Execution 2
- Статус: done
- Результат: модуль `server/cameras.py`, таблицы `cameras`/`ticket_photos`, API `/api/cameras/*`, sync-ключи `app_cameras`/`app_ticket_photos`, `video_enabled` в config, UI Settings/Wizard/Form/Journal + `TicketPhotoPreview`, ротация года с копированием cameras. Возврат в analysis не требуется.

### [Разработка] Execution 3
- Статус: done
- Реализованные файлы: `server/cameras.py`, `sqlite_store.py`, `year_rotation.py`, `app.py`, тесты cameras/photo_path/year_rotation, `src/lib/cameras.ts`, `storage.ts`, компоненты Settings/Wizard/Form/Journal/`TicketPhotoPreview`, `docs/api.md`, `.gitignore` (`/Photo/`), `installer/weighing-system.spec`. Проверки: typecheck OK, pytest 88 passed (на момент первого прогона).

### [Код-ревью] Execution 4
- Статус: done (Request Changes → возврат в development)
- Результат: критические FK при replace tickets/sites после появления `ticket_photos`/`cameras`; серьёзное — нет жёсткого wall-clock timeout на capture. К testing нельзя до фиксов.

### [Разработка] Execution 5
- Статус: done
- Реализованные файлы: `server/sqlite_store.py` (FK-safe delete order), `server/cameras.py` (CAPTURE_WALL_CLOCK=6s), тесты sync-after-capture / double full sync / wall-clock timeout. pytest cameras: 8 passed; suite: 91 passed.

### [Код-ревью] Execution 6
- Статус: done (Approve)
- Результат: критические замечания execution 4 закрыты; некритичные (коллизия имён JPEG, background RTSP после shutdown) зафиксированы для сведения. Переход к testing.

### [Тестирование] Execution 7
- Статус: done
- Результат: `npm run test:server` — **91 passed**; Vitest — **126 passed**; typecheck OK. Покрыты FR1–FR11 / NFR по degrade, path safety, year rotation, FK sync, wall-clock. Предложены опциональные доп. тесты (reference API, stubs не затираются failed) — на диск не записывались, не блокируют.

### [Документация] Execution 8
- Статус: done
- Результат: созданы `docs/37cc69-photo-capture/{architecture,changelog,issues}.md`.

## Git история

```
a41bc4e fix(cameras): FK-safe database replace and capture wall-clock timeout
abc2d8b feat(cameras): photo capture on weigh with graceful degrade
```

Коммит `abc2d8b`: 20 файлов, +2261/−9 — базовая реализация фотофиксации.

Коммит `a41bc4e`: `cameras.py`, `sqlite_store.py`, `test_cameras_capture.py` — FK-safe replace и wall-clock timeout (+206/−8).
