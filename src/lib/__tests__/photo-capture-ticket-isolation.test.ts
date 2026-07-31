/**
 * MUST: capture/merge for ticket A must not erase ticket B photos in app_ticket_photos.
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
  TicketAuditStorage,
  TicketPhotoStorage,
  TicketStorage,
  upsertTicketPhotosFromCapture,
  type TicketPhoto,
} from '../storage';
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

describe('photo-capture ticket isolation', () => {
  it('TC-E2E-04: capture ticket A + upsert does not shrink ticket B photos', async () => {
    const photoB: TicketPhoto = {
      id: 'ph-b',
      ticket_id: 'ticket-b',
      camera_id: 'cam-1',
      camera_role: 'entry',
      event: 'gross',
      file_path: 'Photo/b.jpg',
      status: 'success',
      error_code: null,
      captured_at: '2026-07-31T09:00:00',
      camera_mode: 'primary',
    };
    TicketPhotoStorage.upsertMany([photoB]);
    expect(TicketPhotoStorage.getByTicket('ticket-b')).toHaveLength(1);

    const ticketA = TicketStorage.create(baseTicket());
    const photoA: TicketPhoto = {
      id: 'ph-a',
      ticket_id: ticketA.id,
      camera_id: 'cam-1',
      camera_role: 'entry',
      event: 'gross',
      file_path: 'Photo/a.jpg',
      status: 'success',
      error_code: null,
      captured_at: '2026-07-31T10:00:00',
      camera_mode: 'primary',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        noop: false,
        results: [
          {
            camera_id: 'cam-1',
            camera_role: 'entry',
            status: 'success',
            file_path: 'Photo/a.jpg',
            error_code: null,
          },
        ],
        // Response scoped to ticket A only — must upsert, not replaceAll.
        ticket_photos: [photoA],
        photo_entry_path: 'Photo/a.jpg',
        photo_exit_path: null,
        capture_token: 'tok-a',
      }),
    );

    const beforeB = TicketPhotoStorage.getByTicket('ticket-b').length;
    await captureAfterWeightPersist(ticketA.id, 'gross');
    const afterB = TicketPhotoStorage.getByTicket('ticket-b').length;

    expect(afterB).toBe(beforeB);
    expect(afterB).toBe(1);
    expect(TicketPhotoStorage.getByTicket(ticketA.id)).toHaveLength(1);
    expect(TicketPhotoStorage.getAll().length).toBe(2);

    // Explicit forbidden pattern check after merge helper
    const full = TicketPhotoStorage.getAll();
    const onlyA = full.filter((row) => row.ticket_id === ticketA.id);
    const wrong = onlyA; // replaceAll(response.ticket_photos)
    const right = upsertTicketPhotosFromCapture(full, onlyA);
    expect(wrong.some((row) => row.ticket_id === 'ticket-b')).toBe(false);
    expect(right.some((row) => row.ticket_id === 'ticket-b')).toBe(true);
  });
});
