# Архитектура

Кратко: React UI в браузере, Flask API на `127.0.0.1:5001`, постоянные данные на диске рядом с приложением.

## Потоки данных

```
Браузер (localStorage, ключи app_*)
        │  load / debounce-save
        ▼
Flask API  ──►  config.ini          (настройки)
           ──►  BD/weighing.db      (журнал, справочники, пользователи)
           ──►  logs/app.log        (ротация 2 МБ × 5)
```

- При старте UI читает `/api/config` и `/api/database` и заливает в `localStorage`.
- Изменения настроек пишутся в `config.ini`; остальное — в SQLite.
- Ключи без префикса `app_` API игнорирует при сохранении.
- Адреса `localhost:5173` (Vite) и `127.0.0.1:5001` (Flask) — разный origin → разный `localStorage`. Для постоянной работы открывайте production URL.

## Модули backend (`server/`)

| Файл | Назначение |
|------|------------|
| `app.py` | HTTP API, раздача `dist/`, логирование, `/api/auth/*` |
| `auth_passwords.py` | PBKDF2 hash / verify / legacy btoa upgrade |
| `launcher.py` | Точка входа PyInstaller-сборки |
| `persistence.py` | Пути, backup INI, миграция legacy |
| `sqlite_store.py` | Схема и CRUD SQLite |
| `year_db.py` / `year_rotation.py` | Годовые БД, ротация, admin-правка архива |
| `config_ini.py` | Чтение/запись секций INI |
| `vescom.py` | Firebird: взвешивания и справочники |
| `metra.py` | Paradox `TWeights.db` и словари |
| `wa.py` | Firebird/SQL база WA («Весы Авто»), путь `C:\Program Files (x86)\WA` |
| `dictionary_import.py` | Слияние справочников с нормализацией |
| `text_encoding.py` | Декодирование, ФИО, госномера |
| `reo_client.py` | multipart POST в РЭО |
| `browse.py` | Обзор файловой системы для UI |
| `cameras.py` / `anpr.py` / `scale_io.py` | Фото, ANPR, backend I/O весов |

## Модули frontend (`src/`)

| Путь | Назначение |
|------|------------|
| `lib/storage.ts` | Модели, localStorage, настройки; тикет: `weighing_mode`, `version`, site/scale/photo/ANPR stubs; audit + revisions |
| `lib/auth-api.ts` | Клиент `/api/auth/*` |
| `lib/ticket-audit-fields.ts` | Whitelist значимых полей и diff |
| `lib/journal-filters.ts` | Фильтры журнала (площадка, весы, фото, ANPR, режим, оператор) |
| `lib/weighing-mode.ts` | Pure-логика режимов single/dual (фаза, валидация, CAS-хелперы) |
| `lib/storage-sync.ts` | Синхронизация с API |
| `lib/api.ts` | Обёртки fetch к `/api/*` |
| `lib/reo.ts` | Сборка JSON РЭО, валидация |
| `lib/scales.ts` | Web Serial: парсеры весов |
| `lib/vehicle-plate.ts` | Нормализация госномеров |
| `lib/import-keys.ts` | Ключ дедупликации импорта |
| `components/*ImportView.tsx` | Импорт Vescom / Metra / WA |
| `components/PrintAct.tsx` | Макеты «акт» и «талон» (источник веса на печать не выводится) |
| `components/SettingsView.tsx` | Организация, РЭО, импорт, UI, режимы, площадка, журнал переключений |
| `components/TicketHistoryPanel.tsx` | История audit/revisions в карточке |
| `components/ForceChangePasswordModal.tsx` | Принудительная смена дефолтного пароля |

## Нормализация справочников

При импорте Vescom/Metra/WA (`dictionary_import.merge_dictionaries`):

