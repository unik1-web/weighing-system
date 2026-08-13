import { apiGet, apiPost } from '../api';
import type { ScaleAdapterId, ScaleConnectionProfile, ScaleReading, ScaleTransportKind } from './types';

export interface ScaleContextResponse {
  success: boolean;
  site_id: string;
  scale_id: string;
  scale_role: string;
  adapter_id: ScaleAdapterId;
  connection: ScaleConnectionProfile;
  transport: ScaleTransportKind;
}

export interface ScaleStatusResponse {
  success: boolean;
  connected: boolean;
  adapter_id: ScaleAdapterId | null;
  scale_id: string | null;
  transport: ScaleTransportKind | null;
  last_reading: ScaleReading | null;
  error: string | null;
}

export interface ScaleReadingResponse {
  success: boolean;
  reading: ScaleReading | null;
  connected: boolean;
}

export async function fetchScaleContext(): Promise<ScaleContextResponse> {
  return apiGet<ScaleContextResponse>('/api/scales/context');
}

export async function fetchScaleStatus(): Promise<ScaleStatusResponse> {
  return apiGet<ScaleStatusResponse>('/api/scales/status');
}

export async function connectBackendScale(overrides?: {
  host?: string;
  tcpPort?: number;
  serialPath?: string;
}): Promise<{ success: boolean; connected: boolean; adapter_id: ScaleAdapterId; transport: ScaleTransportKind }> {
  return apiPost('/api/scales/connect', overrides ?? {});
}

export async function disconnectBackendScale(): Promise<{ success: boolean; connected: boolean }> {
  return apiPost('/api/scales/disconnect', {});
}

export async function fetchScaleReading(): Promise<ScaleReadingResponse> {
  return apiGet<ScaleReadingResponse>('/api/scales/reading');
}
