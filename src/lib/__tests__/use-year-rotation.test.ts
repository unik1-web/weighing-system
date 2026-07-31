import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('react', async () => {
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

vi.mock('@/lib/api', () => {
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

vi.mock('@/lib/storage-sync', () => ({
  beginRotationCommitSyncPause: beginPauseMock,
  endRotationCommitSyncPause: endPauseMock,
}));

describe('useYearRotation', () => {
  beforeEach(() => {
    stateValue = undefined;
    stateTransitions.length = 0;
    setState.mockClear();
    previewMock.mockReset();
    commitMock.mockReset();
    beginPauseMock.mockReset();
    endPauseMock.mockReset();
  });

  it('TC-UNIT-02: rotationRequired=true после preview', async () => {
    previewMock.mockResolvedValue({
      success: true,
      source_year: 2025,
      target_year: 2026,
      preview_token: 'preview-1',
      open_candidates: [{ ticket_id: 't-1' }],
      pending_reo_count: 0,
      blocking_tickets: [],
    });
    const { useYearRotation } = await import('@/hooks/useYearRotation');
    const hook = useYearRotation();
    await hook.requestPreview();

    const last = stateTransitions.at(-1) as { rotationRequired: boolean; pendingReoCount: number };
    expect(last.rotationRequired).toBe(true);
    expect(last.pendingReoCount).toBe(0);
  });

  it('TC-UNIT-02: submitting -> completed на commit', async () => {
    previewMock.mockResolvedValue({
      success: true,
      source_year: 2025,
      target_year: 2026,
      preview_token: 'preview-2',
      open_candidates: [],
      pending_reo_count: 0,
      blocking_tickets: [],
    });
    commitMock.mockResolvedValue({
      success: true,
      source_year: 2025,
      target_year: 2026,
      auto_closed_count: 1,
      backup_path: 'stub://backup',
      new_db_path: 'stub://target',
    });
    const { useYearRotation } = await import('@/hooks/useYearRotation');
    const hook = useYearRotation();
    await hook.requestPreview();
    await hook.commit();

    const submittingStates = stateTransitions
      .map((state) => (state as { submitting?: boolean }).submitting)
      .filter((value): value is boolean => typeof value === 'boolean');
    expect(submittingStates).toContain(true);
    const last = stateTransitions.at(-1) as { completed: boolean };
    expect(last.completed).toBe(true);
    expect(beginPauseMock).toHaveBeenCalledTimes(1);
    expect(endPauseMock).toHaveBeenCalledTimes(1);
  });

  it('TC-UNIT-02: sets error on preview failure', async () => {
    previewMock.mockRejectedValue(new Error('rotation_in_progress: Ротация уже выполняется'));
    const { useYearRotation } = await import('@/hooks/useYearRotation');
    const hook = useYearRotation();

    await expect(hook.requestPreview()).rejects.toThrow('rotation_in_progress');
    const last = stateTransitions.at(-1) as { submitting: boolean; completed: boolean; error: string };
    expect(last.submitting).toBe(false);
    expect(last.completed).toBe(false);
    expect(last.error).toContain('rotation_in_progress');
  });
});

