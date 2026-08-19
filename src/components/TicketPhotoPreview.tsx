import { photoUrl, CAMERA_ROLE_LABELS } from '@/lib/cameras';
import type {
  Camera,
  CameraRole,
  PhotoPhase,
  TicketPhoto,
  WeighingTicket,
} from '@/lib/storage';
import {
  CamerasStorage,
  SettingsStorage,
  TicketPhotosStorage,
} from '@/lib/storage';

interface Props {
  ticket: WeighingTicket | null | undefined;
  /** Optional explicit photos; otherwise loaded from TicketPhotosStorage. */
  photos?: TicketPhoto[];
  /** Site for enabled-camera slots; defaults to ticket.site_id. */
  siteId?: string | null;
  /** When true, missing slots are emphasized as expected. */
  videoExpected?: boolean;
  className?: string;
  compact?: boolean;
}

export interface PhotoPreviewSlot {
  key: string;
  role: CameraRole;
  label: string;
  cameraName?: string;
  status: 'ok' | 'failed' | 'skipped' | 'missing';
  relative_path: string | null;
  error_message?: string | null;
  phase?: PhotoPhase;
}

function latestPhotoForCamera(photos: TicketPhoto[], cameraId: string): TicketPhoto | undefined {
  const matched = photos.filter((p) => p.camera_id === cameraId);
  if (matched.length === 0) return undefined;
  return matched.reduce((best, cur) => (cur.created_at >= best.created_at ? cur : best));
}

function latestPhotoForRole(photos: TicketPhoto[], role: CameraRole): TicketPhoto | undefined {
  const matched = photos.filter((p) => p.camera_role === role && !p.camera_id);
  if (matched.length === 0) {
    const byRole = photos.filter((p) => p.camera_role === role);
    if (byRole.length === 0) return undefined;
    return byRole.reduce((best, cur) => (cur.created_at >= best.created_at ? cur : best));
  }
  return matched.reduce((best, cur) => (cur.created_at >= best.created_at ? cur : best));
}

function roleCounts(cameras: Camera[]): Map<CameraRole, number> {
  const counts = new Map<CameraRole, number>();
  for (const cam of cameras) {
    counts.set(cam.role, (counts.get(cam.role) ?? 0) + 1);
  }
  return counts;
}

function buildSlotsFromCameras(
  cameras: Camera[],
  photos: TicketPhoto[],
  expectCapture: boolean,
): PhotoPreviewSlot[] {
  const counts = roleCounts(cameras);
  return cameras.map((cam) => {
    const photo = latestPhotoForCamera(photos, cam.id) ?? latestPhotoForRole(photos, cam.role);
    const showName = (counts.get(cam.role) ?? 0) > 1;
    const label = showName
      ? `${CAMERA_ROLE_LABELS[cam.role]} · ${cam.name}`
      : CAMERA_ROLE_LABELS[cam.role];
    if (!photo) {
      return {
        key: cam.id,
        role: cam.role,
        label,
        cameraName: cam.name,
        status: expectCapture ? 'missing' : 'skipped',
        relative_path: null,
      };
    }
    return {
      key: cam.id,
      role: cam.role,
      label,
      cameraName: cam.name,
      status: photo.status,
      relative_path: photo.relative_path,
      error_message: photo.error_message,
      phase: photo.phase,
    };
  });
}

function buildSlotsFromPhotos(photos: TicketPhoto[]): PhotoPreviewSlot[] {
  const byKey = new Map<string, TicketPhoto>();
  for (const photo of photos) {
    const key = photo.camera_id || `${photo.camera_role}:${photo.phase}`;
    const prev = byKey.get(key);
    if (!prev || photo.created_at >= prev.created_at) {
      byKey.set(key, photo);
    }
  }
  return Array.from(byKey.entries()).map(([key, photo]) => ({
    key,
    role: photo.camera_role,
    label: CAMERA_ROLE_LABELS[photo.camera_role],
    status: photo.status,
    relative_path: photo.relative_path,
    error_message: photo.error_message,
    phase: photo.phase,
  }));
}

