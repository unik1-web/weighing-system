# Архитектура: cb0fb4-anpr (этап 8)

## Обзор решения

Локальный ANPR поверх контура этапов 3/4/7: кадр overview-камеры (+ ROI) → локальный инференс на backend → предложение номера + confidence → явное подтверждение/правка/отклонение оператором → `resolveVehicle` → подстановка справочников; поля `anpr_*` / `plate_confidence` пишутся в тикет. На spare и при выключенном feature-flag движок **не вызывается** (`disabled_by_configuration`). Ошибка кадра/модели → `failed` без блокировки взвешивания.

Ключевые решения:

1. **Отдельный API `/api/anpr/*`**, а не расширение `/api/cameras/capture` — распознавание по запросу оператора, не при фиксации веса.
2. **Захват + crop ROI + инференс на backend** — RTSP/OpenCV и модель не в браузере; UI только триггерит и показывает результат.
3. **Двухуровневый выключатель**: `config.ini` `anpr_enabled` (релиз/спайк, default `false`) + runtime `site_runtime.anpr_mode` (primary/spare).
4. **Confidence = REAL 0..1** в БД/API; в UI — проценты.
5. **Движок через интерфейс** (`AnprEngine`): ONNX Runtime в полной сборке; stub/unavailable → `failed`; модель вне git.
6. **Триггер UI — кнопка «Распознать номер»** (без авто-запуска при открытии формы).

## Компоненты системы

| Компонент | Назначение |
|-----------|------------|
| `server/anpr.py` | Gate, capabilities, crop ROI, инференс, таймаут; **не** пишет тикет |
| `server/cameras.py` | Переиспользование `grab_frame` / list overview / path safety (без дублирования захвата) |
| `server/app.py` | Routes `GET/POST /api/anpr/*` |
| `server/sqlite_store.py` | Колонки тикета + ALTER + TICKET_COLUMNS |
| `server/year_rotation.py` | Новые поля в списках колонок тикета/архива при необходимости |
| `src/lib/anpr.ts` | Client: capabilities, recognize, gate helpers, типы, finalize plate_source |
| `src/lib/vehicle-resolve.ts` | Опциональный override `plate_source` после ANPR accept |
| `src/lib/storage.ts` | Soft-read полей тикета + `anpr_enabled` в AppSettings |
| `WeighingForm` | Кнопка, панель подтверждения, persist `anpr_*` |
| `SettingsView` | Тогл `anpr_enabled` + статус capabilities |
| `docs/api.md` | Контракт `/api/anpr/*` и поля тикета |
| installer | Документировать exclude `onnxruntime` для базовой сборки; models вне `_MEIPASS` |

### Зависимости

```
WeighingForm
  ├─► anpr.ts ──POST /api/anpr/recognize──► server/anpr.py
  │                                            ├─► cameras.grab_frame (overview)
  │                                            ├─► crop ROI
  │                                            └─► AnprEngine.recognize
  ├─► vehicle-resolve.resolveVehicle (+ plateSourceOverride)
  └─► TicketStorage (anpr_* stubs)

SettingsView ──► anpr_enabled (config) + GET /api/anpr/capabilities
site_runtime.anpr_mode (этап 4) ──► gate (без вызова движка на spare)
```

## Структуры данных

### TypeScript (`storage` / `anpr`)

```ts
export type AnprStatus = 'enabled' | 'disabled_by_configuration' | 'failed';
// AnprMode (site_runtime) уже = тот же набор; ticket.anpr_status — снимок на рейс.

// WeighingTicket — добавить (все soft-read, nullable):
anpr_plate_raw?: string | null;
plate_confidence?: number | null;   // 0..1
anpr_accepted?: boolean | null;
anpr_status?: AnprStatus | null;

// AppSettings:
anpr_enabled: boolean;  // default false
```

### SQLite `weighing_tickets`

| Колонка | Тип | Смысл |
|---------|-----|--------|
| `anpr_plate_raw` | TEXT NULL | Сырой номер модели |
| `plate_confidence` | REAL NULL | 0..1 |
| `anpr_accepted` | INTEGER NULL | 1/0/NULL (как `auto_closed`) |
| `anpr_status` | TEXT NULL | `enabled` \| `disabled_by_configuration` \| `failed` |

Миграция в `ensure_ticket_schema`: ALTER ADD при отсутствии; CREATE TABLE IF NOT EXISTS для новых БД — включить колонки в DDL. Обновить `TICKET_COLUMNS` и load/replace.

`plate_source` уже есть (`anpr` \| `operator` \| `directory`).

### Правила записи полей

