/**
 * Camera registry and photo capture client (этап 7).
 */
import { apiGet, apiPost } from './api';
import {
  CamerasStorage,
  SettingsStorage,
  TicketPhotosStorage,
  TicketStorage,
  type Camera,
  type CameraRole,
  type CaptureKind,
  type PhotoPhase,
  type TicketPhoto,
} from './storage';
import {
  flushDatabaseSync,
  pauseDatabaseSync,
  resumeDatabaseSync,
} from './storage-sync';
import { logger } from './logger';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const MAX_CAMERAS_PER_SITE = 4;

/** Pause live weighing-monitor snapshots while ticket capture runs. */
export const CAPTURE_PAUSE_EVENT = 'weighing-capture-pause';
export const CAPTURE_RESUME_EVENT = 'weighing-capture-resume';

function dispatchCapturePause(paused: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(paused ? CAPTURE_PAUSE_EVENT : CAPTURE_RESUME_EVENT));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const schedule = typeof globalThis.setTimeout === 'function' ? globalThis.setTimeout : setTimeout;
    schedule(resolve, ms);
  });
}

export const CAMERA_ROLE_LABELS: Record<CameraRole, string> = {
  entry: 'Въезд',
  exit: 'Выезд',
  overview: 'Обзор',
};

export interface CameraCapabilities {
  success: boolean;
  capture_available: boolean;
  backends: string[];
  video_enabled: boolean;
  photo_root: string;
  opencv_available?: boolean;
}

let capsCache: CameraCapabilities | null = null;
let capsFetchedAt = 0;
const CAPS_TTL_MS = 30_000;

export async function fetchCapabilities(force = false): Promise<CameraCapabilities> {
  const now = Date.now();
  if (!force && capsCache && now - capsFetchedAt < CAPS_TTL_MS) {
    return capsCache;
  }
  try {
    const data = await apiGet<CameraCapabilities>('/api/cameras/capabilities');
    capsCache = data;
    capsFetchedAt = now;
    return data;
  } catch (err) {
    logger.warn('cameras', 'capabilities unavailable', err);
    const fallback: CameraCapabilities = {
      success: false,
      capture_available: false,
      backends: [],
      video_enabled: false,
      photo_root: 'Photo',
    };
    return fallback;
  }
}

export function photoUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const params = new URLSearchParams({ path: relativePath });
  return `${API_BASE}/api/cameras/photo?${params.toString()}`;
}

export function listCamerasForSite(siteId: string): Camera[] {
  return CamerasStorage.forSite(siteId);
}

export function enforceMaxCameras(siteId: string): boolean {
  return CamerasStorage.forSite(siteId).length < MAX_CAMERAS_PER_SITE;
}

export function upsertCamera(camera: Camera): Camera {
  const existing = CamerasStorage.forSite(camera.site_id);
  const isNew = !existing.some((c) => c.id === camera.id);
  if (isNew && existing.length >= MAX_CAMERAS_PER_SITE) {
    throw new Error(`Не более ${MAX_CAMERAS_PER_SITE} камер на площадку`);
  }
  return CamerasStorage.upsert(camera);
}

export function removeCamera(id: string): void {
  CamerasStorage.remove(id);
}

export function createCameraDraft(siteId: string, role: CameraRole = 'overview'): Camera {
  const existing = CamerasStorage.forSite(siteId);
  return {
    id: crypto.randomUUID(),
    site_id: siteId,
    role,
    name: CAMERA_ROLE_LABELS[role],
    capture_url: '',
    capture_kind: 'auto' as CaptureKind,
    enabled: true,
    sort_order: existing.length,
    roi: role === 'overview' ? { x: 0, y: 0, w: 1, h: 1 } : null,
    reference_normal_path: null,
    reference_spare_path: null,
    created_at: new Date().toISOString(),
  };
}

export interface CaptureResult {
  success: boolean;
  photos: TicketPhoto[];
  stubs: {
    photo_entry_path: string | null;
    photo_exit_path: string | null;
    photo_overview_path: string | null;
  };
}