- **Госномера** — латиница→кириллица, без пробелов/дефисов; если нет региона — добавляется `56`; дедуп по `normalize_vehicle_key`.
- **Водители** — разбор нескольких ФИО из одной строки, формат ФИО.
- **Прочее** — trim, читаемость текста, casefold-дедуп.
- Уже существующие записи не дублируются; для авто выбирается более полный бренд/тара.

На старте UI также прогоняет `normalizeVehicleDictionaryPlates()` для уже сохранённых авто.

## Импорт взвешиваний

Ключ записи: `брутто_тара_госномер` (`ticketImportKey` в `import-keys.ts`).  
Уже импортированные строки в UI помечены и недоступны для повторного импорта.

## Печать

| `print_layout` | Макет | Экземпляров на листе |
|----------------|-------|----------------------|
| `act` (по умолчанию) | Акт взвешивания | 2 |
| `receipt` | Талон-квитанция | 3 (копии 3, 1, 2) |

## Навигация

`nav_tab_mode`: `full` (иконка + подпись) или `compact` (только иконки, подпись в `title`).

## Режимы взвешивания (этап 1)

- Тикет: `weighing_mode` (`single` \| `dual`), `version` (оптимистичная блокировка при дозавершении).
- Audit: ключ sync `app_ticket_audit` / таблица SQLite `ticket_audit` (`created` / `completed` / `auto_closed` / `updated`).
- Revisions: `app_ticket_revisions` — построчный diff значимых полей (активный год при `TicketStorage.update`, архив при admin-edit).
- Настройки (`config.ini` / `AppSettings`): `weighing_mode_default`, `stable_mode`, `tara_threshold`, `max_time_between`, `tara_default`.
- Миграция и деплой: `docs/weighing-modes-deploy.md`.

## Площадка, весы, камеры, ANPR (этапы 4–8)

- Площадка / комплект: `app_sites`, `app_scales`, `app_site_runtime`, `app_site_scale_switches`; шапка формы показывает активный комплект и (если включено) статусы ANPR/камер.
- Камеры/фото: `app_cameras`, `app_ticket_photos`, JPEG в `Photo/`; флаг `video_enabled`.
- ANPR: `server/anpr.py`, флаг `anpr_enabled`, модель ONNX вне git (`models/anpr/`).

## Auth (этап 9)

- Пароли: PBKDF2-HMAC-SHA256 на сервере (`server/auth_passwords.py`); endpoints `/api/auth/login|change-password|register`.
- Sync `app_users` **без** `passwordHash`; колонка `must_change_password`; дефолтный `admin`/`admin123` требует смены при первом входе.
- Legacy `btoa`-hash при login прозрачно перехешируется.

## Весы (Web Serial)

Клиентский код, без backend. Браузер: Chrome / Edge. Модели: Микросим М0601, Ньютон, CAS, Мидл Ми ВДА (`src/lib/scales.ts`). Backend TCP/serial: `server/scale_io.py`.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `HOST` | `127.0.0.1` | bind Flask |
| `PORT` | `5001` | порт |
| `OPEN_BROWSER` | `1` | автооткрытие браузера |
| `FLASK_DEBUG` | off | debug Flask |
| `VITE_API_URL` | `''` (same-origin) | база API для frontend |

## Сборка Windows (базовая vs полная)

`installer/build.ps1` → PyInstaller (`weighing-system.spec`) → опционально Inno Setup (`weighing-system.iss`).  
Данные и логи — рядом с `WeighingSystem.exe`, не внутри `_MEIPASS`.

| Сборка | Состав | Поведение UI |
|--------|--------|--------------|
| **Базовая** | без OpenCV / onnxruntime / модели ANPR | индикаторы камер/ANPR скрыты или «недоступно»; `video_enabled`/`anpr_enabled` можно не включать |
| **Полная** | OpenCV + onnxruntime + файл модели `models/anpr/plate.onnx` (вне git) | захват фото и ANPR по capabilities runtime |

Секреты, `config.ini`, `BD/`, `.env*` в git не коммитятся. Каталог `dashboard/` оркестратора в установщик не входит.