import { logger } from './logger';
import { normalizeImportDateTime as normalizeImportDateTimeValue, ticketImportKey } from './import-keys';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ApiErrorBody {
  message?: string;
  success?: boolean;
  code?: string;
}

export class ApiRequestError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    if (response.status === 0 || response.status === 502 || response.status === 504) {
      throw new Error('Backend не отвечает. Запустите в отдельном терминале: npm run dev:api');
    }
    throw new Error(`Пустой ответ сервера (HTTP ${response.status}). Запустите backend: npm run dev:api`);
  }

  let data: T & ApiErrorBody;
  try {
    data = JSON.parse(text) as T & ApiErrorBody;
  } catch {
    throw new Error(`Некорректный ответ сервера (HTTP ${response.status})`);
  }

  if (!response.ok || data.success === false) {
    if (data.code && data.message) {
      throw new ApiRequestError(`${data.code}: ${data.message}`, response.status, data.code);
    }
    throw new ApiRequestError(data.message ?? `HTTP ${response.status}`, response.status, data.code);
  }
  return data;
}

export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  logger.debug('api', `GET ${path}`, params);
  try {
    const response = await fetch(`${API_BASE}${path}${query}`);
    const data = await parseResponse<T>(response);
    logger.info('api', `GET ${path} OK`);
    return data;
  } catch (error) {
    logger.error('api', `GET ${path} failed`, error);
    throw error;
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  logger.debug('api', `POST ${path}`, body);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await parseResponse<T>(response);
    logger.info('api', `POST ${path} OK`);
    return data;
  } catch (error) {
    logger.error('api', `POST ${path} failed`, error);
    throw error;
  }
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  logger.debug('api', `PATCH ${path}`, body);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await parseResponse<T>(response);
    logger.info('api', `PATCH ${path} OK`);
    return data;
  } catch (error) {
    logger.error('api', `PATCH ${path} failed`, error);
    throw error;
  }
}

export interface VescomWeighingItem {
  vescom_id?: number | null;
  datetimebrutto: string;
  datetimetara: string;
  vehicle_number: string;
  vehicle_brand: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
  receiver_name: string;
  carrier_name: string;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
}

export interface MetraWeighingItem {
  rec_no: number;
  datetimebrutto: string;
  datetimetara: string;
  vehicle_number: string;
  vehicle_brand: string;
  trailer_number: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
  receiver_name: string;
  carrier_name: string;
  price: number;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
  operator_name: string;
  invoice: string;
}

export interface WaWeighingItem {
  wa_id?: string | number | null;
  datetimebrutto: string;
  datetimetara: string;
  vehicle_number: string;
  vehicle_brand: string;
  trailer_number: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
  receiver_name: string;
  carrier_name: string;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
  operator_name: string;
}

export async function exitApplication(): Promise<void> {
  const { flushDatabaseSync, flushStorageSync } = await import('./storage-sync');
  flushStorageSync();
  await flushDatabaseSync();
  await apiPost<{ success: true; message?: string }>('/api/shutdown', {});
}

export function normalizeImportDateTime(value: string | null | undefined): string {
  return normalizeImportDateTimeValue(value);
}

export function vescomImportKey(item: VescomWeighingItem): string {
  const idPart = item.vescom_id != null ? String(item.vescom_id) : '0';
  return `${idPart}|${item.datetimebrutto}|${item.datetimetara}|${item.vehicle_number.trim()}`;
}

export function metraImportKey(item: MetraWeighingItem): string {
  return `${item.rec_no}|${item.datetimebrutto}|${item.datetimetara}|${item.vehicle_number.trim()}`;
}

export function waImportKey(item: WaWeighingItem): string {
  const idPart = item.wa_id != null ? String(item.wa_id) : '0';
  return `${idPart}|${item.datetimebrutto}|${item.datetimetara}|${item.vehicle_number.trim()}`;
}

export { ticketImportKey };

export interface ScaleApiError {
  success: false;
  code: string;
  message: string;
}

export interface ScaleApiScaleContext {
  site_id: string;
  scale_id: string;
  scale_role: 'primary' | 'spare';
  adapter_id: string;
  transport: string;
}

export interface ScaleApiReading {
  value: number;
  stable: boolean;
  raw: string | null;
  captured_at: string;
}

export interface ScaleConnectResponse {
  success: true;
  session_id: string;
  status: 'connected' | 'reading';
  scale: ScaleApiScaleContext;
  reading: ScaleApiReading | null;
}

export interface ScaleStatusResponse {
  success: true;
  session_id: string;
  status: 'connected' | 'reading' | 'disconnected' | 'error';
  scale: ScaleApiScaleContext;
  reading: ScaleApiReading | null;
}