export async function captureForTicket(
  ticketId: string,
  phase: PhotoPhase,
  siteId?: string | null,
): Promise<CaptureResult | null> {
  try {
    const result = await apiPost<CaptureResult>('/api/cameras/capture', {
      ticket_id: ticketId,
      phase,
      site_id: siteId ?? undefined,
    });
    if (result.photos?.length) {
      TicketPhotosStorage.merge(result.photos);
    }
    if (result.stubs) {
      TicketStorage.update(ticketId, {
        photo_entry_path: result.stubs.photo_entry_path,
        photo_exit_path: result.stubs.photo_exit_path,
        photo_overview_path: result.stubs.photo_overview_path,
      });
    }
    return result;
  } catch (err) {
    logger.warn('cameras', `capture failed ticket=${ticketId} phase=${phase}`, err);
    return null;
  }
}

/**
 * Capture after successful ticket save; never throws.
 * Flushes the ticket to SQLite before POST /api/cameras/capture (FK ticket_photos).
 * Callers may fire-and-forget (`void …then`) — awaits happen inside.
 */
export async function triggerCaptureAfterSave(
  ticketId: string,
  phases: PhotoPhase[],
  siteId?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!SettingsStorage.getAppSettings().video_enabled) {
    return { ok: true };
  }
  const enabledCameras = siteId
    ? CamerasStorage.forSite(siteId).filter((c) => c.enabled)
    : CamerasStorage.getAll().filter((c) => c.enabled);
  if (enabledCameras.length === 0) {
    return { ok: true };
  }

  let anyOk = false;
  let anyFail = false;

  // Stop live monitor so snapshot polling does not contend with ticket capture.
  dispatchCapturePause(true);
  pauseDatabaseSync();
  try {
    // Let in-flight monitor snapshots finish or abort before grabbing.
    await delay(400);

    try {
      await flushDatabaseSync();
    } catch (err) {
      logger.warn('cameras', `flush before capture failed ticket=${ticketId}`, err);
      return { ok: false, message: 'Фото недоступно' };
    }

    for (const phase of phases) {
      const result = await captureForTicket(ticketId, phase, siteId);
      if (result == null) {
        anyFail = true;
        continue;
      }
      const okCount = result.photos.filter((p) => p.status === 'ok').length;
      const failCount = result.photos.filter((p) => p.status === 'failed').length;
      if (okCount > 0) anyOk = true;
      if (failCount > 0 || result.photos.length === 0) anyFail = true;
    }
  } finally {
    resumeDatabaseSync();
    dispatchCapturePause(false);
  }

  try {
    await flushDatabaseSync();
  } catch (err) {
    logger.warn('cameras', `flush after capture failed ticket=${ticketId}`, err);
  }

  if (anyFail && !anyOk) {
    return { ok: false, message: 'Фото недоступно' };
  }
  if (anyFail) {
    return { ok: true, message: 'Часть фото недоступна' };
  }
  return { ok: true };
}

export async function saveReference(
  cameraId: string,
  mode: 'normal' | 'spare',
): Promise<Camera | null> {
  try {
    const result = await apiPost<{ success: boolean; camera: Camera }>(
      '/api/cameras/reference',
      { camera_id: cameraId, mode },
    );
    if (result.camera) {
      CamerasStorage.upsert(result.camera);
      return result.camera;
    }
    return null;
  } catch (err) {
    logger.warn('cameras', 'saveReference failed', err);
    throw err;
  }
}

export async function takeSnapshot(
  cameraIdOrOpts:
    | string
    | {
        cameraId?: string;
        captureUrl?: string;
        captureKind?: CaptureKind | string;
      },
): Promise<string | null> {
  const opts =
    typeof cameraIdOrOpts === 'string'
      ? { cameraId: cameraIdOrOpts }
      : cameraIdOrOpts;
  const body: Record<string, string> = {};
  if (opts.cameraId) body.camera_id = opts.cameraId;
  if (opts.captureUrl?.trim()) body.capture_url = opts.captureUrl.trim();
  if (opts.captureKind) body.capture_kind = String(opts.captureKind);
  if (!body.camera_id && !body.capture_url) {
    throw new Error('Укажите URL камеры или сохранённую камеру');
  }
  try {
    const result = await apiPost<{ success: boolean; relative_path?: string }>(
      '/api/cameras/snapshot',
      body,
    );
    return result.relative_path ?? null;
  } catch (err) {
    logger.warn('cameras', 'snapshot failed', err);
    throw err;
  }
}

/**
 * Whether settings UI for cameras should be shown.
 * Always true: HTTP snapshot is always available, and hiding the block when
 * capabilities fail made it impossible to add the first camera.
 */
export function shouldShowCameraSettings(
  _caps: CameraCapabilities | null,
  _hasSavedCameras: boolean,
): boolean {
  return true;
}
