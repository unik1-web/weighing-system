# Архитектура: aee213-camera-discovery

## Обзор

Доработка существующего контура камер (этап 7 + вкладка «Камеры и фото» этапа 10): оператор вводит IP, логин, пароль и бренд; backend перебирает каталог шаблонов URL через уже существующие `grab_frame_http` / `grab_frame_rtsp` / `save_tmp_snapshot`, отдаёт прогресс по poll-сессии; UI применяет выбранный URL в state реестра камер (persist — кнопка «Сохранить» настроек).

Аддитивный API `/api/cameras/discover*` не ломает существующие snapshot/capture/photo. SSRF-ограничение (только частные/локальные IPv4) действует только на discover.

## Компоненты

| Компонент | Назначение |
|-----------|------------|
| `server/camera_templates.py` | Каталог брендов/шаблонов; `list_brands()`, `build_attempt_plan(brand, opencv)`, `render_url()` (percent-encode userinfo) |
| `server/camera_discover.py` | SSRF-проверка IP; in-memory sessions; оркестрация перебора; cancel/wall-clock; маскирование логов (`mask_url`, `safe_exc_message`) |
| `server/cameras.py` | Без изменения публичного capture API; reuse `grab_frame_*`, `save_tmp_snapshot`, timeouts, `_opencv_available` |
| `server/app.py` | Тонкие routes `/api/cameras/discover*` |
| `src/lib/cameras.ts` | Клиент: brands, start/poll/cancel discover; типы; `maskCameraUrl()` |
| `src/lib/api.ts` | Маскирование `password` в логе body для `POST /api/cameras/discover` |
| `src/components/CameraDiscoverPanel.tsx` | Форма поиска, прогресс, превью, список кандидатов, apply/create |
| `src/components/SettingsView.tsx` | Подвкладки «Реестр» \| «Поиск камеры»; прокидывает siteId/cameras/caps |
| `docs/api.md`, `README.md` | Контракт discover + инструкция оператора |
| `installer/weighing-system.spec` | hiddenimports `camera_discover`, `camera_templates` |

### Зависимости

```
SettingsView ──► CameraDiscoverPanel ──► cameras.ts (API)
                      │
                      ▼ apply
               setCameras / upsertCamera (local state)
                      │
                      ▼ «Сохранить» настроек (as-is)
               CamerasStorage + /api/database / config

app.py ──► camera_discover ──► camera_templates
                 │
                 └──► cameras.grab_frame_* / save_tmp_snapshot
```

## Структура файлов

```
server/camera_templates.py              # NEW — каталог + render + plan order
server/camera_discover.py               # NEW — SSRF, sessions, worker
server/app.py                           # EDIT — 4 route handlers
server/tests/test_camera_templates.py   # NEW
server/tests/test_camera_discover.py    # NEW
installer/weighing-system.spec          # EDIT — hiddenimports

src/lib/cameras.ts                      # EDIT — discover client + maskCameraUrl
src/lib/api.ts                          # EDIT — mask password в логе discover
src/lib/__tests__/cameras.test.ts       # EDIT
src/components/CameraDiscoverPanel.tsx  # NEW
src/components/SettingsView.tsx         # EDIT — subtabs + panel

docs/api.md                             # EDIT — секция discover
README.md                               # EDIT — «Поиск камеры»
```

Не затронуты: `dashboard/`, стек камер, лимит 4 камер на площадку, ONVIF/Digest.

## Модели данных

### Шаблон (backend, константы)

```python
Template = {
  "id": str,           # e.g. "hikvision-http-isapi"
  "brand": str,        # hikvision | dahua | axis | uniview | generic
  "label": str,        # human path hint for progress
  "kind": "http_snapshot" | "rtsp",
  "url_pattern": str,  # {user},{password},{ip},{http_port},{rtsp_port}
  "popular": bool,     # True → раньше в порядке «перебор»
}
```

Каталог MVP: Hikvision (HTTP ISAPI + RTSP 101/102), Dahua (snapshot.cgi + realmonitor), Axis (jpg/image.cgi), Uniview (HTTP snapshot), generic (`/snapshot.jpg`, `/cgi-bin/snapshot.cgi`, RTSP `/stream1`, `/h264`).

### Порядок попыток

