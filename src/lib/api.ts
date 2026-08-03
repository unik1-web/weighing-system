import { logger } from './logger';
import { normalizeImportDateTime as normalizeImportDateTimeValue, ticketImportKey } from './import-keys';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ApiErrorBody {
  message?: string;
  success?: boolean;
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
    throw new Error(data.message ?? `HTTP ${response.status}`);
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
  const shouldMaskPassword =
    (path.startsWith('/api/auth/') || path === '/api/cameras/discover') &&
    body &&
    typeof body === 'object';
  const logBody = shouldMaskPassword
    ? {
        ...(body as Record<string, unknown>),
        password: body && 'password' in (body as object) ? '***' : undefined,
        new_password: undefined,
        current_password: undefined,
      }
    : body;
  logger.debug('api', `POST ${path}`, logBody);
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
  try {
    await flushDatabaseSync();
  } catch {
    // Best-effort flush before shutdown.
  }

  try {
    await apiPost<{ success: true; message?: string }>('/api/shutdown', {});
  } catch (error: unknown) {
    // Process may die before the response body is fully read.
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (!/failed to fetch|networkerror|load failed|network request failed|fetch aborted/i.test(message)) {
      throw error;
    }
  }
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
