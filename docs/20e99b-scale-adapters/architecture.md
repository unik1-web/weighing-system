# Архитектура: 20e99b-scale-adapters

## Обзор

Этап 5 roadmap weighing-system: pluggable `ScaleAdapter` поверх существующего Web Serial happy-path, расширение `scales.connection` (transport + custom-parse), параллельный backend-путь `/api/scales/*` с реализованным транспортом TCP, адаптер `custom` (regex/маска), поле талона `manual_weight_reason` и настройка `manual_weight_reason_mode` (default `optional`).

Доработка существующего React + Flask + SQLite. Браузерный Web Serial остаётся основным UI-путём; backend I/O — для exe / среды без Web Serial, не заменяет UI в MVP. Источник истины при connect — `getActiveScaleContext().activeScale` (`adapter_id` + `connection`).

## Компоненты

```
SettingsView / ScalePanel / WeighingForm
        │
        ▼
useScale ──► ScaleSession (singleton)
        │         │
        │         ├── getAdapter(adapter_id)  → ScaleAdapter.parseFrame
        │         └── Transport factory
        │               ├── WebSerialTransport (browser)
        │               └── BackendScaleClient → /api/scales/* (serial|tcp)
        │
getActiveScaleContext() ──► adapter_id + connection (source of truth)
        │
switchScaleSet / site-runtime-updated ──► Session.disconnect() + UI reconnect hint

Flask /api/scales/*
        │
        ▼
ScaleBackendSession (process singleton, thread-safe)
        ├── TcpScaleTransport (реализован)
        ├── SerialScaleTransport (stub → 501)
        └── parsers (mirror frontend: built-in + custom regex)
```

| Компонент | Назначение |
|-----------|------------|
| `src/lib/scales/types.ts` | `ScaleReading`, `ScaleAdapterId`, connection/transport типы, ошибки |
| `src/lib/scales/adapters/*` | 4 встроенных + `custom`; реестр через `registry.ts` |
| `src/lib/scales/parse.ts` | `parseUniversalFrame` + `parseCustomFrame` / mask |
| `src/lib/scales/web-serial-transport.ts` | `navigator.serial` open/read/close |
| `src/lib/scales/session.ts` | `ScaleSession`: connect/disconnect/subscribe/lastReading/status |
| `src/lib/scales/backend-client.ts` | HTTP-клиент `/api/scales/*` |
| `src/lib/scales/index.ts` | Публичный API; re-export совместимости |
| `src/hooks/useScale.ts` | Connect от active context; реакция на switch комплекта |
| `src/lib/site-runtime.ts` | `connectionFromDevice` + custom; normalize adapter_id |
| `src/lib/storage.ts` | Расширение connection/ticket/settings; soft-read |
| `src/lib/manual-weight-reason.ts` | Валидация mode + причины |
| `src/components/ScalePanel.tsx` | Список адаптеров + custom; ошибки парсинга/транспорта |
| `src/components/SettingsView.tsx` | Редактор connection; mode причины |
| `src/components/WeighingForm.tsx` | Поле причины; валидация при save/complete |
| `server/scale_io.py` | Backend session + TCP + parser mirror |
| `server/app.py` | Маршруты `/api/scales/*` |
| `server/sqlite_store.py` | Колонка `manual_weight_reason` |

## Структура файлов

```
src/lib/scales.ts                          # EDIT → thin re-export (compat)
src/lib/scales/
  index.ts                                 # NEW — публичные экспорты
  types.ts                                 # NEW
  parse.ts                                 # NEW — parseUniversalFrame + parseCustomFrame
  registry.ts                              # NEW — ADAPTERS, getAdapter, ADAPTER_LIST
  adapters/
    builtins.ts                            # NEW — 4 профиля
    custom.ts                              # NEW
  web-serial-transport.ts                  # NEW
  backend-client.ts                        # NEW
  session.ts                               # NEW — ScaleSession + scaleConnection
src/lib/manual-weight-reason.ts            # NEW
src/lib/__tests__/scales-parse.test.ts     # NEW
src/lib/__tests__/scales-session-context.test.ts  # NEW
src/lib/__tests__/manual-weight-reason.test.ts    # NEW
src/lib/site-runtime.ts                    # EDIT
src/lib/storage.ts                         # EDIT
src/hooks/useScale.ts                      # EDIT
src/components/ScalePanel.tsx              # EDIT
src/components/SettingsView.tsx            # EDIT
src/components/WeighingForm.tsx            # EDIT
server/scale_io.py                         # NEW
server/app.py                              # EDIT — /api/scales/*
server/sqlite_store.py                     # EDIT — manual_weight_reason
server/tests/test_scales_api_tcp.py        # NEW
server/tests/test_manual_weight_reason_roundtrip.py  # NEW
docs/api.md                                # EDIT — секция /api/scales/*
```