- Бренд выбран → шаблоны бренда: сначала HTTP, затем RTSP (если OpenCV).
- «Неизвестно / перебор» (`brand` null/omit) → popular HTTP всех брендов → остальные HTTP → RTSP.
- Без OpenCV RTSP не вызывается; в ответе `skipped_rtsp`.

### Discover session (in-memory)

```python
DiscoverSession = {
  "id": str,
  "status": "running"|"done"|"cancelled"|"failed",
  "cancel_event": threading.Event,
  "request": { ip, username, password, brand, http_port, rtsp_port },  # password только в RAM
  "progress": { "current": int, "total": int, "label": str },
  "candidates": [Candidate, ...],  # успешные
  "skipped_rtsp": bool,
  "message": str|None,
  "error": str|None,
}
Candidate = {
  "url": str,  # полный с userinfo (для apply); UI маскирует отображение
  "kind": "http_snapshot"|"rtsp",
  "brand": str,
  "template_id": str,
  "ok": True,
  "preview_path": str|None,  # Photo/tmp/….jpg
}
```

Лимиты: одна активная сессия (новый POST авто-cancel предыдущей); TTL терминальных ~5 мин; max 8 сессий в словаре.

### SSRF

Разрешены только IPv4: loopback, RFC1918 private, link-local `169.254/16`. Public / multicast / `0.0.0.0` / hostname / IPv6 → HTTP 400.

### Константы

```python
DISCOVER_WALL_CLOCK = 45.0
DISCOVER_HTTP_PARALLEL = 2
DISCOVER_SESSION_TTL_SEC = 300
MAX_DISCOVER_SESSIONS = 8
```

Per-attempt timeouts — те же `CONNECT_TIMEOUT` / `READ_TIMEOUT` snapshot (~2s / ~5s).

## API / Интерфейсы

Аддитивно к `/api/cameras/*`:

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/api/cameras/discover/brands` | `{ success, brands: [{ id, label }] }` — без пункта «Неизвестно» (его добавляет frontend) |
| `POST` | `/api/cameras/discover` | Старт: `{ ip, username?, password?, brand?, http_port?, rtsp_port? }` → session + `status: running` |
| `GET` | `/api/cameras/discover/<session_id>` | Poll прогресса и кандидатов; полный `url` в JSON; UI маскирует |
| `POST` | `/api/cameras/discover/<session_id>/cancel` | Прекращает новые попытки |

Порты: defaults 80 / 554; поле `ip` может содержать `host:port`; явные `http_port`/`rtsp_port` опциональны (UI шлёт только если заполнены).

### Frontend (`src/lib/cameras.ts`)

- `fetchDiscoverBrands`, `startDiscover`, `pollDiscover`, `cancelDiscover`
- `maskCameraUrl(url)` — `user:***@host…`
- Poll UI ~600 ms пока `running`; unmount → cancel best-effort

### Apply (клиентский)

- **Подставить** в выбранную камеру: `capture_url` + `capture_kind`
- **Создать** камеру (роль/имя; лимит ≤4 на `site_id` из React state)
- Persist — существующая кнопка «Сохранить»; после apply — переход на «Реестр»

## Стек технологий

- Python 3.11/3.12: `ipaddress`, `urllib.parse`, `threading`, `concurrent.futures`, `uuid`
- Захват: существующие `requests` / OpenCV через `grab_frame_*` (без новых HTTP-клиентов)
- React 18 + TypeScript + Vite + Tailwind (стиль Settings)
- Тесты: pytest + mock `grab_frame_*`; Vitest для `maskCameraUrl` / apply

## Решения и обоснования

| Решение | Почему |
|---------|--------|
| Session + poll (не long-request / SSE) | UX прогресса и отмены (FR-6 допущение A) |
| Сессии только in-memory | Discover эфемерен; не переживает рестарт Flask |
| Каталог шаблонов на backend | Единый источник правды; UI получает бренды с API |
| SSRF только на discover | Обратная совместимость ручного snapshot (NFR-1) |
| Apply без отдельного API | Переиспользование `upsertCamera` / state настроек |
| Wall-clock 45 с; HTTP ≤2; RTSP serial | Не DDoS камеру; не блокировать capture дольше разумного |
| Полный URL в poll JSON | Нужен для apply; UI/`mask_url` маскируют отображение и логи |
| Авто-cancel предыдущей сессии | Одна активная discover на процесс |
| Пустой username → omit userinfo | Избежать `http://:pass@…` |
| Порты empty=auto на форме | Backend парсит embedded `:port` из IP |
