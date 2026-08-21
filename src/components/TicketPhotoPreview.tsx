import { useEffect, useState, type MouseEvent } from 'react';
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

export interface PhotoPreviewGroup {
  /** null = flat mode (single phase or stubs). */
  phase: PhotoPhase | null;
  /** "Тара" | "Брутто" | null (null → do not render group heading). */
  title: string | null;
  slots: PhotoPreviewSlot[];
}

const PHASE_LABELS: Record<PhotoPhase, string> = {
  tare: 'Тара',
  gross: 'Брутто',
};

const PHASE_ORDER: PhotoPhase[] = ['tare', 'gross'];

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

function slotKey(cameraIdOrRole: string, phase: PhotoPhase | null | undefined): string {
  return phase ? `${cameraIdOrRole}|${phase}` : cameraIdOrRole;
}

function buildSlotsFromCameras(
  cameras: Camera[],
  photos: TicketPhoto[],
  expectCapture: boolean,
  phase: PhotoPhase | null,
): PhotoPreviewSlot[] {
  const counts = roleCounts(cameras);
  return cameras.map((cam) => {
    const photo = latestPhotoForCamera(photos, cam.id) ?? latestPhotoForRole(photos, cam.role);
    const showName = (counts.get(cam.role) ?? 0) > 1;
    const label = showName
      ? `${CAMERA_ROLE_LABELS[cam.role]} · ${cam.name}`
      : CAMERA_ROLE_LABELS[cam.role];
    const key = slotKey(cam.id, phase);
    if (!photo) {
      return {
        key,
        role: cam.role,
        label,
        cameraName: cam.name,
        status: expectCapture ? 'missing' : 'skipped',
        relative_path: null,
        phase: phase ?? undefined,
      };
    }
    return {
      key,
      role: cam.role,
      label,
      cameraName: cam.name,
      status: photo.status,
      relative_path: photo.relative_path,
      error_message: photo.error_message,
      phase: photo.phase ?? phase ?? undefined,
    };
  });
}

function buildSlotsFromPhotos(photos: TicketPhoto[]): PhotoPreviewSlot[] {
  const byKey = new Map<string, TicketPhoto>();
  for (const photo of photos) {
    const key = photo.camera_id
      ? `${photo.camera_id}|${photo.phase}`
      : `${photo.camera_role}:${photo.phase}`;
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

function minCreatedAtForPhase(photos: TicketPhoto[], phase: PhotoPhase): string | null {
  let min: string | null = null;
  for (const photo of photos) {
    if (photo.phase !== phase) continue;
    if (min === null || photo.created_at < min) min = photo.created_at;
  }
  return min;
}

function phasesPresentOrdered(photos: TicketPhoto[]): PhotoPhase[] {
  const seen = new Set<PhotoPhase>();
  const withMin: Array<{ phase: PhotoPhase; minAt: string }> = [];
  for (const photo of photos) {
    if (seen.has(photo.phase)) continue;
    seen.add(photo.phase);
    const minAt = minCreatedAtForPhase(photos, photo.phase) ?? photo.created_at;
    withMin.push({ phase: photo.phase, minAt });
  }
  withMin.sort((a, b) => {
    if (a.minAt !== b.minAt) return a.minAt < b.minAt ? -1 : 1;
    return PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase);
  });
  return withMin.map((x) => x.phase);
}

function ticketPhaseDatetime(ticket: WeighingTicket, phase: PhotoPhase): string | null {
  if (phase === 'tare') return ticket.tare_datetime || null;
  return ticket.gross_datetime || null;
}

function sortPhasesForGroups(
  ticket: WeighingTicket,
  photos: TicketPhoto[],
  phases: PhotoPhase[],
): PhotoPhase[] {
  return [...phases].sort((a, b) => {
    const dtA = ticketPhaseDatetime(ticket, a);
    const dtB = ticketPhaseDatetime(ticket, b);
    if (dtA && dtB && dtA !== dtB) return dtA < dtB ? -1 : 1;
    if (dtA && !dtB) return -1;
    if (!dtA && dtB) return 1;
    const ca = minCreatedAtForPhase(photos, a);
    const cb = minCreatedAtForPhase(photos, b);
    if (ca && cb && ca !== cb) return ca < cb ? -1 : 1;
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b);
  });
}

function buildSlotsForPhotosSubset(
  cameras: Camera[],
  photos: TicketPhoto[],
  expectCapture: boolean,
  phase: PhotoPhase | null,
): PhotoPreviewSlot[] {
  if (cameras.length > 0) {
    return buildSlotsFromCameras(cameras, photos, expectCapture, phase);
  }
  if (photos.length > 0) {
    return buildSlotsFromPhotos(photos);
  }
  return [];
}

