# Архитектура: 1449bf-double-weighing-photos

## Обзор

Frontend-only доработка блока «Фотофиксация» в карточке/просмотре провески: превью группируются по `TicketPhoto.phase` (тара / брутто) без схлопывания фаз в один слот на камеру, плюс простой lightbox для снимков со статусом `ok`. Backend, схема БД, stubs тикета (`photo_*_path`) и API `/api/cameras/*` не меняются. Источник истины — `TicketPhotosStorage.forTicket` (`app_ticket_photos`); stubs остаются fallback при пустых photos.

## Компоненты

| Компонент | Назначение |
|-----------|------------|
| `TicketPhotoPreview` | Загрузка photos, построение групп/слотов, рендер сетки, управление lightbox |
| `buildPhotoPreviewGroups` | Публичный билдер: `PhotoPreviewGroup[]` с фазовой группировкой |
| `buildPhotoPreviewSlots` | Thin-wrapper: `groups.flatMap(g => g.slots)` для обратной совместимости тестов |
| `PhotoLightbox` | Fullscreen overlay (co-located в том же файле): img `object-contain`, подпись, закрытие Esc / backdrop / «Закрыть» |
| Call sites | `WeighingJournal`, `WeighingForm` — без правок props; `ArchiveView` превью не использует |

## Структура файлов

```
src/components/TicketPhotoPreview.tsx          # groups + slots + UI + PhotoLightbox
src/lib/__tests__/ticket-photo-preview.test.ts # dual / single / stubs / порядок групп / failed-missing
```

Backend и call sites журнала/формы не изменялись.

## Модели данных

```ts
export interface PhotoPreviewSlot {
  key: string;                 // уникален в рамках тикета, напр. "c-entry|tare"
  role: CameraRole;
  label: string;
  cameraName?: string;
  status: 'ok' | 'failed' | 'skipped' | 'missing';
  relative_path: string | null;
  error_message?: string | null;
  phase?: PhotoPhase;          // из TicketPhoto; у stub-слотов — undefined
}

export interface PhotoPreviewGroup {
  phase: PhotoPhase | null;    // null = плоский режим (single или stubs)
  title: string | null;        // "Тара" | "Брутто" | null (без заголовка группы)
  slots: PhotoPreviewSlot[];
}
```

**Алгоритм групп:** `useGroups` только при ≥2 различных `phase` в photos. Порядок: `tare_datetime` / `gross_datetime` primary, `min(created_at)` secondary, иначе Тара → Брутто. Пустые фазы без строк photos не рендерятся. Ключ слота всегда включает phase (`${cameraId}|${phase}`). Повторный capture внутри фазы — `latest*` по `created_at` в отфильтрованном массиве.

## API / Интерфейсы

### Backend

Без изменений. Чтение JPEG — существующий `GET /api/cameras/photo?path=…` через `photoUrl()`.

### Frontend

```ts
buildPhotoPreviewGroups(
  ticket: WeighingTicket,
  photos: TicketPhoto[],
  options?: { siteId?: string | null; videoExpected?: boolean },
): PhotoPreviewGroup[];

buildPhotoPreviewSlots(...): PhotoPreviewSlot[]; // flatten groups

function TicketPhotoPreview(props): JSX.Element | null;

// PhotoLightbox
type PhotoLightboxProps = {
  src: string;
  title: string;
  onClose: () => void;
};
```

Props `TicketPhotoPreview` без breaking changes: `ticket`, `photos?`, `siteId?`, `videoExpected?`, `className?`, `compact?`.

Lightbox: открытие только при `status === 'ok'` и валидном URL; `z-[60]` выше модалки журнала (`z-50`); prev/next не реализованы (по архитектуре).

## Стек технологий

- React 18 + TypeScript + Tailwind CSS — без новых npm-зависимостей
- Vitest: `src/lib/__tests__/ticket-photo-preview.test.ts`
- Проверки: `npm test`, `npm run typecheck` (серверные тесты не требовались)

## Решения и обоснования

1. **Источник истины — `ticket_photos`**: stubs намеренно хранят последний путь на роль и недостаточны для dual; расширение stubs не требуется.
2. **Группировка только при ≥2 phase**: single и dual-с-одной-фазой остаются плоским списком без пустой второй группы.
3. **Ключ слота с phase**: устраняет коллизию `latestPhotoForCamera` / `buildSlotsFromPhotos` по `camera_id`, из‑за которой оставалась только последняя фаза (обычно gross).
4. **Lightbox co-located**: файл ~450–477 строк; вынос в отдельный файл не блокер (архитектор допускал co-locate).
5. **z-[60]**: превью открывается внутри journal modal (`z-50`), иначе overlay оказался бы под маской.
6. **Backend не трогать**: файлы уже пишутся с `*_tare_*` / `*_gross_*`; задача — UI и выбор данных.
