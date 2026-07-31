import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getArchiveTicket,
  getArchiveTickets,
  getArchiveYears,
  getYearRotationPreview,
} from '../api';
import { canEditArchiveTicket } from '@/components/ArchiveView';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

installLocalStorage();

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('stage-6 stub ui/api flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-E2E-01: preview ротации возвращает план-заглушку', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response({
        success: true,
        source_year: 2025,
        target_year: 2026,
        preview_token: 'stage6-preview-token',
        open_candidates: [{ ticket_id: 't-1', ticket_number: 1001 }],
        pending_reo_count: 1,
        blocking_tickets: [],
      }),
    );

    const preview = await getYearRotationPreview();
    expect(preview.source_year).toBe(2025);
    expect(preview.target_year).toBe(2026);
    expect(preview.open_candidates[0].ticket_id).toBe('t-1');
    expect(preview.pending_reo_count).toBe(1);
  });

  it('TC-E2E-02: архивный сценарий год -> список -> карточка', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response({
          success: true,
          years: [{ year: 2025, file_name: 'weighing-2025.db', label: 'Архив 2025' }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2025,
          tickets: [{ id: 'archive-1', ticket_number: 77, status: 'completed' }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2025,
          ticket: { id: 'archive-1', ticket_number: 77, status: 'completed', auto_closed: false },
        }),
      );

    const years = await getArchiveYears();
    const tickets = await getArchiveTickets(2025);
    const ticket = await getArchiveTicket(2025, 'archive-1');

    expect(years.years).toHaveLength(1);
    expect(tickets.tickets).toHaveLength(1);
    expect(ticket.ticket.ticket_number).toBe(77);
  });

  it('TC-E2E-03: edit control доступен только admin', () => {
    expect(canEditArchiveTicket(true)).toBe(true);
    expect(canEditArchiveTicket(false)).toBe(false);
  });
});

