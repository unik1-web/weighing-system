import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  commitYearRotation,
  getArchiveTicket,
  getArchiveTickets,
  getArchiveYears,
  patchArchiveTicket,
} from '../api';

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

describe('stage-6 api wrappers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-UNIT-01: parses archive and rotation success contracts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
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
          tickets: [{ id: 't-1', ticket_number: 101 }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2025,
          ticket: { id: 't-1', ticket_number: 101, status: 'completed', reo_status: 'pending' },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2025,
          ticket: { id: 't-1', ticket_number: 101 },
          audit_event: { event_type: 'archive_edit', source_year: 2025, changed_fields: ['driver_name'] },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          source_year: 2025,
          target_year: 2026,
          auto_closed_count: 1,
          backup_path: 'stub://backup',
          new_db_path: 'stub://new-db',
        }),
      );

    const years = await getArchiveYears();
    const tickets = await getArchiveTickets(2025, { q: '101' });
    const ticket = await getArchiveTicket(2025, 't-1');
    const patch = await patchArchiveTicket('t-1', {
      year: 2025,
      patch: { driver_name: 'Иванов И.И.' },
      acknowledge_reo_sent_warning: true,
    });
    const commit = await commitYearRotation({
      source_year: 2025,
      target_year: 2026,
      preview_token: 'stub-token',
      acknowledge_pending_reo: true,
    });

    expect(years.years[0].year).toBe(2025);
    expect(tickets.year).toBe(2025);
    expect(ticket.ticket.id).toBe('t-1');
    expect(patch.audit_event.event_type).toBe('archive_edit');
    expect(commit.auto_closed_count).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/archive/tickets?year=2025&q=101');
    expect(fetchMock.mock.calls[2][0]).toContain('/api/archive/tickets/t-1?year=2025');
  });

  it('TC-UNIT-01: throws ApiRequestError with stage-6 code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(
        {
          success: false,
          code: 'archive_year_not_found',
          message: 'Архивный файл за указанный год не найден',
        },
        false,
        404,
      ),
    );

    await expect(getArchiveTickets(2030)).rejects.toMatchObject<ApiRequestError>({
      name: 'ApiRequestError',
      code: 'archive_year_not_found',
      status: 404,
    });
  });
});

