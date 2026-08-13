import { photoUrl, CAMERA_ROLE_LABELS } from '@/lib/cameras';
import type { CameraRole, TicketPhoto, WeighingTicket } from '@/lib/storage';
import { TicketPhotosStorage } from '@/lib/storage';

const ROLE_ORDER: CameraRole[] = ['entry', 'exit', 'overview'];

interface Props {
  ticket: WeighingTicket | null | undefined;
  /** Optional explicit photos; otherwise loaded from TicketPhotosStorage. */
  photos?: TicketPhoto[];
  className?: string;
  compact?: boolean;
  showActions?: boolean;
}

interface PreviewItem {
  role: CameraRole;
  path: string;
  label: string;
}

function collectFromStubs(ticket: WeighingTicket): PreviewItem[] {
  const items: PreviewItem[] = [];
  const stubs: Array<[CameraRole, string | null | undefined]> = [
    ['entry', ticket.photo_entry_path],
    ['exit', ticket.photo_exit_path],
    ['overview', ticket.photo_overview_path],
  ];
  for (const [role, path] of stubs) {
    if (path) {
      items.push({ role, path, label: CAMERA_ROLE_LABELS[role] });
    }
  }
  return items;
}

function collectFromPhotos(photos: TicketPhoto[]): PreviewItem[] {
  const byRole = new Map<CameraRole, string>();
  for (const photo of photos) {
    if (photo.status !== 'ok' || !photo.relative_path) continue;
    byRole.set(photo.camera_role, photo.relative_path);
  }
  return ROLE_ORDER.filter((r) => byRole.has(r)).map((role) => ({
    role,
    path: byRole.get(role)!,
    label: CAMERA_ROLE_LABELS[role],
  }));
}

function resolveFallbackMessage(photos: TicketPhoto[]): { text: string; tone: string } {
  const failed = photos.find(
    (photo) => photo.status === 'failed' && typeof photo.error_message === 'string' && photo.error_message.trim(),
  );
  if (failed?.error_message) {
    return {
      text: `Фотофиксация недоступна: ${failed.error_message}`,
      tone: 'text-rose-600',
    };
  }
  const skipped = photos.find(
    (photo) => photo.status === 'skipped' && typeof photo.error_message === 'string' && photo.error_message.trim(),
  );
  if (skipped?.error_message) {
    return {
      text: `Фотофиксация пропущена: ${skipped.error_message}`,
      tone: 'text-amber-600',
    };
  }
  if (photos.some((photo) => photo.status === 'failed')) {
    return { text: 'Фотофиксация недоступна', tone: 'text-rose-600' };
  }
  if (photos.some((photo) => photo.status === 'skipped')) {
    return { text: 'Фотофиксация пропущена', tone: 'text-amber-600' };
  }
  return { text: 'Фотофиксация отсутствует', tone: 'text-slate-400' };
}

function downloadPhoto(relativePath: string, downloadName: string): void {
  const href = photoUrl(relativePath);
  if (!href) return;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = downloadName;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.click();
}

function printPhoto(src: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  const safeTitle = title.replace(/[&<>"']/g, '');
  win.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
  .sheet { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style>
</head>
<body>
  <div class="sheet">
    <img src="${src}" alt="${safeTitle}" />
  </div>
</body>
</html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 300);
}

export function TicketPhotoPreview({
  ticket,
  photos,
  className = '',
  compact,
  showActions = false,
}: Props) {
  if (!ticket) return null;

  const fromStorage = photos ?? TicketPhotosStorage.forTicket(ticket.id);
  let items = collectFromPhotos(fromStorage);
  if (items.length === 0) {
    items = collectFromStubs(ticket);
  }

  if (items.length === 0) {
    const fallback = resolveFallbackMessage(fromStorage);
    return (
      <div className={`text-xs ${fallback.tone} ${className}`}>
        {fallback.text}
      </div>
    );
  }

  return (
    <div className={className}>
      {!compact && (
        <h4 className="mb-2 text-sm font-semibold text-slate-800">Фотофиксация</h4>
      )}
      <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {items.map((item) => {
          const src = photoUrl(item.path);
          return (
            <div key={item.role} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                {item.label}
              </div>
              {src ? (
                <>
                  <img
                    src={src}
                    alt={item.label}
                    className={`w-full object-cover ${compact ? 'h-16' : 'h-28'}`}
                    loading="lazy"
                  />
                  {showActions && !compact && (
                    <div className="flex gap-2 border-t border-slate-100 bg-white px-2 py-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadPhoto(
                            item.path,
                            `${ticket.ticket_number ?? ticket.id}_${item.role}.jpg`,
                          )
                        }
                        className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => printPhoto(src, `${item.label} №${ticket.ticket_number ?? '—'}`)}
                        className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Печать
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className={`flex items-center justify-center text-xs text-slate-400 ${compact ? 'h-16' : 'h-28'}`}>
                  —
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