export function buildPhotoPreviewGroups(
  ticket: WeighingTicket,
  photos: TicketPhoto[],
  options?: { siteId?: string | null; videoExpected?: boolean },
): PhotoPreviewGroup[] {
  const siteId = options?.siteId ?? ticket.site_id;
  const videoEnabled =
    options?.videoExpected ?? SettingsStorage.getAppSettings().video_enabled;
  const cameras = siteId
    ? CamerasStorage.forSite(siteId).filter((c) => c.enabled)
    : [];
  const expectCapture = videoEnabled || photos.length > 0;

  if (photos.length === 0) {
    const slots =
      cameras.length > 0
        ? buildSlotsFromCameras(cameras, [], expectCapture, null)
        : buildSlotsFromStubs(ticket);
    return slots.length > 0 ? [{ phase: null, title: null, slots }] : [];
  }

  const present = phasesPresentOrdered(photos);
  const useGroups = present.length >= 2;

  if (!useGroups) {
    const onlyPhase = present[0] ?? null;
    const slots = buildSlotsForPhotosSubset(cameras, photos, expectCapture, onlyPhase);
    return [{ phase: onlyPhase, title: null, slots }];
  }

  const ordered = sortPhasesForGroups(ticket, photos, present);
  return ordered.map((phase) => {
    const phasePhotos = photos.filter((p) => p.phase === phase);
    return {
      phase,
      title: PHASE_LABELS[phase],
      slots: buildSlotsForPhotosSubset(cameras, phasePhotos, expectCapture, phase),
    };
  });
}

export function buildPhotoPreviewSlots(
  ticket: WeighingTicket,
  photos: TicketPhoto[],
  options?: { siteId?: string | null; videoExpected?: boolean },
): PhotoPreviewSlot[] {
  return buildPhotoPreviewGroups(ticket, photos, options).flatMap((g) => g.slots);
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

function lightboxTitle(slot: PhotoPreviewSlot, groupTitle: string | null): string {
  if (groupTitle) return `${groupTitle} · ${slot.label}`;
  if (slot.phase) return `${PHASE_LABELS[slot.phase]} · ${slot.label}`;
  return slot.label;
}

type LightboxState = { src: string; title: string };

function PhotoLightbox({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stopImgClick = (event: MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-full max-w-5xl flex-col items-center gap-3"
        onClick={stopImgClick}
      >
        <div className="flex w-full items-center justify-between gap-3 text-white">
          <p className="truncate text-sm font-medium">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
          >
            Закрыть
          </button>
        </div>
        <img
          src={src}
          alt={title}
          className="max-h-[85vh] max-w-full object-contain"
        />
      </div>
    </div>
  );
}

function SlotGrid({
  slots,
  groupTitle,
  compact,
  onOpen,
}: {
  slots: PhotoPreviewSlot[];
  groupTitle: string | null;
  compact?: boolean;
  onOpen: (state: LightboxState) => void;
}) {
  return (
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
              <button
                type="button"
                className="block w-full cursor-pointer p-0"
                title="Увеличить"
                onClick={() => onOpen({ src, title: lightboxTitle(slot, groupTitle) })}
              >
                <img
                  src={src}
                  alt={slot.label}
                  className={`w-full object-cover ${compact ? 'h-16' : 'h-28'}`}
                  loading="lazy"
                />
              </button>
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
  );
}

export function TicketPhotoPreview({
  ticket,
  photos,
  siteId,
  videoExpected,
  className = '',
  compact,
}: Props) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  if (!ticket) return null;

  const fromStorage = photos ?? TicketPhotosStorage.forTicket(ticket.id);
  const videoEnabled =
    videoExpected ?? SettingsStorage.getAppSettings().video_enabled;
  const groups = buildPhotoPreviewGroups(ticket, fromStorage, { siteId, videoExpected });
  const hasSlots = groups.some((g) => g.slots.length > 0);

  if (!hasSlots) {
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
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.phase ?? 'flat'}>
            {group.title != null && (
              <h5 className="mb-1.5 text-xs font-semibold text-slate-700">{group.title}</h5>
            )}
            <SlotGrid
              slots={group.slots}
              groupTitle={group.title}
              compact={compact}
              onOpen={setLightbox}
            />
          </div>
        ))}
      </div>
      {lightbox && (
        <PhotoLightbox
          src={lightbox.src}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
