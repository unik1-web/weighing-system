import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { ArchiveTicketCard } from '@/components/ArchiveTicketCard';
import { canEditArchiveTicket } from '@/components/ArchiveView';
import {
  ApiRequestError,
  getArchiveTicket,
  getArchiveTickets,
  getArchiveYears,
  patchArchiveTicket,
} from '@/lib/api';

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

describe('archive list/card/edit access flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('показывает mixed legacy warning и edit только для admin', () => {
    const warning = {
      code: 'mixed_legacy_year_mismatch',
      archive_year: 2025,
      ticket_year: 2024,
      message: 'Календарный год даты тикета не совпадает с годом имени файла архива',
    };

    const adminHtml = renderToStaticMarkup(
      React.createElement(ArchiveTicketCard, {
        archiveYear: 2025,
        ticket: {
          id: 'arch-1',
          ticket_number: 77,
          status: 'completed',
          reo_status: 'pending',
          auto_closed: false,
          vehicle_number: 'A123AA56',
          created_at: '2024-12-31T12:00:00',
        },
        warning,
        canEdit: canEditArchiveTicket(true),
        onEdit: () => undefined,
      }),
    );
    expect(adminHtml).toContain(warning.message);
    expect(adminHtml).toContain('Редактировать');
    expect(adminHtml).toContain('Печать');

    const userHtml = renderToStaticMarkup(
      React.createElement(ArchiveTicketCard, {
        archiveYear: 2025,
        ticket: {
          id: 'arch-1',
          ticket_number: 77,
          status: 'completed',
          reo_status: 'pending',
          auto_closed: false,
        },
        warning,
        canEdit: canEditArchiveTicket(false),
      }),
    );
    expect(userHtml).toContain(warning.message);
    expect(userHtml).not.toContain('Редактировать');
  });

  it('happy-path years -> tickets -> ticket сохраняет archive year', async () => {
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
          tickets: [{ id: 'arch-1', ticket_number: 77, status: 'completed', reo_status: 'sent' }],
          warning: {
            code: 'mixed_legacy_year_mismatch',
            message: 'В архиве есть тикеты с календарным годом, отличным от имени файла',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2025,
          ticket: {
            id: 'arch-1',
            ticket_number: 77,
            status: 'completed',
            reo_status: 'sent',
            auto_closed: false,
          },
          warning: {
            code: 'mixed_legacy_year_mismatch',
            archive_year: 2025,
            ticket_year: 2024,
            message: 'Календарный год даты тикета не совпадает с годом имени файла архива',
          },
        }),
      );

    const years = await getArchiveYears();
    const tickets = await getArchiveTickets(2025);
    const ticket = await getArchiveTicket(2025, 'arch-1');

    expect(years.years[0].file_name).toBe('weighing-2025.db');
    expect(tickets.year).toBe(2025);
    expect(tickets.warning?.code).toBe('mixed_legacy_year_mismatch');
    expect(ticket.year).toBe(2025);
    expect(ticket.warning?.ticket_year).toBe(2024);
  });

  it('forbidden field и sent-REO ветки сохраняют коды контракта', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response(
          {
            success: false,
            code: 'archive_edit_forbidden_field',
            message: 'Запрещено изменять поле ticket_number',
          },
          false,
          422,
        ),
      )
      .mockResolvedValueOnce(
        response(
          {
            success: false,
            code: 'archive_reo_ack_required',
            message: 'Нужно подтвердить предупреждение для тикета, уже отправленного в РЭО',
          },
          false,
          409,
        ),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          year: 2025,
          ticket: { id: 'arch-sent', reo_status: 'sent', driver_name: 'Сидоров' },
          audit_event: {
            event_type: 'archive_edit',
            source_year: 2025,
            changed_fields: ['driver_name'],
            reo_divergence_warning: true,
          },
          warning: {
            code: 'archive_reo_sent_warning',
            message: 'Архивный тикет уже отправлялся в РЭО; статус сохранён как sent',
          },
        }),
      );

    await expect(
      patchArchiveTicket('arch-1', { year: 2025, patch: { ticket_number: 99 } }),
    ).rejects.toMatchObject<ApiRequestError>({
      code: 'archive_edit_forbidden_field',
      status: 422,
    });

    await expect(
      patchArchiveTicket('arch-sent', {
        year: 2025,
        patch: { driver_name: 'Сидоров' },
        acknowledge_reo_sent_warning: false,
      }),
    ).rejects.toMatchObject({ code: 'archive_reo_ack_required', status: 409 });

    const accepted = await patchArchiveTicket('arch-sent', {
      year: 2025,
      patch: { driver_name: 'Сидоров' },
      acknowledge_reo_sent_warning: true,
    });
    expect(accepted.warning?.code).toBe('archive_reo_sent_warning');
    expect(accepted.ticket.reo_status).toBe('sent');
    expect(accepted.audit_event.reo_divergence_warning).toBe(true);
  });
});