Не затронуты: камеры/ANPR, PrintAct (источник/причина), installer/, dashboard/, dictionary_import, reo payloads, этап 9.

## Модели данных

### Идентификаторы и connection

- `ScaleAdapterId`: `microsim-m0601` | `newton` | `cas` | `midl-mi-vda` | `custom`
- `ScaleTransportKind`: `web_serial` | `serial` | `tcp` (default UI: `web_serial`)
- `ScaleConnectionProfile`: framing (`baudRate`, `parity`, `dataBits`, `stopBits`, `lineTerminator`) + optional `transport`; для custom — `parseRegex` / `parseMask` (+ optional stable/unit/sign groups); для backend — `host`/`tcpPort`/`serialPath` (локально, не секреты)

Нормализация: нет `transport` → `web_serial`; built-in без framing → дозаполнить из `connectionFromDevice`; `custom` без regex и mask → ошибка на русском при connect/parse.

### ScaleAdapter / ScaleSession

- `ScaleAdapter`: `id`, `name`, `defaultConnection()`, `parseFrame(line, connection)` → `ScaleReading | null`
- `ScaleSession`: `connect` / `disconnect` / `isConnected` / `getLastReading` / `getAdapterId` / `onReading` / `onStatusChange` / `onError`
- `ScaleReading` без изменений: `{ weight, unit, stable, negative, raw }`
- Совместимость: `scaleConnection` = singleton; `SCALE_DEVICES` / `SCALE_DEVICE_LIST` из реестра (+ custom)

### Built-in adapters

| id | name | framing defaults | parse |
|----|------|------------------|-------|
| microsim-m0601 | Микросим М0601 | 9600/N/8/1, `\r` | `parseUniversalFrame` |
| newton | Ньютон | 9600/N/8/1, `\r\n` | тот же |
| cas | CAS | 9600/E/7/1, `\r\n` | тот же |
| midl-mi-vda | Мидл Ми ВДА | 9600/N/8/1, `\r\n` | тот же |
| custom | Произвольный разбор | 9600/N/8/1, `\r\n` + parse* | `parseCustomFrame` |

### WeighingTicket / AppSettings

- `manual_weight_reason?: string | null` (soft-read)
- `manual_weight_reason_mode`: `off` | `optional` | `required` (default `optional`)
- `scale_device_id`: `ScaleAdapterId` (кэш активного adapter_id, + custom)

Правила: `off` — UI скрыт, в талон null; `optional` — поле видно, пустое допустимо; `required` — при manual gross/tare с заданным весом причина обязательна. Печать/РЭО причину не выводят.

### SQLite

- `ALTER TABLE weighing_tickets ADD COLUMN manual_weight_reason TEXT` (nullable)
- `scales.connection` — TEXT/JSON, новые ключи внутри JSON без смены DDL
- `manual_weight_reason_mode` — в app_settings / config flat string

## API / Интерфейсы

Новые HTTP `/api/scales/*` (активный комплект primary/spare из site_runtime + scales):

| Method | Path | Назначение |
|--------|------|------------|
| GET | `/api/scales/context` | site_id, scale_id, scale_role, adapter_id, connection, transport |
| GET | `/api/scales/status` | connected, adapter_id, last_reading, error |
| POST | `/api/scales/connect` | TCP connect (serial → 501; web_serial → 400) |
| POST | `/api/scales/disconnect` | закрытие сессии |
| GET | `/api/scales/reading` | последнее показание |

Формат ответов как у остального Flask API (`success` / `message`). Ошибки scales используют поле `message` (совместимость с `api.ts`). UI для backend-транспорта: poll `GET /api/scales/reading` ~250 ms.

Существующие `/api/config`, `/api/database`, `/api/storage` не ломались; изменения additive.

## Стек технологий

- Без смены: React 18, TypeScript, Vite, Tailwind, Flask, SQLite, Python 3.11/3.12
- Новых npm-пакетов нет
- Новых pip для MVP нет (TCP через stdlib `socket` + `threading`)
- `pyserial` не добавлен; задел `transport: serial` → HTTP 501
- `installer/` не трогали
- Тесты: Vitest (парсеры, context, reason) + pytest (TCP mock API, reason roundtrip)

## Решения и обоснования

1. **Разделение Adapter / Transport / Session** — 4 профиля + custom делят один Web Serial transport и один TCP backend.
2. **Источник истины при connect** — `getActiveScaleContext()`, не статичный `SCALE_DEVICES` alone; `scale_device_id` — кэш.
3. **Первый backend-транспорт: TCP** — без pip-зависимости, удобно тестировать mock-сервером; serial — stub 501.
4. **Миграция soft** — отсутствие transport ≡ web_serial; старые тикеты без reason → null.
5. **`scale_terminal_id`** — не добавляли в MVP (вне скоупа).
6. **При switch комплекта** — disconnect + сообщение «Подключите весы заново», без смешивания кадров старого терминала.
