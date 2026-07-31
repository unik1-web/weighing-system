/**
 * Stub contracts for camera storage / capture merge (stage 7 frontend skeleton).
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

import {
  CameraStorage,
  SettingsStorage,
  TicketPhotoStorage,
  TicketStorage,
  TicketAuditStorage,
  upsertTicketPhotosFromCapture,
  type TicketPhoto,
  DEFAULT_APP_SETTINGS,
} from '../storage';
import { captureAfterWeightPersist } from '../photo-capture';
import { fetchCameraCapability } from '../api';

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

describe('cameras stub flow', () => {
  it('TC-E2E-01: single-save flush→capture→flush returns noop stub', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        noop: true,
        results: [],
        ticket_photos: [],
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'stub',
      }),
    );

    const ticket = TicketStorage.create(baseTicket());
    const capture = await captureAfterWeightPersist(ticket.id, 'gross');

    expect(capture.capture?.noop).toBe(true);
    expect(capture.capture?.capture_token).toBe('stub');
    expect(TicketStorage.getById(ticket.id)?.status).toBe('completed');
    expect(TicketStorage.getById(ticket.id)?.gross_weight).toBe(20000);
    const captureCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && String(call[0]).includes('/api/cameras/capture'),
    );
    expect(captureCall).toBeTruthy();
    expect(flushMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-E2E-02: dual complete does not wipe existing photo_entry_path with null', () => {
    const open = TicketStorage.create(
      baseTicket({
        status: 'open',
        completed_at: null,
        tare_weight: null,
        net_weight: null,
        total_amount: null,
        tare_datetime: null,
        weighing_mode: 'dual',
        photo_entry_path: 'Photo/2026/07/31/entry.jpg',
        photo_exit_path: null,
      }),
    );

    // Patch omits photo_* — TicketStorage.update must preserve stubs.
    const completed = TicketStorage.update(open.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      tare_weight: 8000,
      net_weight: 12000,
      total_amount: 1200,
      tare_datetime: new Date().toISOString(),
    });

    expect(completed).not.toBeNull();
    expect(completed!.photo_entry_path).toBe('Photo/2026/07/31/entry.jpg');
    expect(completed!.photo_exit_path).toBeNull();
  });

  it('TC-E2E-03: upsertTicketPhotosFromCapture for ticket A does not remove ticket B', () => {
    const photoB: TicketPhoto = {
      id: 'ph-b',
      ticket_id: 'ticket-b',
      camera_id: 'cam-1',
      camera_role: 'entry',
      event: 'gross',
      file_path: 'Photo/b.jpg',
      status: 'success',
      error_code: null,
      captured_at: '2026-07-31T10:00:00',
      camera_mode: 'primary',
    };
    const photoA: TicketPhoto = {
      id: 'ph-a',
      ticket_id: 'ticket-a',
      camera_id: 'cam-1',
      camera_role: 'entry',
      event: 'gross',
      file_path: 'Photo/a.jpg',
      status: 'success',
      error_code: null,
      captured_at: '2026-07-31T11:00:00',
      camera_mode: 'primary',
    };

    TicketPhotoStorage.upsertMany([photoB]);
    const merged = upsertTicketPhotosFromCapture(TicketPhotoStorage.getAll(), [photoA]);
    TicketPhotoStorage.upsertMany([photoA]);

    expect(merged.some((row) => row.ticket_id === 'ticket-b')).toBe(true);
    expect(TicketPhotoStorage.getAll().some((row) => row.ticket_id === 'ticket-b')).toBe(true);
    expect(TicketPhotoStorage.getByTicket('ticket-a')).toHaveLength(1);
    expect(TicketPhotoStorage.getByTicket('ticket-b')).toHaveLength(1);
  });

  it('TC-UNIT-01: CameraStorage.replaceAll writes app_cameras', () => {
    CameraStorage.replaceAll([
      {
        id: 'cam-1',
        site_id: 'site-1',
        name: 'Въезд',
        role: 'entry',
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
        created_at: '2026-07-31T00:00:00',
        updated_at: '2026-07-31T00:00:00',
      },
    ]);

    const raw = localStorage.getItem('app_cameras');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Array<{ id: string; name: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('cam-1');
    expect(CameraStorage.getAll()[0].name).toBe('Въезд');
  });

  it('TC-UNIT-02: Settings parse defaults video_enabled=false', () => {
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(false);
    expect(SettingsStorage.getAppSettings().camera_capture_timeout_sec).toBe(3);
    expect(SettingsStorage.getAppSettings().camera_jpeg_quality).toBe(80);
    expect(DEFAULT_APP_SETTINGS.video_enabled).toBe(false);
  });

  it('TC-UNIT-03: VideoSettingsSection gates CRUD behind available=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        available: false,
        build: 'basic',
        opencv: false,
        code: 'camera_module_unavailable',
      }),
    );

    const capability = await fetchCameraCapability();
    expect(capability.available).toBe(false);

    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../components/VideoSettingsSection.tsx'),
      'utf8',
    );
    expect(source).toContain('недоступен в этой сборке');
    // CRUD markup exists but only renders when capability.available === true.
    expect(source).toContain('Добавить камеру');
    expect(source).toMatch(/available &&/);
  });
});
