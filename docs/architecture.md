# Архитектура

Кратко: React UI в браузере, Flask API на `127.0.0.1:5001`, постоянные данные на диске рядом с приложением.

## Потоки данных

```
Браузер (localStorage, ключи app_*)
        │  load / debounce-save
        ▼
Flask API  ──►  config.ini              (настройки + active_year)
           ──►  BD/weighing-YYYY.db     (активный год: журнал, справочники, пользователи)
           ──►  backup/                 (миграции и ротации)
           ──►  logs/app.log        (ротация 2 МБ × 5)
```

- При старте UI читает `/api/config` и `/api/database` и заливает в `localStorage`.
- Изменения настроек пишутся в `config.ini`; остальное — в SQLite.
- Ключи без префикса `app_` API игнорирует при сохранении.
- Адреса `localhost:5173` (Vite) и `127.0.0.1:5001` (Flask) — разный origin → разный `localStorage`. Для постоянной работы открывайте production URL.

## Модули backend (`server/`)

| Файл | Назначение |
|------|------------|
| `app.py` | HTTP API, раздача `dist/`, логирование |
| `launcher.py` | Точка входа PyInstaller-сборки |
| `persistence.py` | Пути, backup INI, миграция legacy, stage-6 path helpers |
| `sqlite_store.py` | Схема и CRUD SQLite, add-only migration stage 6, `next_ticket_number` |
| `active_year_service.py` | Active-year read/write слой с selector + write-gate |
| `year_context.py` | Selector active/archive year DB context, `validate_archive_year` |
| `year_rotation.py` | Первичная миграция и preview/commit ротации года |
| `archive_service.py` | Каталог архивных лет, read-only журнал/карточка, mixed legacy warning |
| `archive_edit_service.py` | Admin-правка архивного тикета: whitelist, пересчёт, diff-аудит |
| `ticket_audit_stage6.py` | Формирование stage-6 audit (`archive_edit` / `auto_close`) |
| `config_ini.py` | Чтение/запись секций INI |
| `vescom.py` | Firebird: взвешивания и справочники |
| `metra.py` | Paradox `TWeights.db` и словари |
| `wa.py` | Firebird/SQL база WA («Весы Авто»), путь `C:\Program Files (x86)\WA` |
| `dictionary_import.py` | Слияние справочников с нормализацией |
| `text_encoding.py` | Декодирование, ФИО, госномера |
| `reo_client.py` | multipart POST в РЭО |
| `browse.py` | Обзор файловой системы для UI |

## Модули frontend (`src/`)

| Путь | Назначение |
|------|------------|
| `lib/storage.ts` | Модели, localStorage, настройки; тикет: `weighing_mode`, `version`, `site_id`/`scale_id`/`scale_role`; `VehicleDriversStorage`; Site/Scale/Runtime/Journal фасады |
| `lib/site.ts` | Площадка: миграция default site/primary/spare, switch, зеркало `scale_device_id`, поля талона |
| `lib/weighing-mode.ts` | Pure-логика режимов single/dual и источника веса (`WeightSource`, автотара, фильтр, сводка) |
| `lib/vehicle-resolve.ts` | Pure resolve реквизитов по госномеру, матрица водителя, datalist, `plate_source` |
| `lib/storage-sync.ts` | Синхронизация с API |
| `lib/api.ts` | Обёртки fetch к `/api/*` |
| `lib/reo.ts` | Сборка JSON РЭО, валидация |
| `lib/scales.ts` | Web Serial: парсеры весов; `normalizeScaleDeviceId` |
| `lib/vehicle-plate.ts` | Нормализация госномеров |
| `lib/import-keys.ts` | Ключ дедупликации импорта |
| `components/*ImportView.tsx` | Импорт Vescom / Metra / WA |
| `components/PrintAct.tsx` | Макеты «акт» и «талон»; archive reprint без записи в active storage |
| `components/ArchiveView.tsx` | Каталог архивных лет и журнал выбранного года |
| `components/ArchiveTicketCard.tsx` | Readonly-карточка архивного тикета и печать |
| `components/SettingsView.tsx` | Организация, РЭО, импорт, UI, режимы, площадка/комплекты (wizard переключения) |
| `components/SiteScalesSettingsSection.tsx` | Секция площадки, journal, вход в переключение |
| `components/ScaleSetSwitchWizard.tsx` | Wizard spare / диалог primary |
| `components/WeighingJournal.tsx` | Журнал, карточка тикета (модалка), CSV с источниками веса и устройством |

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
- Audit: ключ sync `app_ticket_audit` / таблица SQLite `ticket_audit` (`created` / `completed`).
- Настройки (`config.ini` / `AppSettings`): `weighing_mode_default`, `stable_mode`, `tara_threshold`, `max_time_between`, `tara_default`.
- Миграция и деплой: `docs/weighing-modes-deploy.md`.
- Stage 6 (годовые БД / архив) runbook: `docs/yearly-db-archive-deploy.md`.

## Автоподстановка по номеру и водители (этап 3)

- Resolve реквизитов: `src/lib/vehicle-resolve.ts` (марка / водитель / груз / грузоотправитель по приоритетам; триггер — confirmed plate select/blur).
- История водителей: sync-ключ `app_vehicle_drivers`, таблица SQLite `vehicle_drivers` (отдельно от журнала).
- Настройки: `driver_input_mode`, `scale_device_id`.
- Audit stubs тикета: `plate_source`, `scale_role`, `photo_entry_path`, `photo_exit_path` (nullable).
- Предпочтения ТС в payload карточки: `preferred_driver_name`, `preferred_cargo_name`, `preferred_shipper_name`.

## Площадка: основные / резервные весы (этап 4)

- Сущности: `sites`, `scales` (primary/spare, `adapter_id=web_serial`, `connection.device_id`), `site_runtime`, `scale_switch_journal`.
- Sync-ключи: `app_sites`, `app_scales`, `app_site_runtime`, `app_scale_switch_journal`.
- Миграция клиента: `ensureDefaultSiteAndScales` — default site, primary из `scale_device_id`, spare-stub, runtime на primary.
- Переключение только из настроек (wizard); на форме — индикация «Весы: основные/резервные».
- Новые талоны из формы пишут `site_id` / `scale_id` / `scale_role`; dual complete не затирает; без runtime — hard-fail.
- `AppSettings.scale_device_id` — зеркало device активного комплекта; SoT — `scales.connection`.

## Весы (Web Serial)

Клиентский код, без backend. Браузер: Chrome / Edge. Модели: Микросим М0601, Ньютон, CAS, Мидл Ми ВДА (`src/lib/scales.ts`).

## Smoke stage 6 (yearly archive)

`scripts/smoke_yearly_archive.py` — production-like HTTP smoke против `npm start`:
- `--scenario active|archive|fail-retry|parallel-lock`
- evidence: `docs/reports/yearly-db-archive/`

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `HOST` | `127.0.0.1` | bind Flask |
| `PORT` | `5001` | порт |
| `OPEN_BROWSER` | `1` | автооткрытие браузера |
| `FLASK_DEBUG` | off | debug Flask |
| `VITE_API_URL` | `''` (same-origin) | база API для frontend |

## Сборка Windows

`installer/build.ps1` → PyInstaller (`weighing-system.spec`) → опционально Inno Setup (`weighing-system.iss`).  
Данные и логи — рядом с `WeighingSystem.exe`, не внутри `_MEIPASS`.