export interface ScaleReadResponse {
  success: true;
  session_id: string;
  status: 'reading';
  reading: ScaleApiReading;
}

export interface ScaleDisconnectResponse {
  success: true;
  session_id: string;
  status: 'disconnected';
}

export interface Stage6Warning {
  code: 'archive_reo_sent_warning';
  message: string;
  [key: string]: unknown;
}

export interface ArchiveWarning {
  code: string;
  message: string;
  archive_year?: number;
  ticket_year?: number;
  ticket_years?: number[];
  [key: string]: unknown;
}

export interface ArchiveYearInfo {
  year: number;
  file_name: string;
  label: string;
}

/** @deprecated Prefer ArchiveYearInfo */
export type ArchiveYearItem = ArchiveYearInfo;

export interface ArchiveYearsResponse {
  success: true;
  years: ArchiveYearInfo[];
}

export interface ArchiveTicketSummary {
  id: string;
  ticket_number?: number | null;
  status?: string;
  reo_status?: string;
  auto_closed?: boolean;
  vehicle_number?: string | null;
  driver_name?: string | null;
  cargo_name?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  [key: string]: unknown;
}

export interface ArchiveTicketDetails extends ArchiveTicketSummary {
  vehicle_brand?: string | null;
  trailer_number?: string | null;
  shipper_name?: string | null;
  receiver_name?: string | null;
  carrier_name?: string | null;
  gross_weight?: number | null;
  tare_weight?: number | null;
  net_weight?: number | null;
  gross_datetime?: string | null;
  tare_datetime?: string | null;
  notes?: string | null;
  photo_entry_path?: string | null;
  photo_exit_path?: string | null;
}

export interface ArchiveTicketsResponse {
  success: true;
  year: number;
  tickets: ArchiveTicketSummary[];
  warning?: ArchiveWarning;
}

export interface ArchiveTicketResponse {
  success: true;
  year: number;
  ticket: ArchiveTicketDetails;
  warning?: ArchiveWarning;
}

export interface ArchiveTicketPatchRequest {
  year: number;
  patch: Record<string, unknown>;
  acknowledge_reo_sent_warning?: boolean;
}

export interface ArchiveTicketPatchResponse {
  success: true;
  year: number;
  ticket: ArchiveTicketDetails;
  audit_event: {
    event_type: 'archive_edit';
    source_year: number;
    changed_fields: string[];
    reo_divergence_warning?: boolean;
  };
  warning?: Stage6Warning;
}

export interface RotationPreviewCandidate {
  ticket_id: string;
  ticket_number?: number | null;
  tare_weight?: number | null;
  tare_source?: string;
  [key: string]: unknown;
}

export interface RotationPreviewResponse {
  success: true;
  source_year: number | null;
  target_year: number | null;
  preview_token: string;
  source_db_fingerprint?: string;
  open_candidates: RotationPreviewCandidate[];
  pending_reo_count: number;
  blocking_tickets: Array<Record<string, unknown>>;
  rotation_required?: boolean;
}

export interface RotationCommitRequest {
  source_year: number | null;
  target_year: number | null;
  preview_token?: string;
  acknowledge_pending_reo?: boolean;
}

export interface RotationCommitResponse {
  success: true;
  source_year: number | null;
  target_year: number | null;
  auto_closed_count: number;
  backup_path: string;
  new_db_path: string;
  recovery?: Record<string, unknown>;
  warning?: {
    code: string;
    message: string;
  };
}

export type Stage6ErrorCode =
  | 'rotation_in_progress'
  | 'rotation_preview_stale'
  | 'invalid_rotation_years'
  | 'rotation_failed'
  | 'invalid_archive_year'
  | 'archive_year_not_found'
  | 'archive_open_failed'
  | 'archive_ticket_not_found'
  | 'archive_edit_forbidden_field'
  | 'archive_edit_validation_failed'
  | 'archive_reo_ack_required';

export function isStage6ErrorCode(code: string | undefined): code is Stage6ErrorCode {
  return (
    code === 'rotation_in_progress'
    || code === 'rotation_preview_stale'
    || code === 'invalid_rotation_years'
    || code === 'rotation_failed'
    || code === 'invalid_archive_year'
    || code === 'archive_year_not_found'
    || code === 'archive_open_failed'
    || code === 'archive_ticket_not_found'
    || code === 'archive_edit_forbidden_field'
    || code === 'archive_edit_validation_failed'
    || code === 'archive_reo_ack_required'
  );
}

export async function scaleConnect(request: {
  expected_site_id: string;
  expected_scale_id: string;
  expected_scale_role: 'primary' | 'spare';
}): Promise<ScaleConnectResponse> {
  return apiPost<ScaleConnectResponse>('/api/scales/connect', request);
}

