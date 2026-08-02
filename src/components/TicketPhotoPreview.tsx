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

export function TicketPhotoPreview({ ticket, photos, className = '', compact }: Props) {
  if (!ticket) return null;

  const fromStorage = photos ?? TicketPhotosStorage.forTicket(ticket.id);
  let items = collectFromPhotos(fromStorage);
  if (items.length === 0) {
    items = collectFromStubs(ticket);
  }

  if (items.length === 0) {
    return (
      <div className={`text-xs text-slate-400 ${className}`}>
        Фотофиксация отсутствует
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
                <img
                  src={src}
                  alt={item.label}
                  className={`w-full object-cover ${compact ? 'h-16' : 'h-28'}`}
                  loading="lazy"
                />
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
