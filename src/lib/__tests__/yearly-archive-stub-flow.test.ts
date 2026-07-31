import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  getArchiveTicket,
  getArchiveTickets,
  getArchiveYears,
  getYearRotationPreview,
} from '../api';
import { canEditArchiveTicket } from '@/components/ArchiveView';
import { YearRotationDialog } from '@/components/YearRotationDialog';

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

describe('stage-6 yearly archive production flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('блокирует commit при blocking_tickets и требует ack для pending_reo_count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response({
        success: true,
        source_year: 2025,
        target_year: 2026,
        preview_token: 'rotprev_2025_2026_deadbeef',
        open_candidates: [],
        pending_reo_count: 3,
        blocking_tickets: [
          {
            ticket_id: 't-block',
            ticket_number: 42,
            vehicle_number: 'X001XX56',
            reason: 'missing_tare_dictionary_and_default',
          },
        ],
        rotation_required: true,
      }),
    );

    const preview = await getYearRotationPreview();
    expect(preview.blocking_tickets).toHaveLength(1);
    expect(preview.pending_reo_count).toBe(3);
    expect(String(preview.preview_token)).toMatch(/^rotprev_/);

    const html = renderToStaticMarkup(
      React.createElement(YearRotationDialog, {
        open: true,
        preview,
        committing: false,
        error: null,
        blockingTickets: preview.blocking_tickets,
        pendingReoCount: preview.pending_reo_count,
        onConfirm: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain('Ротация заблокирована');
    expect(html).toContain('pending-тикетов РЭО (3)');
    expect(html).toContain('disabled');
  });

  it('happy-path archive years -> tickets -> ticket', async () => {
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

  it('archive edit control доступен только admin', () => {
    expect(canEditArchiveTicket(true)).toBe(true);
    expect(canEditArchiveTicket(false)).toBe(false);
  });
});

describe('stage-6 rotation logout after commit', () => {
  let stateValue: unknown;
  const stateTransitions: unknown[] = [];
  const setState = vi.fn((update: unknown) => {
    if (typeof update === 'function') {
      stateValue = (update as (prev: unknown) => unknown)(stateValue);
    } else {
      stateValue = update;
    }
    stateTransitions.push(stateValue);
  });
  const previewMock = vi.fn();
  const commitMock = vi.fn();

  beforeEach(() => {
    stateValue = undefined;
    stateTransitions.length = 0;
    setState.mockClear();
    previewMock.mockReset();
    commitMock.mockReset();
    vi.resetModules();

    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useState: ((initial: unknown) => {
          stateValue = initial;
          return [stateValue, setState];
        }) as typeof actual.useState,
        useRef: ((initial: unknown) => ({ current: initial })) as typeof actual.useRef,
        useMemo: <T,>(factory: () => T) => factory(),
        useCallback: <T extends (...args: any[]) => any>(callback: T) => callback,
      };
    });
    vi.doMock('@/lib/api', () => {
      class ApiRequestError extends Error {
        code?: string;
        status: number;
        constructor(message: string, status: number, code?: string) {
          super(message);
          this.code = code;
          this.status = status;
        }
      }
      return {
        ApiRequestError,
        getYearRotationPreview: previewMock,
        commitYearRotation: commitMock,
      };
    });
    vi.doMock('@/lib/storage-sync', () => ({
      beginRotationCommitSyncPause: vi.fn(),
      endRotationCommitSyncPause: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('успешная ротация приводит к logout callback', async () => {
    const logout = vi.fn(async () => undefined);
    previewMock.mockResolvedValue({
      success: true,
      source_year: 2025,
      target_year: 2026,
      preview_token: 'rotprev_2025_2026_ok',
      open_candidates: [],
      pending_reo_count: 1,
      blocking_tickets: [],
      rotation_required: true,
    });
    commitMock.mockResolvedValue({
      success: true,
      source_year: 2025,
      target_year: 2026,
      auto_closed_count: 1,
      backup_path: '/tmp/backup.db',
      new_db_path: '/tmp/weighing-2026.db',
    });

    const { useYearRotation } = await import('@/hooks/useYearRotation');
    const hook = useYearRotation(logout);
    await hook.requestPreview();
    await hook.commit(true);
    expect(logout).toHaveBeenCalledTimes(1);
    const last = stateTransitions.at(-1) as { completed: boolean };
    expect(last.completed).toBe(true);
  });
});
