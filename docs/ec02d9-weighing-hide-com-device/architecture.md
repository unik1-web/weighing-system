# Архитектура: ec02d9-weighing-hide-com-device

## Обзор

Frontend-only доработка экрана взвешивания: оператор больше не выбирает модель прибора и COM-порт на панели «Весовой прибор». Профиль подключения берётся только из активного комплекта настроек (`getActiveScaleContext`). Параллельно в Настройках для резервных весов при `transport === 'serial'` добавлены UI COM-порта и `pollCommand` по образцу основных. Flask API, `docs/api.md`, схема БД и `config.ini` не менялись.

## Компоненты

| Компонент | Назначение | Изменение |
|-----------|------------|-----------|
| `ScalePanel` | Статус, вес, connect/disconnect, фиксация, подсказки I/O | Убраны UI модели/COM; Connect из активного контекста |
| `WeighingForm` | Форма билета; `scale_device` из `deviceId` ↔ runtime | Убраны props/handler смены устройства на панели |
| `SettingsView` | Настройка primary/spare connection | Добавлены spare COM + `pollCommand` при serial |
| `SerialPortSelect` | Выбор COM-порта | Без изменений API; потребитель — Settings |
| `getActiveScaleContext` / `upsertScale` / `updateActiveScaleDevice` | Runtime комплекта | API без изменений; `updateActiveScaleDevice` с формы не вызывается |
| `useScale` | connect/disconnect + disconnect при `SITE_RUNTIME_UPDATED_EVENT` | Без изменений |

## Структура файлов

```
src/components/ScalePanel.tsx       # UI + Connect из getActiveScaleContext
src/components/WeighingForm.tsx     # без device props/handler; scale_device из контекста
src/components/SettingsView.tsx     # spare: SerialPortSelect + pollCommand
src/components/SerialPortSelect.tsx # без изменений
src/hooks/useScale.ts               # без изменений
src/lib/site-runtime.ts             # без изменений API
```

Новых файлов не создавалось.

## Модели данных

Новых сущностей нет. Используются существующие типы:

```ts
// src/lib/scales/types.ts (без изменений)
interface ScaleConnectionProfile {
  transport?: 'web_serial' | 'serial' | 'tcp';
  serialPath?: string;
  pollCommand?: string;
  baudRate?: number;
  // … parity, dataBits, stopBits, lineTerminator, host, tcpPort, parse*
}

// ActiveScaleContext (site-runtime) — без изменений
// activeScale.connection — источник правды для Connect
```

Локальный state `ScalePanel`:
- Удалены: `serialPath`, props `deviceId` / `onDeviceChange`.
- Оставлены: `webSerialSupported`, `ioHint`, `transport` (синхронизация через `SITE_RUNTIME_UPDATED_EVENT`).

`WeighingForm.deviceId` сохранён только для поля билета `scale_device` (синхронизация из `syncFromRuntime` / `ctx.adapter_id`).

## API / Интерфейсы

### Backend

Без изменений.

### `ScalePanel` — Props

```ts
interface Props {
  onCapture: (weight: number, raw: string) => void;
  label: string;
  capturedWeight: number | null;
  stableMode?: boolean;
  onUnstableCapture?: () => void;
  onReadingChange?: (weight: number | null) => void;
}
// Удалены: deviceId, onDeviceChange
```

### Connect / canConnect

```ts
function readActiveTransportAndPath(): {
  transport: ScaleTransportKind;
  serialPath: string;
  connection: ScaleConnectionProfile;
  adapter_id: ScaleDeviceId;
};

// canConnect:
//   web_serial → WebSerialTransport.isSupported()
//   serial     → !!normalizeSerialPath(ctx.activeScale.connection.serialPath)
//   tcp / else → true

// handleConnect:
//   await connect(adapter_id, connection) из контекста
//   без upsertScale и без merge локального serialPath
```

При `usesBackendSerial && !canConnect` под кнопкой «Подключить» показывается текст: «Укажите COM-порт в Настройках».

### Settings — резервный комплект

При `(spareScale.connection?.transport ?? 'web_serial') === 'serial'`:
1. COM-порт — `SerialPortSelect` → `patchScaleConnection(..., { serialPath })`
2. Команда запроса веса — input `pollCommand` → `patchScaleConnection(..., { pollCommand })`

Сохранение через существующий flow `upsertScale` / `enableSpareScale`.

## Стек технологий

React 18, TypeScript, Vite, Tailwind CSS (`src/`). Без новых зависимостей. Используются существующие `SerialPortSelect`, `normalizeSerialPath`, `getActiveScaleContext`, `useScale`.

Проверки: `npm run typecheck`, `npm test` (Vitest).

## Решения и обоснования

1. **Только фронтенд** — выбор модели/COM на взвешивании был UI-оверрайдом; источник правды уже в Settings/runtime.
2. **Connect = чистый контекст** — исключает рассинхрон локального `serialPath` с профилем комплекта и запись `upsertScale` со стороны оператора на форме.
3. **`updateActiveScaleDevice` оставлен** — API runtime нужен Settings/тестам; с формы взвешивания больше не вызывается.
4. **Spare COM + pollCommand** — после удаления COM с `ScalePanel` без этих полей нельзя было бы настроить serial для резерва через UI.
5. **Parity / lineTerminator у spare** — намеренно не добавлялись в этой задаче.
6. **`ioHint` с «COM3»** — оставлен as-is (некритично).
