import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  isStage6ErrorCode,
  patchArchiveTicket,
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

describe('archive ticket edit flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-E2E-01: admin patch success returns ticket and audit_event', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response({
        success: true,
        year: 2025,
        ticket: {
          id: 't-1',
          ticket_number: 10,
          driver_name: 'Петров',
          gross_weight: 21000,
          net_weight: 16000,
          reo_status: 'pending',
          status: 'completed',
        },
        audit_event: {
          event_type: 'archive_edit',
          source_year: 2025,
          changed_fields: ['driver_name', 'gross_weight', 'net_weight'],
          reo_divergence_warning: false,
        },
      }),
    );

    const result = await patchArchiveTicket('t-1', {
      year: 2025,
      patch: { driver_name: 'Петров', gross_weight: 21000 },
    });

    expect(result.ticket.driver_name).toBe('Петров');
    expect(result.audit_event.event_type).toBe('archive_edit');
    expect(result.audit_event.changed_fields).toContain('net_weight');
    expect(canEditArchiveTicket(true)).toBe(true);
  });

  it('TC-E2E-02: non-admin cannot edit archive ticket in UI gate', () => {
    expect(canEditArchiveTicket(false)).toBe(false);
  });

  it('TC-E2E-03: maps archive_reo_ack_required and success warning', async () => {
    expect(isStage6ErrorCode('archive_reo_ack_required')).toBe(true);
    expect(isStage6ErrorCode('archive_edit_validation_failed')).toBe(true);

    vi.spyOn(globalThis, 'fetch')
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
          ticket: { id: 't-sent', reo_status: 'sent', driver_name: 'Сидоров' },
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
      patchArchiveTicket('t-sent', {
        year: 2025,
        patch: { driver_name: 'Сидоров' },
        acknowledge_reo_sent_warning: false,
      }),
    ).rejects.toMatchObject<ApiRequestError>({
      name: 'ApiRequestError',
      code: 'archive_reo_ack_required',
      status: 409,
    });

    const accepted = await patchArchiveTicket('t-sent', {
      year: 2025,
      patch: { driver_name: 'Сидоров' },
      acknowledge_reo_sent_warning: true,
    });
    expect(accepted.ticket.reo_status).toBe('sent');
    expect(accepted.warning?.code).toBe('archive_reo_sent_warning');
    expect(accepted.audit_event.reo_divergence_warning).toBe(true);
  });

  it('TC-E2E-04: forbidden field error code is preserved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(
        {
          success: false,
          code: 'archive_edit_forbidden_field',
          message: 'Запрещено изменять поле ticket_number',
        },
        false,
        422,
      ),
    );

    await expect(
      patchArchiveTicket('t-1', {
        year: 2025,
        patch: { ticket_number: 99 },
      }),
    ).rejects.toMatchObject({
      code: 'archive_edit_forbidden_field',
      status: 422,
    });
  });

  it('TC-E2E-05: no-op validation failed is preserved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(
        {
          success: false,
          code: 'archive_edit_validation_failed',
          message: 'Сохранять нечего: после нормализации изменения отсутствуют',
        },
        false,
        422,
      ),
    );

    await expect(
      patchArchiveTicket('t-1', {
        year: 2025,
        patch: { driver_name: 'Иванов' },
      }),
    ).rejects.toMatchObject({
      code: 'archive_edit_validation_failed',
      status: 422,
    });
  });
});
