# Постановка: адаптеры весовых терминалов

> **Статус:** реализовано (этап 5). Деплой/миграция: [docs/scale-adapters-deploy.md](../scale-adapters-deploy.md). Acceptance: [docs/reports/scale-adapters/scale-adapters-acceptance.md](../reports/scale-adapters/scale-adapters-acceptance.md). Следующий оркестраторный прогон — [06-yearly-db-archive.md](06-yearly-db-archive.md) (параллельно возможен) или [07-photo-capture.md](07-photo-capture.md).

## Цель

Вынести профили весов в pluggable `ScaleAdapter`, сохранить Web Serial и заложить backend I/O (`pyserial` / TCP, `/api/scales/*`) для primary+spare и exe без зависимости только от браузера; добавить адаптер произвольного разбора и опциональную/обязательную причину ручного ввода.

Источник требований: [docs/roadmap.md](../roadmap.md), этап 5.  
Зависимости: этап 4 ([04-site-primary-spare.md](04-site-primary-spare.md)) — активный комплект выбирает адаптер; этапы 1–2 для ручного ввода / `WeightSource`.

## Контекст as-is

- Четыре Web Serial-профиля в `scales.ts` / `ScalePanel`, один `ScaleConnection`.
- Нет интерфейса адаптера, нет `/api/scales/*`, нет backend serial/TCP.
- Параметры подключения не в `scales.connection` модели площадки.

Стек: [docs/project-for-agents.md](../project-for-agents.md), [docs/architecture.md](../architecture.md), [docs/api.md](../api.md).

## Что сделать

### Интерфейс адаптера

- `ScaleAdapter`: `connect` / `read` / subscribe (точная сигнатура — в архитектуре).
- Профили Микросим, Ньютон, CAS, Мидл — как адаптеры с прежним поведением.
- Адаптер «произвольный разбор» (regex / маска) без нового кода под каждый терминал.
- Параметры в `scales.connection` (JSON), выбор адаптера через `adapter_id`.

### Транспорт

- Сохранить Web Serial в браузере.
- Заложить backend I/O: `pyserial` и/или TCP; API `/api/scales/*` для активного комплекта (primary+spare) и сценария exe.
- Активный комплект площадки выбирает нужный адаптер/соединение.

### Ручной ввод

- Ручной ввод веса всегда возможен.
- Опциональная/обязательная причина ручного ввода (`manual_weight_reason`) — поведение и обязательность в настройках (аналитик зафиксирует default).

## Вне скоупа

- Камеры, ANPR, годовая ротация.
- Полная документация безопасности/паролей (этап 9).

## Критерии приёмки

- [x] Существующие 4 профиля работают через адаптеры без регрессии чтения веса.
- [x] Новый терминал подключается конфигом (regex/маска) или тонким адаптером.
- [x] Активный комплект primary/spare выбирает своё подключение.
- [x] Есть зачаток или рабочий путь `/api/scales/*` / backend I/O (минимум — контракт + один транспорт; объём уточнит ТЗ).
- [x] Ручной ввод с фиксацией источника; причина — по правилам настроек.
- [x] Регрессии: форма single/dual, `stable_mode`, журнал, печать.
- [x] Тесты парсеров адаптеров и выбора активного комплекта.

## Ограничения

- Не менять стек; артефакты в `docs/implementation/`.
- Не ломать Chromium Web Serial happy-path.
- Секреты/COM-порты не коммитить.

## Артефакты пайплайна

Каталог: `docs/implementation`
