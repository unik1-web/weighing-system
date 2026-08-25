import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchArchiveYear,
  fetchRotatePreview,
  fetchYears,
  rotateYear,
  updateArchiveTicket,
} from '../year-archive';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('year-archive API helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchYears maps payload and throws on API failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, years: [2025, 2026], active_year: 2026 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: false, message: 'нет доступа' }, 403),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchYears()).resolves.toEqual({
      years: [2025, 2026],
      active_year: 2026,
    });
    await expect(fetchYears()).rejects.toThrow('нет доступа');
  });

  it('fetchRotatePreview and rotateYear round-trip fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          active_year: 2026,
          open_count: 2,
          reo_pending_count: 1,
          suggested_new_year: 2027,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          ok: true,
          previous_year: 2026,
          active_year: 2027,
          backup_path: '/tmp/backup.db',
          auto_closed: [
            {
              id: 't1',
              ticket_number: 10,
              vehicle_number: 'А001АА56',
              tare_source: 'dictionary',
              tare_weight: 3000,
              attention: false,
            },
          ],
          reo_pending_count: 0,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRotatePreview()).resolves.toEqual({
      active_year: 2026,
      open_count: 2,
      reo_pending_count: 1,
      suggested_new_year: 2027,
    });

    await expect(
      rotateYear({
        target_year: 2027,
        operator_id: 'u1',
        operator_name: 'Админ',
        confirm_reo_pending: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      previous_year: 2026,
      active_year: 2027,
      backup_path: '/tmp/backup.db',
      reo_pending_count: 0,
      auto_closed: [expect.objectContaining({ id: 't1', tare_source: 'dictionary' })],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/database/rotate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          target_year: 2027,
          operator_id: 'u1',
          operator_name: 'Админ',
          confirm_reo_pending: true,
        }),
      }),
    );
  });

  it('fetchArchiveYear parses tickets and tolerates corrupt JSON', async () => {
    const tickets = [{ id: 'a1', vehicle_number: 'А001АА56', status: 'completed' }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          year: 2025,
          data: { app_weighing_tickets: JSON.stringify(tickets) },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          year: 2024,
          data: { app_weighing_tickets: '{not-json' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          year: 2023,
          data: { app_weighing_tickets: JSON.stringify({ not: 'array' }) },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchArchiveYear(2025)).resolves.toMatchObject({
      year: 2025,
      tickets,
    });
    await expect(fetchArchiveYear(2024)).resolves.toMatchObject({
      year: 2024,
      tickets: [],
    });
    await expect(fetchArchiveYear(2023)).resolves.toMatchObject({
      year: 2023,
      tickets: [],
    });
  });

  it('updateArchiveTicket posts confirm_reo_sent default false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        ticket: { id: 't1', version: 2 },
        revisions: [{ id: 'r1' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      updateArchiveTicket({
        year: 2025,
        ticket: { id: 't1', version: 1, cargo_name: 'Новый' },
        operator_id: null,
        operator_name: 'Админ',
      }),
    ).resolves.toEqual({
      ticket: { id: 't1', version: 2 },
      revisions: [{ id: 'r1' }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/database/archive/2025/ticket',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ticket: { id: 't1', version: 1, cargo_name: 'Новый' },
          operator_id: null,
          operator_name: 'Админ',
          confirm_reo_sent: false,
        }),
      }),
    );
  });
});
