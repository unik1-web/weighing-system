import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getArchiveTicket,
  getArchiveTickets,
  getArchiveYears,
} from '../api';
import { archiveTicketToWeighingTicket } from '@/components/ArchiveTicketCard';
import { printTicket } from '@/components/PrintAct';
import * as storageModule from '../storage';

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

describe('archive journal and reprint flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-E2E: archive years -> tickets -> ticket with mixed legacy warning', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response({
          success: true,
          years: [{ year: 2026, file_name: 'weighing-2026.db', label: 'Архив 2026' }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2026,
          tickets: [{ id: 'mixed-1', ticket_number: 7, status: 'completed' }],
          warning: {
            code: 'mixed_legacy_year_mismatch',
            message: 'В архиве есть тикеты с календарным годом, отличным от имени файла',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2026,
          ticket: {
            id: 'mixed-1',
            ticket_number: 7,
            status: 'completed',
            auto_closed: false,
            created_at: '2025-12-31T12:00:00',
          },
          warning: {
            code: 'mixed_legacy_year_mismatch',
            archive_year: 2026,
            ticket_year: 2025,
            message: 'Календарный год даты тикета не совпадает с годом имени файла архива',
          },
        }),
      );

    const years = await getArchiveYears();
    const tickets = await getArchiveTickets(2026);
    const ticket = await getArchiveTicket(2026, 'mixed-1');

    expect(years.years[0].year).toBe(2026);
    expect(tickets.year).toBe(2026);
    expect(tickets.warning?.code).toBe('mixed_legacy_year_mismatch');
    expect(ticket.year).toBe(2026);
    expect(ticket.warning?.ticket_year).toBe(2025);
  });

  it('TC-E2E: archive printTicket does not write into TicketStorage', () => {
    const updateSpy = vi.spyOn(storageModule.TicketStorage, 'update');
    const openMock = vi.fn().mockReturnValue({
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
    });
    vi.stubGlobal('window', {
      open: openMock,
      alert: vi.fn(),
    });

    const printable = archiveTicketToWeighingTicket(
      {
        id: 'print-1',
        ticket_number: 15,
        status: 'completed',
        reo_status: 'pending',
        auto_closed: false,
        vehicle_number: 'A123AA56',
        created_at: '2025-04-01T09:00:00',
        completed_at: '2025-04-01T09:10:00',
      },
      2025,
    );

    printTicket(printable, undefined, { source: 'archive' });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalled();
    expect(printable.year).toBe(2025);
  });
});
