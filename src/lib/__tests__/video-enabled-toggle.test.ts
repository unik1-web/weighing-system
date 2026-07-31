/**
 * video_enabled toggle branches (UC-05 / TC-E2E-07):
 * false → capture noop; camera registry remains intact.
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

import { DEFAULT_SITE_ID } from '../site';
import {
  CameraStorage,
  DEFAULT_APP_SETTINGS,
  SettingsStorage,
  TicketAuditStorage,
  TicketStorage,
} from '../storage';
import { captureAfterWeightPersist } from '../photo-capture';
import type { Camera } from '../cameras';

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

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeCamera(
  overrides: Partial<Camera> & { id: string; name: string; role: 'entry' | 'exit' | 'overview' },
): Camera {
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

function baseTicket(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_number: 'А001АА56',
    vehicle_brand: '',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'Грунт',
    shipper_name: 'Отправитель',
    receiver_name: 'Получатель',
    carrier_name: 'Перевозчик',
    price: 100,
    vat_rate: 0,
    gross_weight: 20000,
    tare_weight: 8000,
    net_weight: 12000,
    total_amount: 1200,
    gross_source: 'manual' as const,
    tare_source: 'manual' as const,
    gross_raw: null,
    tare_raw: null,
    gross_datetime: new Date().toISOString(),
    tare_datetime: new Date().toISOString(),
    scale_device: 'test',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed' as const,
    completed_at: new Date().toISOString(),
    notes: '',
    weighing_mode: 'single' as const,
    photo_entry_path: null,
    photo_exit_path: null,
    ...overrides,
  };
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

describe('video_enabled toggle', () => {
  it('TC-E2E-07: video_enabled=false → capture noop; camera registry intact', async () => {
    CameraStorage.replaceAll([
      makeCamera({ id: 'cam-keep', name: 'Въезд', role: 'entry', sort_order: 0 }),
      makeCamera({
        id: 'cam-exit',
        name: 'Выезд',
        role: 'exit',
        sort_order: 1,
        http_snapshot_url: 'http://cam/exit',
      }),
    ]);
    SettingsStorage.updateAppSettings({
      ...DEFAULT_APP_SETTINGS,
      video_enabled: false,
    });
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(false);
    expect(CameraStorage.getBySite(DEFAULT_SITE_ID)).toHaveLength(2);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        noop: true,
        results: [],
        ticket_photos: [],
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'noop-video-off',
      }),
    );

    const ticket = TicketStorage.create(baseTicket());
    const capture = await captureAfterWeightPersist(ticket.id, 'gross');

    expect(fetchSpy).toHaveBeenCalled();
    expect(capture.capture?.noop).toBe(true);
    expect(capture.capture?.results).toEqual([]);
    expect(TicketStorage.getById(ticket.id)!.gross_weight).toBe(20000);

    // Registry must survive toggle-off path (SoT cameras separate from video_enabled).
    expect(CameraStorage.getAll()).toHaveLength(2);
    expect(CameraStorage.getAll().map((c) => c.id).sort()).toEqual(['cam-exit', 'cam-keep']);
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(false);
  });

  it('toggle false→true keeps the same camera registry rows', () => {
    CameraStorage.replaceAll([
      makeCamera({ id: 'cam-persist', name: 'Обзор', role: 'overview', enabled: false }),
    ]);
    SettingsStorage.updateAppSettings({ video_enabled: false });
    expect(CameraStorage.getAll()).toHaveLength(1);

    SettingsStorage.updateAppSettings({ video_enabled: true });
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(true);
    expect(CameraStorage.getAll()).toHaveLength(1);
    expect(CameraStorage.getAll()[0].id).toBe('cam-persist');
    expect(CameraStorage.getAll()[0].enabled).toBe(false);
  });
});
