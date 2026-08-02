/**
 * Camera registry and photo capture client (этап 7).
 */
import { apiGet, apiPost } from './api';
import {
  CamerasStorage,
  TicketPhotosStorage,
  TicketStorage,
  type Camera,
  type CameraRole,
  type CaptureKind,
  type PhotoPhase,
  type TicketPhoto,
} from './storage';
import { logger } from './logger';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const MAX_CAMERAS_PER_SITE = 4;

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

/** Fire-and-forget capture after successful ticket save; never throws. */
export async function triggerCaptureAfterSave(
  ticketId: string,
  phases: PhotoPhase[],
  siteId?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  let anyOk = false;
  let anyFail = false;
  for (const phase of phases) {
    const result = await captureForTicket(ticketId, phase, siteId);
    if (result == null) {
      anyFail = true;
    } else {
      anyOk = true;
      const failed = result.photos.some((p) => p.status === 'failed');
      if (failed) anyFail = true;
    }
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

export async function takeSnapshot(cameraId: string): Promise<string | null> {
  try {
    const result = await apiPost<{ success: boolean; relative_path?: string }>(
      '/api/cameras/snapshot',
      { camera_id: cameraId },
    );
    return result.relative_path ?? null;
  } catch (err) {
    logger.warn('cameras', 'snapshot failed', err);
    throw err;
  }
}

/** Whether settings UI for cameras should be interactive. */
export function shouldShowCameraSettings(
  caps: CameraCapabilities | null,
  hasSavedCameras: boolean,
): boolean {
  if (hasSavedCameras) return true;
  return Boolean(caps?.capture_available);
}