function buildSlotsFromStubs(ticket: WeighingTicket): PhotoPreviewSlot[] {
  const stubs: Array<[CameraRole, string | null | undefined]> = [
    ['entry', ticket.photo_entry_path],
    ['exit', ticket.photo_exit_path],
    ['overview', ticket.photo_overview_path],
  ];
  const slots: PhotoPreviewSlot[] = [];
  for (const [role, path] of stubs) {
    if (!path) continue;
    slots.push({
      key: `stub-${role}`,
      role,
      label: CAMERA_ROLE_LABELS[role],
      status: 'ok',
      relative_path: path,
    });
  }
  return slots;
}

export function buildPhotoPreviewSlots(
  ticket: WeighingTicket,
  photos: TicketPhoto[],
  options?: { siteId?: string | null; videoExpected?: boolean },
): PhotoPreviewSlot[] {
  const siteId = options?.siteId ?? ticket.site_id;
  const videoEnabled =
    options?.videoExpected ?? SettingsStorage.getAppSettings().video_enabled;
  const cameras = siteId
    ? CamerasStorage.forSite(siteId).filter((c) => c.enabled)
    : [];
  const expectCapture = videoEnabled || photos.length > 0;

  if (cameras.length > 0) {
    return buildSlotsFromCameras(cameras, photos, expectCapture);
  }
  if (photos.length > 0) {
    return buildSlotsFromPhotos(photos);
  }
  return buildSlotsFromStubs(ticket);
}

function statusLabel(status: PhotoPreviewSlot['status']): string {
  switch (status) {
    case 'ok':
      return 'Снимок';
    case 'failed':
      return 'Ошибка';
    case 'skipped':
      return 'Пропущено';
    case 'missing':
      return 'Нет снимка';
  }
}

function slotBorderClass(status: PhotoPreviewSlot['status']): string {
  if (status === 'failed') return 'border-red-300 bg-red-50/40';
  if (status === 'missing') return 'border-amber-200 bg-amber-50/30';
  return 'border-slate-200 bg-slate-50';
}

export function TicketPhotoPreview({
  ticket,
  photos,
  siteId,
  videoExpected,
  className = '',
  compact,
}: Props) {
  if (!ticket) return null;

  const fromStorage = photos ?? TicketPhotosStorage.forTicket(ticket.id);
  const videoEnabled =
    videoExpected ?? SettingsStorage.getAppSettings().video_enabled;
  const slots = buildPhotoPreviewSlots(ticket, fromStorage, { siteId, videoExpected });

  if (slots.length === 0) {
    return (
      <div className={`text-xs text-slate-400 ${className}`}>
        {videoEnabled ? 'Фотофиксация отсутствует' : 'Фотофиксация отключена'}
      </div>
    );
  }

  return (
    <div className={className}>
      {!compact && (
        <h4 className="mb-2 text-sm font-semibold text-slate-800">Фотофиксация</h4>
      )}
      <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {slots.map((slot) => {
          const src = slot.status === 'ok' ? photoUrl(slot.relative_path) : null;
          return (
            <div
              key={slot.key}
              className={`overflow-hidden rounded-lg border ${slotBorderClass(slot.status)}`}
            >
              <div className="flex items-center justify-between gap-1 border-b border-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                <span className="truncate">{slot.label}</span>
                {slot.status !== 'ok' && (
                  <span
                    className={
                      slot.status === 'failed'
                        ? 'shrink-0 text-red-600'
                        : 'shrink-0 text-slate-400'
                    }
                  >
                    {statusLabel(slot.status)}
                  </span>
                )}
              </div>
              {src ? (
                <img
                  src={src}
                  alt={slot.label}
                  className={`w-full object-cover ${compact ? 'h-16' : 'h-28'}`}
                  loading="lazy"
                />
              ) : (
                <div
                  className={`flex flex-col items-center justify-center gap-0.5 px-2 text-center text-xs ${
                    compact ? 'h-16' : 'h-28'
                  } ${
                    slot.status === 'failed'
                      ? 'text-red-600'
                      : slot.status === 'missing'
                        ? 'text-amber-700'
                        : 'text-slate-400'
                  }`}
                >
                  <span>{statusLabel(slot.status)}</span>
                  {!compact && slot.error_message && (
                    <span className="line-clamp-2 text-[10px] opacity-80">{slot.error_message}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
