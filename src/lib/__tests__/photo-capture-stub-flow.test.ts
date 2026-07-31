/**
 * Frontend stub flow for photo capture: flush → capture → weight intact.
 * Anchors stage-7 orchestration until real HTTP/RTSP capture lands.
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

import { TicketAuditStorage, TicketStorage } from '../storage';
import { captureAfterWeightPersist } from '../photo-capture';

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

describe('photo capture stub flow', () => {
  it('flush→capture stub keeps ticket weight (frontend anchor)', async () => {
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
    expect(ticket.gross_weight).toBe(20000);

    const capture = await captureAfterWeightPersist(ticket.id, 'gross');

    expect(capture).not.toBeNull();
    expect(capture.capture?.noop).toBe(true);
    expect(capture.capture?.capture_token).toBe('stub');
    expect(capture.capture?.results).toEqual([]);
    expect(capture.warning).toBeNull();

    const stored = TicketStorage.getById(ticket.id);
    expect(stored).not.toBeNull();
    expect(stored!.gross_weight).toBe(20000);
    expect(stored!.tare_weight).toBe(8000);
    expect(stored!.net_weight).toBe(12000);
    expect(stored!.status).toBe('completed');

    const captureCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && String(call[0]).includes('/api/cameras/capture'),
    );
    expect(captureCall).toBeTruthy();
    expect(flushMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('capture network error does not wipe weight fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const ticket = TicketStorage.create(
      baseTicket({
        photo_entry_path: 'Photo/existing.jpg',
      }),
    );

    const capture = await captureAfterWeightPersist(ticket.id, 'tare');
    expect(capture.capture).toBeNull();
    expect(capture.warning).toBeTruthy();

    const stored = TicketStorage.getById(ticket.id);
    expect(stored!.gross_weight).toBe(20000);
    expect(stored!.photo_entry_path).toBe('Photo/existing.jpg');
  });
});
