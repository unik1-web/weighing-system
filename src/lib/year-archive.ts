import type { TicketRevision, WeighingTicket } from './storage';
import { flushDatabaseSync, loadStorageFromServer } from './storage-sync';
import { logger } from './logger';

export interface YearsResponse {
  years: number[];
  active_year: number;
}

export interface RotatePreview {
  active_year: number;
  open_count: number;
  reo_pending_count: number;
  suggested_new_year: number;
}

export interface AutoClosedItem {
  id: string;
  ticket_number: number | null;
  vehicle_number: string;
  tare_source: 'dictionary' | 'default' | 'none' | string;
  tare_weight: number | null;
  attention: boolean;
}

export interface RotateResult {
  ok: boolean;
  previous_year: number;
  active_year: number;
  backup_path: string;
  auto_closed: AutoClosedItem[];
  reo_pending_count: number;
}

export interface ArchiveTicketUpdateResult {
  ticket: WeighingTicket;
  revisions: TicketRevision[];
}

async function parseJson<T>(response: Response): Promise<T & { success?: boolean; message?: string; error?: string }> {
  const body = (await response.json()) as T & {
    success?: boolean;
    message?: string;
    error?: string;
  };
  if (!response.ok || body.success === false) {
    const err = new Error(body.message ?? `HTTP ${response.status}`) as Error & {
      status?: number;
      error?: string;
      body?: unknown;
    };
    err.status = response.status;
    err.error = body.error;
    err.body = body;
    throw err;
  }
  return body;
}

export async function fetchYears(): Promise<YearsResponse> {
  const response = await fetch('/api/database/years');
  const body = await parseJson<YearsResponse>(response);
  return { years: body.years ?? [], active_year: body.active_year };
}

export async function fetchRotatePreview(): Promise<RotatePreview> {
  const response = await fetch('/api/database/rotate/preview');
  const body = await parseJson<RotatePreview>(response);
  return {
    active_year: body.active_year,
    open_count: body.open_count,
    reo_pending_count: body.reo_pending_count,
    suggested_new_year: body.suggested_new_year,
  };
}

export async function rotateYear(args: {
  target_year: number;
  operator_id: string | null;
  operator_name: string;
  confirm_reo_pending?: boolean;
}): Promise<RotateResult> {
  const response = await fetch('/api/database/rotate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await parseJson<RotateResult>(response);
  return {
    ok: body.ok,
    previous_year: body.previous_year,
    active_year: body.active_year,
    backup_path: body.backup_path,
    auto_closed: body.auto_closed ?? [],
    reo_pending_count: body.reo_pending_count,
  };
}

export async function fetchArchiveYear(year: number): Promise<{
  year: number;
  tickets: WeighingTicket[];
  data: Record<string, string>;
}> {
  const response = await fetch(`/api/database/archive/${year}`);
  const body = await parseJson<{ year: number; data: Record<string, string> }>(response);
  const raw = body.data?.['app_weighing_tickets'];
  let tickets: WeighingTicket[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WeighingTicket[];
      if (Array.isArray(parsed)) tickets = parsed;
    } catch {
      tickets = [];
    }
  }
  return { year: body.year, tickets, data: body.data ?? {} };
}

export async function updateArchiveTicket(args: {
  year: number;
  ticket: Partial<WeighingTicket> & { id: string; version: number };
  operator_id: string | null;
  operator_name: string;
  confirm_reo_sent?: boolean;
}): Promise<ArchiveTicketUpdateResult> {
  const response = await fetch(`/api/database/archive/${args.year}/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticket: args.ticket,
      operator_id: args.operator_id,
      operator_name: args.operator_name,
      confirm_reo_sent: args.confirm_reo_sent ?? false,
    }),
  });
  const body = await parseJson<ArchiveTicketUpdateResult>(response);
  return { ticket: body.ticket, revisions: body.revisions ?? [] };
}

/** Flush active DB, clear ticket caches, reload from server after rotation. */
export async function reloadStorageAfterRotate(): Promise<void> {
  await flushDatabaseSync();
  localStorage.removeItem('app_weighing_tickets');
  localStorage.removeItem('app_ticket_audit');
  localStorage.removeItem('app_ticket_revisions');
  await loadStorageFromServer();
  logger.info('storage', 'Хранилище перезагружено после ротации года');
}
