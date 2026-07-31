/**
 * Camera / ticket-photo domain types and capture helpers.
 * Weight-persist capture orchestration lives in photo-capture.ts.
 */
import {
  CameraStorage,
  upsertTicketPhotosFromCapture,
} from '@/lib/storage';
import {
  postCameraEtalon,
  type CameraEtalonResponse,
} from '@/lib/api';
import { flushDatabaseSync } from '@/lib/storage-sync';
import { logger } from '@/lib/logger';

/** Maximum cameras allowed per site_id (server + UI). */
export const MAX_CAMERAS_PER_SITE = 4;

/** Camera role on a site. */
export type CameraRole = 'entry' | 'exit' | 'overview';

/** Russian labels for camera roles. */
export const CAMERA_ROLE_LABELS: Record<CameraRole, string> = {
  entry: 'Въезд',
  exit: 'Выезд',
  overview: 'Обзор',
};

/** Capture phase tied to a weight fixation. */
export type CaptureEvent = 'gross' | 'tare';

/** Ticket photo status. */
export type TicketPhotoStatus = 'success' | 'failed';

/** Camera registry row (sync: app_cameras). */
export interface Camera {
  id: string;
  site_id: string;
  name: string;
  role: CameraRole;
  http_snapshot_url: string | null;
  rtsp_url: string | null;
  enabled: boolean;
  roi_x: number | null;
  roi_y: number | null;
  roi_w: number | null;
  roi_h: number | null;
  etalon_primary_path: string | null;
  etalon_spare_path: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Draft fields for add/edit camera form (UI). */
export interface CameraFormDraft {
  id: string | null;
  name: string;
  role: CameraRole;
  http_snapshot_url: string;
  rtsp_url: string;
  enabled: boolean;
  roi_x: string;
  roi_y: string;
  roi_w: string;
  roi_h: string;
  sort_order: number;
  /** Original secrets kept when URL input was not edited. */
  original_http_snapshot_url: string | null;
  original_rtsp_url: string | null;
  http_url_dirty: boolean;
  rtsp_url_dirty: boolean;
}

const SENSITIVE_QUERY_KEYS = new Set(['password', 'pass', 'token', 'key']);

/**
 * Mask credentials in URL userinfo and sensitive query parameters.
 * Mirrors server ``cameras.mask_url`` for UI display.
 */
export function maskCameraUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    const params = new URLSearchParams(parsed.search);
    let changed = false;
    params.forEach((value, key) => {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        params.set(key, '***');
        changed = true;
      }
    });
    if (changed) {
      parsed.search = params.toString();
    }
    return parsed.toString();
  } catch {
    // Fallback for non-standard URLs (e.g. rtsp without full WHATWG support quirks).
    return url
      .replace(/(:\/\/[^:/?#]+:)([^@/?#]*)(@)/, '$1***$3')
      .replace(/([?&](?:password|pass|token|key)=)([^&]*)/gi, '$1***');
  }
}

/**
 * Resolve URL for save: keep original secret when the field was not edited.
 */
export function resolveCameraUrlForSave(
  draftValue: string,
  original: string | null,
  dirty: boolean,
): string | null {
  const trimmed = draftValue.trim();
  if (!dirty) {
    return original && original.trim() ? original : trimmed || null;
  }
  if (!trimmed) return null;
  // Do not persist a masked placeholder as the real URL.
  if (trimmed.includes(':***@') || /[?&](?:password|pass|token|key)=\*\*\*/i.test(trimmed)) {
    return original && original.trim() ? original : null;
  }
  return trimmed;
}

/**
 * Parse optional ROI number from form string; empty → null.
 */
export function parseRoiField(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Validate ROI fields for overview (normalized [0..1], w/h > 0 when set).
 * Returns Russian error messages.
 */
export function validateCameraRoi(draft: Pick<CameraFormDraft, 'role' | 'roi_x' | 'roi_y' | 'roi_w' | 'roi_h'>): string[] {
  const errors: string[] = [];
  if (draft.role !== 'overview') {
    return errors;
  }
  const values: Array<{ name: string; value: number | null }> = [
    { name: 'roi_x', value: parseRoiField(draft.roi_x) },
    { name: 'roi_y', value: parseRoiField(draft.roi_y) },
    { name: 'roi_w', value: parseRoiField(draft.roi_w) },
    { name: 'roi_h', value: parseRoiField(draft.roi_h) },
  ];
  for (const { name, value } of values) {
    if (value === null) continue;
    if (Number.isNaN(value)) {
      errors.push(`${name}: укажите число`);
      continue;
    }
    if (value < 0 || value > 1) {
      errors.push(`${name}: значение должно быть в диапазоне [0..1]`);
    }
    if ((name === 'roi_w' || name === 'roi_h') && value <= 0) {
      errors.push(`${name}: значение должно быть > 0`);
    }
  }
  return errors;
}

/**
 * Validate camera form before save (enabled⇒URL, ROI, name).
 */
export function validateCameraForm(draft: CameraFormDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) {
    errors.push('Укажите имя камеры');
  }
  const http = resolveCameraUrlForSave(
    draft.http_snapshot_url,
    draft.original_http_snapshot_url,
    draft.http_url_dirty,
  );
  const rtsp = resolveCameraUrlForSave(
    draft.rtsp_url,
    draft.original_rtsp_url,
    draft.rtsp_url_dirty,
  );
  if (draft.enabled && !http && !rtsp) {
    errors.push('Для включённой камеры укажите HTTP snapshot URL или RTSP URL');
  }
  errors.push(...validateCameraRoi(draft));
  return errors;
}

/**
 * Whether a new camera can be added for the site (limit 4).
 */
export function canAddCamera(existingCount: number): boolean {
  return existingCount < MAX_CAMERAS_PER_SITE;
}

/**
 * Build empty draft for «Добавить камеру».
 */
export function createEmptyCameraDraft(sortOrder = 0): CameraFormDraft {
  return {
    id: null,
    name: '',
    role: 'entry',
    http_snapshot_url: '',
    rtsp_url: '',
    enabled: false,
    roi_x: '',
    roi_y: '',
    roi_w: '',
    roi_h: '',
    sort_order: sortOrder,
    original_http_snapshot_url: null,
    original_rtsp_url: null,
    http_url_dirty: false,
    rtsp_url_dirty: false,
  };
}

/**
 * Build edit draft from a stored camera (URLs shown masked; originals kept).
 */
export function createEditCameraDraft(camera: Camera): CameraFormDraft {
  return {
    id: camera.id,
    name: camera.name,
    role: camera.role,
    http_snapshot_url: maskCameraUrl(camera.http_snapshot_url),
    rtsp_url: maskCameraUrl(camera.rtsp_url),
    enabled: camera.enabled,
    roi_x: camera.roi_x === null || camera.roi_x === undefined ? '' : String(camera.roi_x),
    roi_y: camera.roi_y === null || camera.roi_y === undefined ? '' : String(camera.roi_y),
    roi_w: camera.roi_w === null || camera.roi_w === undefined ? '' : String(camera.roi_w),
    roi_h: camera.roi_h === null || camera.roi_h === undefined ? '' : String(camera.roi_h),
    sort_order: camera.sort_order,
    original_http_snapshot_url: camera.http_snapshot_url,
    original_rtsp_url: camera.rtsp_url,
    http_url_dirty: false,
    rtsp_url_dirty: false,
  };
}

/**
 * Convert validated draft to a Camera row for CameraStorage.
 */
export function cameraFromDraft(
  draft: CameraFormDraft,
  siteId: string,
  existing?: Camera | null,
): Camera {
  const now = new Date().toISOString();
  const http = resolveCameraUrlForSave(
    draft.http_snapshot_url,
    draft.original_http_snapshot_url,
    draft.http_url_dirty,
  );
  const rtsp = resolveCameraUrlForSave(
    draft.rtsp_url,
    draft.original_rtsp_url,
    draft.rtsp_url_dirty,
  );
  const roi =
    draft.role === 'overview'
      ? {
          roi_x: parseRoiField(draft.roi_x),
          roi_y: parseRoiField(draft.roi_y),
          roi_w: parseRoiField(draft.roi_w),
          roi_h: parseRoiField(draft.roi_h),
        }
      : { roi_x: null, roi_y: null, roi_w: null, roi_h: null };

  return {
    id: draft.id ?? crypto.randomUUID(),
    site_id: siteId,
    name: draft.name.trim(),
    role: draft.role,
    http_snapshot_url: http,
    rtsp_url: rtsp,
    enabled: draft.enabled,
    ...roi,
    etalon_primary_path: existing?.etalon_primary_path ?? null,
    etalon_spare_path: existing?.etalon_spare_path ?? null,
    sort_order: draft.sort_order,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

/** Ticket photo metadata row (sync: app_ticket_photos). */
export interface TicketPhoto {
  id: string;
  ticket_id: string;
  camera_id: string;
  camera_role: CameraRole;
  event: CaptureEvent;
  file_path: string | null;
  status: TicketPhotoStatus;
  error_code: string | null;
  captured_at: string;
  camera_mode: 'primary' | 'spare' | null;
}

/**
 * Merge etalon API ``camera`` into CameraStorage before any other camera persist.
 *
 * Prefer the response row; fall back to patching local row's etalon_*_path from ``path``.
 *
 * Args:
 *   response: Successful POST /api/cameras/etalon payload
 *   scaleSet: Which etalon slot was captured
 *
 * Returns:
 *   Upserted Camera row, or null if the response could not be applied
 */
export function mergeEtalonCaptureIntoCameraStorage(
  response: CameraEtalonResponse,
  scaleSet: 'primary' | 'spare',
): Camera | null {
  const fromResponse =
    response.camera && typeof response.camera === 'object'
      ? (response.camera as Record<string, unknown>)
      : null;
  const responseId = fromResponse ? String(fromResponse.id ?? '') : '';

  if (fromResponse && responseId) {
    const existing = CameraStorage.getAll().find((row) => row.id === responseId);
    const primaryFromResponse =
      typeof fromResponse.etalon_primary_path === 'string'
        ? fromResponse.etalon_primary_path
        : fromResponse.etalon_primary_path === null
          ? null
          : undefined;
    const spareFromResponse =
      typeof fromResponse.etalon_spare_path === 'string'
        ? fromResponse.etalon_spare_path
        : fromResponse.etalon_spare_path === null
          ? null
          : undefined;
    const mergedCandidate = {
      ...(existing ?? {}),
      ...fromResponse,
      etalon_primary_path:
        primaryFromResponse !== undefined
          ? primaryFromResponse
          : existing?.etalon_primary_path ??
            (scaleSet === 'primary' ? response.path : existing?.etalon_primary_path ?? null),
      etalon_spare_path:
        spareFromResponse !== undefined
          ? spareFromResponse
          : existing?.etalon_spare_path ??
            (scaleSet === 'spare' ? response.path : existing?.etalon_spare_path ?? null),
    };
    try {
      return CameraStorage.upsert(mergedCandidate as unknown as Camera);
    } catch (error) {
      logger.warn('cameras', 'etalon merge from response.camera failed', { error });
    }
  }

  // Fallback: patch local row by path only.
  if (!responseId || !response.path) {
    return null;
  }
  const local = CameraStorage.getAll().find((row) => row.id === responseId);
  if (!local) {
    return null;
  }
  const patched: Camera = {
    ...local,
    etalon_primary_path:
      scaleSet === 'primary' ? response.path : local.etalon_primary_path,
    etalon_spare_path: scaleSet === 'spare' ? response.path : local.etalon_spare_path,
    updated_at: new Date().toISOString(),
  };
  return CameraStorage.upsert(patched);
}

/**
 * Capture etalon for a camera: API → merge into CameraStorage → flush full app_cameras.
 *
 * Merge happens before flush (SoT contract). Errors do not wipe previous etalon paths.
 */
export async function captureEtalonAndFlush(
  cameraId: string,
  scaleSet: 'primary' | 'spare',
): Promise<CameraEtalonResponse> {
  const response = await postCameraEtalon({ camera_id: cameraId, scale_set: scaleSet });
  mergeEtalonCaptureIntoCameraStorage(response, scaleSet);
  await flushDatabaseSync();
  return response;
}

export { upsertTicketPhotosFromCapture };

export {
  applyCaptureMergeToStorage,
  captureAfterWeightPersist,
  mergeTicketPhotoStubsFromCapture,
  summarizeCaptureResults,
} from '@/lib/photo-capture';
export type { CaptureAfterWeightResult } from '@/lib/photo-capture';

export type {
  CameraCaptureResponse,
  CameraCapabilityResponse,
  CameraEtalonResponse,
} from '@/lib/api';
export {
  fetchCameraCapability,
  postCameraSnapshot,
  postCameraTest,
  postCameraEtalon,
  postCameraCapture,
} from '@/lib/api';
