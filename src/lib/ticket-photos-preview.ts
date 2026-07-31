import type { CaptureEvent, TicketPhoto } from '@/lib/cameras';

export type PreviewEventGroup = {
  event: CaptureEvent;
  label: string;
  photos: TicketPhoto[];
};

export type ArchiveStubPreview = {
  role: 'entry' | 'exit';
  label: string;
  path: string;
  src: string;
};

const EVENT_ORDER: CaptureEvent[] = ['gross', 'tare'];

const EVENT_LABELS: Record<CaptureEvent, string> = {
  gross: 'Брутто',
  tare: 'Тара',
};

/**
 * Build same-origin URL for a relative Photo/ path.
 *
 * Slashes are preserved so Flask `<path:relpath>` receives nested segments.
 */
export function photoApiUrl(relPath: string): string {
  const cleaned = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!cleaned) return '/api/photos/';
  return `/api/photos/${cleaned
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

/**
 * Success rows that have a non-empty file_path (candidate for preview).
 * File existence on disk is confirmed later via img onError.
 */
export function selectSuccessPreviewPhotos(photos: TicketPhoto[]): TicketPhoto[] {
  return photos.filter(
    (row) => row.status === 'success' && typeof row.file_path === 'string' && row.file_path.trim(),
  );
}

/**
 * Group success photos by capture event (gross then tare). Includes all roles.
 */
export function groupPhotosByEvent(photos: TicketPhoto[]): PreviewEventGroup[] {
  const success = selectSuccessPreviewPhotos(photos);
  const groups: PreviewEventGroup[] = [];
  for (const event of EVENT_ORDER) {
    const items = success.filter((row) => row.event === event);
    if (items.length === 0) continue;
    groups.push({
      event,
      label: EVENT_LABELS[event],
      photos: items,
    });
  }
  return groups;
}

/**
 * Count of previews still considered available after load errors.
 */
export function countAvailablePreviews(
  photos: TicketPhoto[],
  unavailableIds: ReadonlySet<string>,
): number {
  return selectSuccessPreviewPhotos(photos).filter((row) => !unavailableIds.has(row.id)).length;
}

/**
 * Archive card mapping: only photo_entry_path / photo_exit_path stubs (no overview).
 */
export function mapArchiveStubPreviews(
  photoEntryPath?: string | null,
  photoExitPath?: string | null,
): ArchiveStubPreview[] {
  const result: ArchiveStubPreview[] = [];
  const entry =
    typeof photoEntryPath === 'string' && photoEntryPath.trim() ? photoEntryPath.trim() : null;
  const exit =
    typeof photoExitPath === 'string' && photoExitPath.trim() ? photoExitPath.trim() : null;
  if (entry) {
    result.push({
      role: 'entry',
      label: 'Въезд',
      path: entry,
      src: photoApiUrl(entry),
    });
  }
  if (exit) {
    result.push({
      role: 'exit',
      label: 'Выезд',
      path: exit,
      src: photoApiUrl(exit),
    });
  }
  return result;
}
