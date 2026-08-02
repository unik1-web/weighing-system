# Заметки по развёртыванию: cb0fb4-anpr (этап 8)

Кратко для поставки на объект. Секреты, `config.ini`, `BD/`, кадры с номерами в git не коммитить.

## Dual-build

| Сборка | Зависимости | Поведение ANPR |
|--------|-------------|----------------|
| Базовая | без `onnxruntime` / без модели | `anpr_available=false`; gate → `disabled_by_configuration`; ручной ввод |
| Полная | optional `onnxruntime` + файлы модели | инференс после включения флага и спайка |

Installer (`installer/weighing-system.spec`): `hiddenimport anpr`; для базовой сборки — `excludes` с `onnxruntime` (аналогично `cv2`). Модуль `anpr.py` всегда в репо и деградирует без deps.

## Модель

- Путь: `{app_root}/models/anpr/plate.onnx` (рядом с exe, **не** в `_MEIPASS`, **не** в git).
- Каталог `/models/` в `.gitignore`.
- Пока I/O конкретной модели не привязан после спайка — даже при наличии файла recognize может вернуть `failed` с понятным сообщением; stub без файла → движок не вызывается.

## Config / runtime

| Ключ | Где | Default | Смысл |
|------|-----|---------|--------|
| `anpr_enabled` | `config.ini` / Settings | `false` | Глобальный релизный выключатель |
| `video_enabled` | config | `false` | Нужен для gate (overview) |
| `site_runtime.anpr_mode` | runtime (этап 4) | primary: `enabled`; spare: `disabled_by_configuration` | На резерве движок не зовётся |

Включать `anpr_enabled=true` в прод **только** после спайка с accuracy ≥ 50% — чеклист: `docs/implementation/anpr-spike-checklist.md`.

## Предпосылки на площадке

1. Полная сборка + модель в `models/anpr/`.
2. `video_enabled=true`, камера `role=overview` с `capture_url`, ROI на зону номера.
3. Active set = **primary** (`anpr_mode=enabled`).
4. После спайка — тогл «Распознавание номеров (ANPR)» в Settings.

## API (кратко)

- `GET /api/anpr/capabilities` — доступность / флаги / модель.
- `POST /api/anpr/recognize` — захват overview + crop + инференс; HTTP 200 при failed/disabled; тикет не пишет сервер.

Контракт: `docs/api.md` (раздел ANPR). Архитектура: `docs/cb0fb4-anpr/architecture.md`.

## БД

При старте ALTER / DDL добавляют nullable: `anpr_plate_raw`, `plate_confidence`, `anpr_accepted`, `anpr_status`. Soft-read старых тикетов без колонок. Отдельной ручной миграции не требуется.