export async function scaleStatus(sessionId: string): Promise<ScaleStatusResponse> {
  return apiGet<ScaleStatusResponse>('/api/scales/status', { session_id: sessionId });
}

export async function scaleRead(request: {
  session_id: string;
  timeout_ms: number;
}): Promise<ScaleReadResponse> {
  return apiPost<ScaleReadResponse>('/api/scales/read', request);
}

export async function scaleDisconnect(sessionId: string): Promise<ScaleDisconnectResponse> {
  return apiPost<ScaleDisconnectResponse>('/api/scales/disconnect', {
    session_id: sessionId,
  });
}

export async function getArchiveYears(): Promise<ArchiveYearsResponse> {
  return apiGet<ArchiveYearsResponse>('/api/archive/years');
}

export async function getArchiveTickets(
  year: number,
  filters?: Record<string, string>,
): Promise<ArchiveTicketsResponse> {
  const params = { year: String(year), ...(filters ?? {}) };
  return apiGet<ArchiveTicketsResponse>('/api/archive/tickets', params);
}

export async function getArchiveTicket(
  year: number,
  ticketId: string,
): Promise<ArchiveTicketResponse> {
  return apiGet<ArchiveTicketResponse>(`/api/archive/tickets/${encodeURIComponent(ticketId)}`, {
    year: String(year),
  });
}

export async function patchArchiveTicket(
  ticketId: string,
  body: ArchiveTicketPatchRequest,
): Promise<ArchiveTicketPatchResponse> {
  return apiPatch<ArchiveTicketPatchResponse>(
    `/api/archive/tickets/${encodeURIComponent(ticketId)}`,
    body,
  );
}

export async function getYearRotationPreview(assertion?: {
  source_year?: number;
  target_year?: number;
}): Promise<RotationPreviewResponse> {
  return apiPost<RotationPreviewResponse>('/api/year/rotation/preview', assertion ?? {});
}

export async function commitYearRotation(
  body: RotationCommitRequest,
): Promise<RotationCommitResponse> {
  return apiPost<RotationCommitResponse>('/api/year/rotation/commit', body);
}

// --- Stage 7 camera / photo API stubs ---

export type CaptureEvent = 'gross' | 'tare';

export interface CameraCapabilityResponse {
  success: true;
  available: boolean;
  build: 'basic' | 'full' | string;
  opencv: boolean;
  code?: string;
}

export interface CameraSnapshotResponse {
  success: true;
  preview_jpeg_base64: string;
  content_type?: string;
}

export interface CameraEtalonResponse {
  success: true;
  path: string;
  preview_jpeg_base64: string;
  camera: Record<string, unknown>;
}

export interface CameraCaptureResultItem {
  camera_id: string;
  camera_role: string;
  status: 'success' | 'failed' | string;
  file_path: string | null;
  error_code: string | null;
}

export interface CameraCaptureResponse {
  success: true;
  noop: boolean;
  results: CameraCaptureResultItem[];
  ticket_photos: Array<Record<string, unknown>>;
  photo_entry_path: string | null;
  photo_exit_path: string | null;
  capture_token: string;
}

/** GET /api/cameras/capability — availability of OpenCV camera module. */
export async function fetchCameraCapability(): Promise<CameraCapabilityResponse> {
  return apiGet<CameraCapabilityResponse>('/api/cameras/capability');
}

/** POST /api/cameras/snapshot — live/preview frame (operator). */
export async function postCameraSnapshot(body: {
  camera_id?: string;
  http_snapshot_url?: string | null;
  rtsp_url?: string | null;
  timeout_sec?: number;
}): Promise<CameraSnapshotResponse> {
  return apiPost<CameraSnapshotResponse>('/api/cameras/snapshot', body);
}

/** POST /api/cameras/test — admin-only alias of snapshot. */
export async function postCameraTest(body: {
  camera_id?: string;
  http_snapshot_url?: string | null;
  rtsp_url?: string | null;
  timeout_sec?: number;
}): Promise<CameraSnapshotResponse> {
  return apiPost<CameraSnapshotResponse>('/api/cameras/test', body);
}

/** POST /api/cameras/etalon — capture etalon primary/spare (admin). */
export async function postCameraEtalon(body: {
  camera_id: string;
  scale_set: 'primary' | 'spare';
}): Promise<CameraEtalonResponse> {
  return apiPost<CameraEtalonResponse>('/api/cameras/etalon', body);
}

/** POST /api/cameras/capture — ticket-phase capture after flush. */
export async function postCameraCapture(body: {
  ticket_id: string;
  event: CaptureEvent;
}): Promise<CameraCaptureResponse> {
  return apiPost<CameraCaptureResponse>('/api/cameras/capture', body);
}
