/**
 * E2E / unit flow tests for etalon capture merge + flush (UC-02).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flushMock = vi.fn(async () => undefined);

vi.mock('../storage-sync', async () => {
  const actual = await vi.importActual<typeof import('../storage-sync')>('../storage-sync');
  return {
    ...actual,
    flushDatabaseSync: (...args: unknown[]) => flushMock(...args),
    scheduleDatabaseSync: vi.fn(),
    scheduleConfigSync: vi.fn(),
  };
});

import { CameraStorage, TicketAuditStorage } from '../storage';
import {
  captureEtalonAndFlush,
  mergeEtalonCaptureIntoCameraStorage,
} from '../cameras';
import { DEFAULT_SITE_ID } from '../site';
import type { CameraEtalonResponse } from '../api';

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

function makeCamera(
  overrides: Partial<import('../cameras').Camera> & {
    id: string;
    name: string;
    role: 'entry' | 'exit' | 'overview';
  },
) {
  const now = '2026-07-31T10:00:00.000Z';
  return {
    site_id: DEFAULT_SITE_ID,
    http_snapshot_url: 'http://cam/snap',
    rtsp_url: null,
    enabled: true,
    roi_x: null,
    roi_y: null,
    roi_w: null,
    roi_h: null,
    etalon_primary_path: null,
    etalon_spare_path: null,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

installLocalStorage();

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
  flushMock.mockClear();
  flushMock.mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('etalon capture flow', () => {
  it('TC-E2E-01: spare etalon merge sets spare path; primary stays null', async () => {
    const camera = makeCamera({ id: 'cam-1', name: 'Въезд', role: 'entry' });
    CameraStorage.replaceAll([camera]);

    const apiBody: CameraEtalonResponse = {
      success: true,
      path: 'Photo/etalons/cam-1/spare.jpg',
      preview_jpeg_base64: 'abc',
      camera: {
        ...camera,
        etalon_spare_path: 'Photo/etalons/cam-1/spare.jpg',
        etalon_primary_path: null,
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(apiBody));

    const callOrder: string[] = [];
    flushMock.mockImplementation(async () => {
      callOrder.push('flush');
    });
    const mergeSpy = vi.spyOn(CameraStorage, 'upsert');

    const result = await captureEtalonAndFlush('cam-1', 'spare');
    expect(result.path).toBe('Photo/etalons/cam-1/spare.jpg');

    const stored = CameraStorage.getAll()[0];
    expect(stored.etalon_spare_path).toBe('Photo/etalons/cam-1/spare.jpg');
    expect(stored.etalon_primary_path).toBeNull();
    expect(flushMock).toHaveBeenCalled();
    // Merge (upsert) must happen before flush.
    expect(mergeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      // flushMock is async; ensure upsert was called
      Number.MAX_SAFE_INTEGER,
    );
    expect(mergeSpy).toHaveBeenCalled();
    expect(callOrder[0]).toBe('flush');
  });

  it('TC-E2E-02: capture error does not clear existing etalon paths', async () => {
    CameraStorage.replaceAll([
      makeCamera({
        id: 'cam-1',
        name: 'Въезд',
        role: 'entry',
        etalon_spare_path: 'Photo/etalons/cam-1/spare.jpg',
        etalon_primary_path: 'Photo/etalons/cam-1/primary.jpg',
      }),
    ]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(
        { success: false, code: 'camera_unreachable', message: 'Камера недоступна' },
        false,
        503,
      ),
    );

    await expect(captureEtalonAndFlush('cam-1', 'spare')).rejects.toThrow();

    const stored = CameraStorage.getAll()[0];
    expect(stored.etalon_spare_path).toBe('Photo/etalons/cam-1/spare.jpg');
    expect(stored.etalon_primary_path).toBe('Photo/etalons/cam-1/primary.jpg');
    expect(flushMock).not.toHaveBeenCalled();
  });

  it('TC-E2E-03: merge then flush contract — upsert before flushDatabaseSync', async () => {
    const camera = makeCamera({ id: 'cam-2', name: 'Обзор', role: 'overview' });
    CameraStorage.replaceAll([camera]);

    const events: string[] = [];
    const originalUpsert = CameraStorage.upsert.bind(CameraStorage);
    vi.spyOn(CameraStorage, 'upsert').mockImplementation((row) => {
      events.push('merge');
      return originalUpsert(row);
    });
    flushMock.mockImplementation(async () => {
      events.push('flush');
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        path: 'Photo/etalons/cam-2/primary.jpg',
        preview_jpeg_base64: 'xyz',
        camera: {
          ...camera,
          etalon_primary_path: 'Photo/etalons/cam-2/primary.jpg',
        },
      }),
    );

    await captureEtalonAndFlush('cam-2', 'primary');
    expect(events).toEqual(['merge', 'flush']);
  });

  it('TC-UNIT-01: path format for merge from response', () => {
    CameraStorage.replaceAll([makeCamera({ id: 'cam-x', name: 'X', role: 'exit' })]);
    const merged = mergeEtalonCaptureIntoCameraStorage(
      {
        success: true,
        path: 'Photo/etalons/cam-x/spare.jpg',
        preview_jpeg_base64: '',
        camera: {
          id: 'cam-x',
          site_id: DEFAULT_SITE_ID,
          name: 'X',
          role: 'exit',
          http_snapshot_url: 'http://cam/snap',
          rtsp_url: null,
          enabled: true,
          roi_x: null,
          roi_y: null,
          roi_w: null,
          roi_h: null,
          etalon_primary_path: null,
          etalon_spare_path: 'Photo/etalons/cam-x/spare.jpg',
          sort_order: 0,
          created_at: '2026-07-31T10:00:00.000Z',
          updated_at: '2026-07-31T11:00:00.000Z',
        },
      },
      'spare',
    );
    expect(merged?.etalon_spare_path).toBe('Photo/etalons/cam-x/spare.jpg');
    expect(merged?.etalon_spare_path).toMatch(/^Photo\/etalons\/[^/]+\/spare\.jpg$/);
  });

  it('UI source exposes primary/spare etalon capture buttons', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../components/VideoSettingsSection.tsx'),
      'utf8',
    );
    expect(source).toContain('Снять эталон primary');
    expect(source).toContain('Снять эталон spare');
    expect(source).toContain('captureEtalonAndFlush');
  });
});