| Сценарий | anpr_status | anpr_accepted | plate_source | raw/confidence |
|----------|-------------|---------------|--------------|----------------|
| Spare / `anpr_enabled=false` / нет overview / video off | `disabled_by_configuration` | null | resolve: directory\|operator | null |
| Recognize ok → **Принять** | `enabled` | true | `anpr` | сохранить |
| Recognize ok → **Править** | `enabled` | true | `operator` | сохранить (аудит) |
| Recognize ok → **Вручную/отклонить** | `enabled` | false | directory\|operator | сохранить raw/conf |
| Capture/model error | `failed` | false/null | directory\|operator | null |
| Primary, ANPR доступен, кнопку не жали | null (или disabled не ставить) | null | resolve | null |

При сохранении тикета клиент пишет актуальные значения state. На spare при create — выставлять `anpr_status=disabled_by_configuration` даже без вызова API.

### Gate (сервер, единый источник правды)

Движок вызывается **только** если одновременно:

1. `anpr_enabled == true` (config)
2. `video_enabled == true`
3. `site_runtime.anpr_mode == 'enabled'`
4. Есть ≥1 enabled camera `role=overview` с непустым `capture_url` для site
5. `anpr_available` (модуль/модель/рантайм загружены)

Иначе: `engine_invoked=false`, `anpr_status=disabled_by_configuration` (не `failed`).

### Модель на диске

- Каталог: `{app_root}/models/anpr/` (рядом с exe, не в `_MEIPASS`).
- Файлы модели **вне git**; добавить `/models/` в `.gitignore`.
- Конкретные имена файлов — константы в `anpr.py` (например `plate.onnx`); при отсутствии файлов → `anpr_available=false`.

## API и интерфейсы

Существующие `/api/cameras/*` и `/api/database` **не ломать**. Расширить docs/api.md.

| Метод | Путь | Тело / ответ |
|-------|------|----------------|
| `GET` | `/api/anpr/capabilities` | `{ success, anpr_available, anpr_enabled, video_enabled, engine, model_loaded, backends? }` |
| `POST` | `/api/anpr/recognize` | In: `{ site_id?, camera_id? }`. Out: см. ниже |

### `POST /api/anpr/recognize` — ответ

```json
{
  "success": true,
  "engine_invoked": false,
  "anpr_status": "disabled_by_configuration",
  "plate_raw": null,
  "confidence": null,
  "camera_id": null,
  "error": null,
  "reason": "anpr_mode=disabled_by_configuration"
}
```

Успешное распознавание:

```json
{
  "success": true,
  "engine_invoked": true,
  "anpr_status": "enabled",
  "plate_raw": "А123ВС56",
  "confidence": 0.87,
  "camera_id": "...",
  "error": null,
  "reason": null
}
```

Ошибка инференса/кадра (HTTP 200, взвешивание не блокируется):

```json
{
  "success": true,
  "engine_invoked": true,
  "anpr_status": "failed",
  "plate_raw": null,
  "confidence": null,
  "camera_id": "...",
  "error": "Таймаут захвата overview",
  "reason": null
}
```

HTTP 4xx — только невалидный ввод (например phase-подобные ошибки). Таймаут wall-clock всего recognize: **5 s** (захват ~3 s + инференс).

### Публичные функции Python

```python
def capabilities() -> dict: ...
def evaluate_gate(site_id: str) -> dict:  # allowed, anpr_status, reason, camera?
def recognize(site_id: str | None = None, camera_id: str | None = None) -> dict: ...
def crop_roi(jpeg: bytes, roi: dict | None) -> bytes: ...  # x,y,w,h ∈ [0..1]; None → весь кадр

class AnprEngine(Protocol):
    def is_available(self) -> bool: ...
    def recognize(self, jpeg: bytes) -> tuple[str, float]:  # plate_raw, confidence 0..1
```

### Клиент `src/lib/anpr.ts`

```ts
fetchAnprCapabilities(force?: boolean): Promise<AnprCapabilities>
recognizePlate(args?: { site_id?: string; camera_id?: string }): Promise<AnprRecognizeResult>
canOfferAnpr(ctx: { anpr_enabled; video_enabled; anpr_mode; hasOverview }): boolean
finalizePlateSource(decision: 'accept' | 'edit' | 'reject', resolveSource: PlateSource): PlateSource
// accept → 'anpr'; edit → 'operator'; reject → resolveSource
confidenceToPercent(c: number | null): string  // «Уверенность: N%»
```

### `resolveVehicle` расширение

```ts
resolveVehicle(
  plate: string,
  context: VehicleResolveContext,
  options?: { plateSourceOverride?: PlateSource },
): VehicleResolveResult
// если plateSourceOverride задан — он в result.plate_source;
// иначе как сейчас: directory | operator
```

После accept/edit/reject: нормализовать номер через `formatVehiclePlate`, вызвать `resolveVehicle` с override при `accept`, применить автоподстановку как сейчас в `runVehicleResolve`.

## Технологический стек

