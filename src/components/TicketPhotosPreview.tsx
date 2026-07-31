import { useState } from 'react';

import { PhotoLightbox } from '@/components/PhotoLightbox';
import type { TicketPhoto } from '@/lib/cameras';
import { CAMERA_ROLE_LABELS } from '@/lib/cameras';
import {
  countAvailablePreviews,
  groupPhotosByEvent,
  photoApiUrl,
  selectSuccessPreviewPhotos,
} from '@/lib/ticket-photos-preview';
import { TicketPhotoStorage } from '@/lib/storage';

export interface TicketPhotosPreviewProps {
  /** Active-year ticket id — photos loaded from TicketPhotoStorage. */
  ticketId?: string;
  /**
   * Explicit photo rows (tests / callers that already hold ticket_photos).
   * When set, ticketId storage lookup is skipped.
   */
  photos?: TicketPhoto[];
}

/**
 * Preview of successful ticket photos grouped by gross/tare with lightbox.
 *
 * Missing files (img onError) show «Файл недоступен» and are excluded from
 * the available-preview count. Empty set shows «Нет снимков».
 */
export function TicketPhotosPreview({ ticketId, photos: photosProp }: TicketPhotosPreviewProps) {
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // Read storage each render so capture merge updates appear without remount.
  const photos: TicketPhoto[] = Array.isArray(photosProp)
    ? photosProp
    : ticketId
      ? TicketPhotoStorage.getByTicket(ticketId)
      : [];

  const groups = groupPhotosByEvent(photos);
  const successCount = selectSuccessPreviewPhotos(photos).length;
  const availableCount = countAvailablePreviews(photos, unavailableIds);

  const markUnavailable = (photoId: string) => {
    setUnavailableIds((prev) => {
      if (prev.has(photoId)) return prev;
      const next = new Set(prev);
      next.add(photoId);
      return next;
    });
  };

  if (successCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
        Нет снимков
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-slate-600">
        Снимки ({availableCount}
        {unavailableIds.size > 0 ? ` из ${successCount}` : ''})
      </div>
      {groups.map((group) => (
        <div key={group.event} className="space-y-1.5" data-event={group.event}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {group.label}
          </div>
          <ul className="grid grid-cols-2 gap-2">
            {group.photos.map((photo) => {
              const unavailable = unavailableIds.has(photo.id);
              const roleLabel = CAMERA_ROLE_LABELS[photo.camera_role] || photo.camera_role;
              const alt = `${roleLabel} / ${group.label}`;
              const src = photoApiUrl(photo.file_path!);

              return (
                <li
                  key={photo.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  data-photo-id={photo.id}
                  data-unavailable={unavailable ? 'true' : 'false'}
                >
                  {unavailable ? (
                    <div className="flex h-24 items-center justify-center bg-slate-100 px-2 text-center text-[11px] text-slate-500">
                      Файл недоступен
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() => setLightbox({ src, alt })}
                      title="Увеличить"
                    >
                      <img
                        src={src}
                        alt={alt}
                        className="h-24 w-full object-cover bg-slate-100"
                        onError={() => markUnavailable(photo.id)}
                      />
                    </button>
                  )}
                  <div className="px-2 py-1 text-[11px] text-slate-500">
                    {roleLabel} · {group.label.toLowerCase()}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {lightbox && (
        <PhotoLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
