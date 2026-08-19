/**
 * Client helpers for local ANPR (этап 8).
 */
import { apiGet, apiPost } from './api';
import { logger } from './logger';
import type { AnprMode, AnprStatus } from './storage';
import type { PlateSource } from './vehicle-resolve';

export type { AnprStatus };

export interface AnprCapabilities {
  success: boolean;
  anpr_available: boolean;
  anpr_enabled: boolean;
  video_enabled: boolean;
  engine: string;
  model_loaded: boolean;
  backends?: string[];
  model_path?: string;
}

export interface AnprRecognizeResult {
  success: boolean;
  engine_invoked: boolean;
  anpr_status: AnprStatus;
  plate_raw: string | null;
  confidence: number | null;
  camera_id: string | null;
  error: string | null;
  reason: string | null;
}

export type AnprDecision = 'accept' | 'edit' | 'reject';

let capsCache: AnprCapabilities | null = null;
let capsFetchedAt = 0;
const CAPS_TTL_MS = 30_000;

const DISABLED_FALLBACK: AnprCapabilities = {
  success: false,
  anpr_available: false,
  anpr_enabled: false,
  video_enabled: false,
  engine: 'unavailable',
  model_loaded: false,
  backends: [],
};

export async function fetchAnprCapabilities(force = false): Promise<AnprCapabilities> {
  const now = Date.now();
  if (!force && capsCache && now - capsFetchedAt < CAPS_TTL_MS) {
    return capsCache;
  }
  try {
    const data = await apiGet<AnprCapabilities>('/api/anpr/capabilities');
    capsCache = data;
    capsFetchedAt = now;
    return data;
  } catch (err) {
    logger.warn('anpr', 'capabilities unavailable', err);
    return { ...DISABLED_FALLBACK };
  }
}

export async function recognizePlate(args?: {
  site_id?: string;
  camera_id?: string;
}): Promise<AnprRecognizeResult> {
  try {
    return await apiPost<AnprRecognizeResult>('/api/anpr/recognize', {
      site_id: args?.site_id,
      camera_id: args?.camera_id,
    });
  } catch (err) {
    logger.warn('anpr', 'recognize failed', err);
    return {
      success: true,
      engine_invoked: true,
      anpr_status: 'failed',
      plate_raw: null,
      confidence: null,
      camera_id: args?.camera_id ?? null,
      error: err instanceof Error ? err.message : 'Ошибка распознавания',
      reason: null,
    };
  }
}

/** Client-side gate for showing the recognize button (server re-checks). */
export function canOfferAnpr(ctx: {
  anpr_enabled: boolean;
  video_enabled: boolean;
  anpr_mode: AnprMode | string | null | undefined;
  hasOverview: boolean;
}): boolean {
  return (
    !!ctx.anpr_enabled &&
    !!ctx.video_enabled &&
    ctx.anpr_mode === 'enabled' &&
    !!ctx.hasOverview
  );
}

/**
 * Map operator decision + resolveVehicle plate_source to ticket plate_source.
 * accept → anpr; edit → operator; reject → directory|operator from resolve.
 */
export function finalizePlateSource(
  decision: AnprDecision,
  resolveSource: PlateSource,
): PlateSource {
  if (decision === 'accept') return 'anpr';
  if (decision === 'edit') return 'operator';
  return resolveSource;
}

/** Display confidence as «Уверенность: N%» (input 0..1). */
export function confidenceToPercent(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return 'Уверенность: —';
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  return `Уверенность: ${pct}%`;
}
