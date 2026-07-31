import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { YearRotationDialog } from '@/components/YearRotationDialog';
import type { RotationPreviewResponse } from '@/lib/api';

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

const basePreview: RotationPreviewResponse = {
  success: true,
  source_year: 2025,
  target_year: 2026,
  preview_token: 'rotprev_2025_2026_abc123',
  open_candidates: [
    {
      ticket_id: 't-open-1',
      ticket_number: 101,
      tare_weight: 1200,
      tare_source: 'dictionary',
    },
  ],
  pending_reo_count: 0,
  blocking_tickets: [],
};

describe('year rotation dialog contract flow', () => {
  it('блокирует confirm при blocking_tickets', () => {
    const html = renderToStaticMarkup(
      React.createElement(YearRotationDialog, {
        open: true,
        preview: {
          ...basePreview,
          blocking_tickets: [
            {
              ticket_id: 't-block',
              ticket_number: 55,
              vehicle_number: 'A001AA56',
              reason: 'missing_tare_dictionary_and_default',
            },
          ],
        },
        committing: false,
        error: null,
        blockingTickets: [
          {
            ticket_id: 't-block',
            ticket_number: 55,
            vehicle_number: 'A001AA56',
            reason: 'missing_tare_dictionary_and_default',
          },
        ],
        pendingReoCount: 0,
        onConfirm: () => undefined,
        onClose: () => undefined,
      }),
    );

    expect(html).toContain('Ротация заблокирована');
    expect(html).toContain('disabled');
    expect(html).toContain('Подтвердить ротацию');
  });

  it('требует подтверждение pending_reo_count перед commit', () => {
    const html = renderToStaticMarkup(
      React.createElement(YearRotationDialog, {
        open: true,
        preview: { ...basePreview, pending_reo_count: 2 },
        committing: false,
        error: null,
        blockingTickets: [],
        pendingReoCount: 2,
        onConfirm: () => undefined,
        onClose: () => undefined,
      }),
    );

    expect(html).toContain('pending-тикетов РЭО (2)');
    expect(html).toContain('disabled');
  });
});

describe('year rotation commit -> logout flow', () => {
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
  const beginPauseMock = vi.fn();
  const endPauseMock = vi.fn();

  beforeEach(() => {
    stateValue = undefined;
    stateTransitions.length = 0;
    setState.mockClear();
    previewMock.mockReset();
    commitMock.mockReset();
    beginPauseMock.mockReset();
    endPauseMock.mockReset();
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
      beginRotationCommitSyncPause: beginPauseMock,
      endRotationCommitSyncPause: endPauseMock,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commit success вызывает onCompleted (logout)', async () => {
    const logout = vi.fn(async () => undefined);
    previewMock.mockResolvedValue({
      ...basePreview,
      pending_reo_count: 1,
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

    const last = stateTransitions.at(-1) as { completed: boolean };
    expect(last.completed).toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(beginPauseMock).toHaveBeenCalledTimes(1);
    expect(endPauseMock).toHaveBeenCalledTimes(1);
  });
});
