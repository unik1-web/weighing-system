# Архитектура: 88bce4-camera-etalon-recapture

## Обзор

Доработка повторного съёма эталонов primary/spare в настройках камеры weighing-system без удаления и пересоздания записи реестра. Три согласованных изменения существующего стека: обязательный `flushDatabaseSync` перед `POST /api/cameras/reference`, рефакторинг `save_reference` (захват кадра вне блокировки SQLite + опциональный URL из формы), инвалидация превью через cache-bust query `t` в `photoUrl` и `Cache-Control: no-store` на `GET /api/cameras/photo`. Схема БД, имена файлов `Photo/refs/{camera_id}_{normal|spare}.jpg` и контракт ответа `{ success, camera }` сохранены.

## Компоненты

| Компонент | Назначение |
|-----------|------------|
| `SettingsView` | Кнопки «Эталон primary/spare»; `upsertCamera`; helper `captureEtalon`; локальный `etalonFeedback`; `refBustByCameraId`; `cameraBusyId` |
| `saveReference` (`src/lib/cameras.ts`) | `flushDatabaseSync` → POST (с опц. URL) → `CamerasStorage.upsert`; throw при ошибках |
| `photoUrl` | Базовый URL `/api/cameras/photo?path=` + опциональный `&t=` для bust |
| `CameraSetupPreview` | Превью refs с prop `referenceBust`; snapshot preview без изменений |
| `SpareSwitchWizard` | `wizardOpenedAt` как bust при построении `refUrl` сверки |
| `save_reference` (`server/cameras.py`) | Lookup → grab вне lock → overwrite JPEG → UPDATE path |
| `cameras_reference` / `cameras_photo` (`server/app.py`) | Проброс опц. полей; отдача JPEG + `no-store` |

Поток:

```
SettingsView (Эталон primary/spare)
      │ upsertCamera(cam)
      │ saveReference(id, mode, { captureUrl, captureKind })
      ▼
src/lib/cameras.ts  — flush → POST → upsert
      ▼
server/app.py  — cameras_reference / cameras_photo
      ▼
server/cameras.py  — save_reference / grab_frame
      ▼
SQLite cameras + Photo/refs/*.jpg
      ├── CameraSetupPreview  — photoUrl(path, bust)
      └── SpareSwitchWizard   — photoUrl(refPath, wizardOpenedAt)
```

## Структура файлов

```
server/cameras.py                      # save_reference: lock + опц. URL
server/app.py                          # проброс полей; Cache-Control: no-store
docs/api.md                            # опц. поля reference + no-store у photo
src/lib/cameras.ts                     # photoUrl(cacheBust); saveReference flush + opts
src/components/SettingsView.tsx        # captureEtalon; etalonFeedback; refBust
src/components/CameraSetupPreview.tsx  # prop referenceBust
src/components/SpareSwitchWizard.tsx   # wizardOpenedAt bust
server/tests/test_cameras_reference.py # новый: overwrite, optional URL, 400, Cache-Control
src/lib/__tests__/cameras.test.ts      # photoUrl t=; flush до post
```

## Модели данных

Схема SQLite / тип `Camera` без изменений:

- `reference_normal_path`, `reference_spare_path` — TEXT, relative `Photo/refs/...`
- Файлы: `Photo/refs/{camera_id}_normal.jpg`, `Photo/refs/{camera_id}_spare.jpg`
- Перезапись: `open(..., 'wb')` на тот же absolute path; `rel` после повторного съёма обычно совпадает

Клиентский UI-state (не в БД):

- `etalonFeedback` / локальный error+okAt у карточки камеры
- `refBustByCameraId: Record<string, number>` — `Date.now()` после успешного `saveReference`
- `CameraSetupPreview.referenceBust?: number`

## API / Интерфейсы

### `POST /api/cameras/reference` (аддитивно)

Обязательные поля: `camera_id`, `mode` (`normal` | `spare`).

Опционально: `capture_url`, `capture_kind` — только для `grab_frame`; приоритет над строкой SQLite.

Успех: файл перезаписан; UPDATE соответствующего `reference_*_path`; `{ success, camera }`.

Ошибки: камера не найдена / пустой URL / неверный mode → 400 с русским сообщением.

### `GET /api/cameras/photo`

Query `path` без изменений. Ответ: JPEG + `Cache-Control: no-store`. Path safety через `resolve_safe_photo_path`.

### Клиент

```ts
photoUrl(relativePath, cacheBust?: string | number | null): string | null
saveReference(cameraId, mode, opts?: { captureUrl?; captureKind? }): Promise<Camera>
```

`saveReference`: flush → POST → upsert; при отсутствии `camera` в ответе — throw.

### Сервер

```python
def save_reference(camera_id, mode, capture_url=None, capture_kind=None) -> dict
```

Алгоритм: validate mode → SELECT вне длительного lock → resolve URL → `grab_frame` → write `wb` → UPDATE + return row.

## Стек технологий

Без новых зависимостей. Flask + SQLite (`server/`), React 18 + TypeScript + Vite (`src/`), Vitest + pytest. Таймауты захвата — существующие лимиты модуля cameras.

## Решения и обоснования

| Решение | Выбор | Обоснование |
|---------|--------|-------------|
| Flush vs URL в body | оба | Flush чинит «камера не найдена»; URL — рассинхрон формы с БД как у snapshot |
| Cache-bust | query `t` + `no-store` | React не перерисует `<img>` при том же `src` |
| Где flush | внутри `saveReference` | Единая точка; нельзя забыть из UI |
| Схема БД | без изменений | Путь refs стабилен; перезапись `wb` уже была |
| Ошибки UI | локальный feedback у карточки | Раньше ошибка у нижней «Сохранить настройки» |
| `camera.id` | сохраняется | Не требуется удалять/пересоздавать камеру |
