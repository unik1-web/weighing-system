import { logger } from './logger';

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

export interface VescomWeighingItem {
  datetimebrutto: string;
  datetimetara: string;
  vehicle_number: string;
  vehicle_brand: string;
  receiver_name: string;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
  cargo_name: string;
}

export function normalizeImportDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function vescomImportKey(item: VescomWeighingItem): string {
  return `${normalizeImportDateTime(item.datetimebrutto)}_${normalizeImportDateTime(item.datetimetara)}_${item.vehicle_number.trim()}`;
}

export function ticketImportKey(ticket: {
  gross_datetime: string | null;
  tare_datetime: string | null;
  vehicle_number: string;
}): string {
  return `${normalizeImportDateTime(ticket.gross_datetime)}_${normalizeImportDateTime(ticket.tare_datetime)}_${ticket.vehicle_number.trim()}`;
}