| Слой | Выбор | Обоснование |
|------|--------|-------------|
| Инференс | `onnxruntime` (опциональная зависимость полной сборки) | Локально, легче EasyOCR/Paddle; dual-build как OpenCV |
| Декод/crop JPEG | Pillow (уже есть) → fallback OpenCV если есть | Не требовать cv2 для HTTP-snapshot контура |
| Захват кадра | `cameras.grab_frame` | Без дублирования HTTP/RTSP |
| Frontend | React/TS, без новых npm-deps | Паттерн cameras.ts |
| БД | SQLite ALTER + soft-read | Как photo_* stubs |
| Модель | Вне git, pluggable `AnprEngine` | Спайк может сменить веса без смены API |

Базовая сборка: модуль `anpr.py` в репо; `anpr_available=false`; installer `excludes` для `onnxruntime` (документировать рядом с `cv2`).

## Файловая структура

```
server/anpr.py                              # NEW
server/app.py                               # EDIT — /api/anpr/*
server/cameras.py                           # EDIT — при необходимости export helpers для overview
server/sqlite_store.py                      # EDIT — columns, ALTER, DDL
server/year_rotation.py                     # EDIT — колонки тикета при копировании/архиве
server/tests/test_anpr_gate.py              # NEW
server/tests/test_anpr_recognize.py         # NEW
src/lib/anpr.ts                             # NEW
src/lib/vehicle-resolve.ts                  # EDIT — plateSourceOverride
src/lib/storage.ts                          # EDIT — ticket fields, anpr_enabled
src/lib/__tests__/anpr.test.ts              # NEW
src/lib/__tests__/vehicle-resolve.test.ts   # EDIT
src/components/WeighingForm.tsx             # EDIT — кнопка + confirm UI
src/components/SettingsView.tsx             # EDIT — anpr_enabled + caps
docs/api.md                                 # EDIT
.gitignore                                  # EDIT — /models/
installer/weighing-system.spec              # EDIT — комментарий dual-build onnx
docs/implementation/anpr-spike-checklist.md # NEW — чеклист спайка
```

Без изменений (вне скоупа): PrintAct/РЭО форматы, полный редизайн отчётов (этап 9), `dashboard/`, облако/СКУД, отдельная long-focus камера на spare.

## UI-поток (WeighingForm)

1. При открытии: capabilities + client gate → показать кнопку «Распознать номер» только если gate допускает **или** caps говорят, что feature включён на primary (на spare кнопку скрыть/disabled с подсказкой «ANPR отключён на резерве»).
2. Клик → loading → `recognizePlate` → панель: номер, «Уверенность: N%», кнопки **Принять** / **Править** / **Ввести вручную**.
3. Принять: `vehicleNumber = formatVehiclePlate(raw)`, `anpr_accepted=true`, override `anpr`, resolve.
4. Править: input prefilled → confirm → `operator`, `anpr_accepted=true`, resolve.
5. Вручную: закрыть панель, обычный ввод; `anpr_accepted=false`; raw/conf сохранить если были.
6. Сохранение веса/тикета **не ждёт** ANPR; ошибка recognize → toast/статус `failed`, ручной ввод.

Текст UI — русский.

## Settings

- Чекбокс «Распознавание номеров (ANPR)» → `anpr_enabled` в config (рядом с `video_enabled`).
- Строка статуса: «Модель: загружена / недоступна (полная сборка)».
- Default `anpr_enabled=false` до спайка ≥ 50%.

## Тесты (ориентир для development / testing)

- Gate: spare → `engine_invoked=false`, status `disabled_by_configuration`; mock engine не вызван.
- `anpr_enabled=false` / `video_enabled=false` / нет overview — то же.
- Fake engine ok → plate + confidence; raise → `failed`.
- Client: accept/edit/reject → `plate_source` / `anpr_accepted`.
- Soft-read старых тикетов без колонок.
- Регрессии: cameras capture, primary/spare switch, resolveVehicle без ANPR, single/dual.

## Открытые решения (рекомендации зафиксированы)

| Вопрос | Решение |
|--------|---------|
| Движок | ONNX Runtime + pluggable engine; stub без модели |
| Confidence | 0..1 REAL; UI % |
| UX-триггер | Только кнопка «Распознать номер» |
| Feature flag | `anpr_enabled` в config.ini + Settings; default false |
| ROI | Crop на backend до инференса |
| Конкретные веса модели | Вне скоупа кода; поставка `models/anpr/`; спайк выбирает/меняет файл |

## Статус реализации

Реализация и тесты этапа 8 завершены (см. `changelog.md`, `issues.md`, `deploy-notes.md`). Чеклист спайка на объекте: `docs/implementation/anpr-spike-checklist.md`. Следующий этап roadmap: **09** (аудит / отчёты / безопасность).
