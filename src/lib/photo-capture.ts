/**
 * Capture orchestration after weight persist: flush → capture → merge → flush.
 * Errors and degrade must never roll back ticket weight fields.
 */
import {
  TicketPhotoStorage,
  TicketStorage,
  type TicketPhoto,
  type WeighingTicket,
} from '@/lib/storage';
import {
  ApiRequestError,
  postCameraCapture,
  type CameraCaptureResponse,
} from '@/lib/api';
import { ACTIVE_WRITE_BLOCKED_EVENT, flushDatabaseSync } from '@/lib/storage-sync';
import { logger } from '@/lib/logger';

/** Capture phase tied to a weight fixation (gross | tare). */
type CaptureEvent = 'gross' | 'tare';

/** Soft UI feedback for capture degrade / rotation / missing ticket. */
export interface CaptureAfterWeightResult {
  capture: CameraCaptureResponse | null;
  /** Non-blocking message for amber toast; null on quiet success/noop. */
  warning: string | null;
}

/**
 * Merge capture response stubs into ticket photo_* fields.
 *
 * Rules:
 * - noop → preserve existing stubs
 * - non-null path from response → take it
 * - null from response → apply only when capture_token is present; otherwise preserve
 * - absent key → preserve
 */
export function mergeTicketPhotoStubsFromCapture(
  current: { photo_entry_path?: string | null; photo_exit_path?: string | null },
  capture: Pick<
    CameraCaptureResponse,
    'photo_entry_path' | 'photo_exit_path' | 'noop' | 'capture_token'
  >,
): { photo_entry_path: string | null; photo_exit_path: string | null } {
  if (capture.noop) {
    return {
      photo_entry_path: current.photo_entry_path ?? null,
      photo_exit_path: current.photo_exit_path ?? null,
    };
  }

  const hasToken =
    typeof capture.capture_token === 'string' && capture.capture_token.trim() !== '';

  const resolveStub = (
    key: 'photo_entry_path' | 'photo_exit_path',
    currentValue: string | null | undefined,
  ): string | null => {
    if (!Object.prototype.hasOwnProperty.call(capture, key)) {
      return currentValue ?? null;
    }
    const incoming = capture[key];
    if (incoming == null || incoming === '') {
      if (hasToken) return null;
      return currentValue ?? null;
    }
    return String(incoming);
  };

  return {
    photo_entry_path: resolveStub('photo_entry_path', current.photo_entry_path),
    photo_exit_path: resolveStub('photo_exit_path', current.photo_exit_path),
  };
}

/**
 * Build a soft degrade message for mixed / all-failed capture results.
 *
 * Args:
 *   capture: Successful capture response (not noop)
 *
 * Returns:
 *   Russian UI string or null when all cameras succeeded / empty results
 */
export function summarizeCaptureResults(
  capture: CameraCaptureResponse | null,
): string | null {
  if (!capture || capture.noop) return null;
  const results = Array.isArray(capture.results) ? capture.results : [];
  if (results.length === 0) return null;
  const failed = results.filter((row) => row.status !== 'success');
  if (failed.length === 0) return null;
  const ok = results.length - failed.length;
  if (ok === 0) {
    return 'Снимки недоступны: взвешивание сохранено без фото.';
  }
  return `Снято ${ok} из ${results.length}. Взвешивание сохранено.`;
}

/**
 * Apply capture response to local ticket stubs and app_ticket_photos (upsert only).
 *
 * Must run immediately after capture and before any other ticket persist.
 * Never assigns `app_ticket_photos = response.ticket_photos`.
 *
 * Args:
 *   ticketId: Ticket that was captured
 *   capture: Response from POST /api/cameras/capture
 */
export function applyCaptureMergeToStorage(
  ticketId: string,
  capture: CameraCaptureResponse,
): void {
  const ticket = TicketStorage.getById(ticketId);
  if (ticket) {
    const stubs = mergeTicketPhotoStubsFromCapture(ticket, capture);
    const patch: Partial<WeighingTicket> = {
      photo_entry_path: stubs.photo_entry_path,
      photo_exit_path: stubs.photo_exit_path,
    };
    if (typeof capture.capture_token === 'string' && capture.capture_token.trim()) {
      patch.capture_token = capture.capture_token;
    }
    TicketStorage.update(ticketId, patch);
  }

  const capturePhotos = Array.isArray(capture.ticket_photos) ? capture.ticket_photos : [];
  if (capturePhotos.length > 0) {
    TicketPhotoStorage.upsertMany(capturePhotos as unknown as TicketPhoto[]);
  }
}

/**
 * After weight persist: flush → capture → merge stubs/photos → flush.
 *
 * Network / ticket_not_found / rotation errors do not roll back the ticket weight.
 *
 * Args:
 *   ticketId: Persisted ticket id (must exist in active DB after first flush)
 *   event: Capture phase (gross | tare)
 *
 * Returns:
 *   Capture payload (or null on request failure) plus optional soft warning
 */
export async function captureAfterWeightPersist(
  ticketId: string,
  event: CaptureEvent,
): Promise<CaptureAfterWeightResult> {
  try {
    await flushDatabaseSync();
  } catch (error) {
    logger.warn('cameras', 'flush before capture failed', { ticketId, event, error });
  }

  let capture: CameraCaptureResponse;
  try {
    capture = await postCameraCapture({ ticket_id: ticketId, event });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.code === 'ticket_not_found' || error.status === 404) {
        logger.warn('cameras', 'capture skipped: ticket_not_found', { ticketId, event });
        return {
          capture: null,
          warning: 'Снимки не сделаны: тикет ещё не в базе. Взвешивание сохранено.',
        };
      }
      if (error.code === 'rotation_in_progress' || error.status === 409) {
        logger.warn('cameras', 'capture blocked: rotation_in_progress', { ticketId, event });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(ACTIVE_WRITE_BLOCKED_EVENT, {
              detail: {
                code: 'rotation_in_progress',
                message: 'Смена года не завершена: запись и съёмка временно недоступны.',
              },
            }),
          );
        }
        return {
          capture: null,
          warning:
            'Смена года не завершена: съёмка временно недоступна. Взвешивание сохранено.',
        };
      }
    }
    logger.warn('cameras', 'capture request failed', { ticketId, event, error });
    return {
      capture: null,
      warning: 'Не удалось сделать снимки. Взвешивание сохранено.',
    };
  }

  // Immediate merge before any other ticket persist (including noop preserve path).
  try {
    applyCaptureMergeToStorage(ticketId, capture);
  } catch (error) {
    // Client-only: do not echo server URL/detail; never roll back weight.
    logger.warn('cameras', 'capture merge failed', {
      ticketId,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      capture,
      warning: 'Не удалось применить снимки локально. Взвешивание сохранено.',
    };
  }

  try {
    await flushDatabaseSync();
  } catch (error) {
    logger.warn('cameras', 'flush after capture failed', { ticketId, event, error });
  }

  if (capture.noop) {
    return { capture, warning: null };
  }

  return { capture, warning: summarizeCaptureResults(capture) };
}
