/**
 * Photo-capture orchestration: flush → capture → merge → flush, degrade UI.
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

import { TicketAuditStorage, TicketPhotoStorage, TicketStorage, upsertTicketPhotosFromCapture } from '../storage';
import {
  applyCaptureMergeToStorage,
  captureAfterWeightPersist,
  mergeTicketPhotoStubsFromCapture,
  summarizeCaptureResults,
} from '../photo-capture';
import type { TicketPhoto } from '../cameras';
import type { CameraCaptureResponse } from '../api';

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

function photoRow(overrides: Partial<TicketPhoto> = {}): TicketPhoto {
  return {
    id: 'ph-1',
    ticket_id: 'ticket-a',
    camera_id: 'cam-1',
    camera_role: 'entry',
    event: 'gross',
    file_path: 'Photo/a.jpg',
    status: 'success',
    error_code: null,
    captured_at: '2026-07-31T10:00:00',
    camera_mode: 'primary',
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

describe('photo-capture orchestration', () => {
  it('TC-E2E-02: dual first gross then complete tare keeps both phase photos', async () => {
    const open = TicketStorage.create(
      baseTicket({
        status: 'open',
        completed_at: null,
        tare_weight: null,
        net_weight: null,
        total_amount: null,
        weighing_mode: 'dual',
      }),
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { event?: string };
      if (body.event === 'gross') {
        return response({
          success: true,
          noop: false,
          results: [{ camera_id: 'cam-1', camera_role: 'entry', status: 'success', file_path: 'Photo/g.jpg', error_code: null }],
          ticket_photos: [photoRow({ id: 'ph-g', ticket_id: open.id, event: 'gross', file_path: 'Photo/g.jpg' })],
          photo_entry_path: 'Photo/g.jpg',
          photo_exit_path: null,
          capture_token: 'tok-gross',
        });
      }
      return response({
        success: true,
        noop: false,
        results: [{ camera_id: 'cam-1', camera_role: 'entry', status: 'success', file_path: 'Photo/t.jpg', error_code: null }],
        ticket_photos: [photoRow({ id: 'ph-t', ticket_id: open.id, event: 'tare', file_path: 'Photo/t.jpg' })],
        photo_entry_path: 'Photo/t.jpg',
        photo_exit_path: null,
        capture_token: 'tok-tare',
      });
    });

    await captureAfterWeightPersist(open.id, 'gross');

    const completed = TicketStorage.update(open.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      tare_weight: 8000,
      net_weight: 12000,
      total_amount: 1200,
    });
    expect(completed!.photo_entry_path).toBe('Photo/g.jpg');

    await captureAfterWeightPersist(open.id, 'tare');
    const photos = TicketPhotoStorage.getByTicket(open.id);
    expect(photos.some((row) => row.event === 'gross' && row.file_path === 'Photo/g.jpg')).toBe(true);
    expect(photos.some((row) => row.event === 'tare' && row.file_path === 'Photo/t.jpg')).toBe(true);
    expect(TicketStorage.getById(open.id)!.photo_entry_path).toBe('Photo/t.jpg');
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-E2E-03: camera down → ticket weight intact + soft warning (not hard-fail)', async () => {
    const ticket = TicketStorage.create(baseTicket({ photo_entry_path: null }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        noop: false,
        results: [
          {
            camera_id: 'cam-1',
            camera_role: 'entry',
            status: 'failed',
            file_path: null,
            error_code: 'timeout',
          },
        ],
        ticket_photos: [
          photoRow({
            ticket_id: ticket.id,
            status: 'failed',
            file_path: null,
            error_code: 'timeout',
          }),
        ],
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'tok-fail',
      }),
    );

    const result = await captureAfterWeightPersist(ticket.id, 'gross');

    expect(result.capture).not.toBeNull();
    expect(result.warning).toContain('Снимки недоступны');
    const stored = TicketStorage.getById(ticket.id)!;
    expect(stored.gross_weight).toBe(20000);
    expect(stored.status).toBe('completed');
    expect(stored.photo_entry_path).toBeNull();
    expect(TicketPhotoStorage.getByTicket(ticket.id)[0].status).toBe('failed');
  });

  it('flush order: flush before and after capture', async () => {
    const order: string[] = [];
    flushMock.mockImplementation(async () => {
      order.push('flush');
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      order.push('capture');
      return response({
        success: true,
        noop: true,
        results: [],
        ticket_photos: [],
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'stub',
      });
    });

    const ticket = TicketStorage.create(baseTicket());
    await captureAfterWeightPersist(ticket.id, 'gross');
    expect(order).toEqual(['flush', 'capture', 'flush']);
  });

  it('404 ticket_not_found → warning, weight intact', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ success: false, code: 'ticket_not_found', message: 'not found' }, false, 404),
    );
    const ticket = TicketStorage.create(baseTicket({ photo_entry_path: 'Photo/x.jpg' }));
    const result = await captureAfterWeightPersist(ticket.id, 'tare');
    expect(result.capture).toBeNull();
    expect(result.warning).toContain('тикет ещё не в базе');
    expect(TicketStorage.getById(ticket.id)!.gross_weight).toBe(20000);
    expect(TicketStorage.getById(ticket.id)!.photo_entry_path).toBe('Photo/x.jpg');
  });

  it('409 rotation_in_progress → write-blocked warning', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(
        { success: false, code: 'rotation_in_progress', message: 'rotation' },
        false,
        409,
      ),
    );
    const ticket = TicketStorage.create(baseTicket());
    const result = await captureAfterWeightPersist(ticket.id, 'gross');
    expect(result.capture).toBeNull();
    expect(result.warning).toContain('Смена года');
  });

  it('TC-UNIT-01: merge upsert by UNIQUE (ticket_id, camera_id, event)', () => {
    const existing = [photoRow({ id: 'old', file_path: 'Photo/old.jpg' })];
    const incoming = [photoRow({ id: 'new', file_path: 'Photo/new.jpg' })];
    const merged = upsertTicketPhotosFromCapture(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('new');
    expect(merged[0].file_path).toBe('Photo/new.jpg');
  });

  it('TC-UNIT-02: forbid assigning response array over full list', () => {
    const full = [
      photoRow({ id: 'a', ticket_id: 'ticket-a' }),
      photoRow({ id: 'b', ticket_id: 'ticket-b', file_path: 'Photo/b.jpg' }),
    ];
    const responseOnlyA = [photoRow({ id: 'a2', ticket_id: 'ticket-a', file_path: 'Photo/a2.jpg' })];
    const upserted = upsertTicketPhotosFromCapture(full, responseOnlyA);
    expect(upserted.some((row) => row.ticket_id === 'ticket-b')).toBe(true);
    // Document forbidden pattern: replaceAll would wipe B
    const forbiddenReplace = responseOnlyA;
    expect(forbiddenReplace.some((row) => row.ticket_id === 'ticket-b')).toBe(false);
    expect(upserted.length).toBeGreaterThan(forbiddenReplace.length);
  });

  it('TC-UNIT-03: complete dual preserves previous entry stub when capture noop', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        noop: true,
        results: [],
        ticket_photos: [],
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'noop-tok',
      }),
    );

    const open = TicketStorage.create(
      baseTicket({
        status: 'open',
        weighing_mode: 'dual',
        photo_entry_path: 'Photo/entry-keep.jpg',
        photo_exit_path: null,
        tare_weight: null,
      }),
    );
    const completed = TicketStorage.update(open.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      tare_weight: 8000,
      net_weight: 12000,
      total_amount: 1200,
    });
    expect(completed!.photo_entry_path).toBe('Photo/entry-keep.jpg');

    await captureAfterWeightPersist(open.id, 'tare');
    expect(TicketStorage.getById(open.id)!.photo_entry_path).toBe('Photo/entry-keep.jpg');
  });

  it('merge null stub without capture_token preserves existing path', () => {
    const merged = mergeTicketPhotoStubsFromCapture(
      { photo_entry_path: 'Photo/keep.jpg', photo_exit_path: null },
      {
        noop: false,
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: '',
      },
    );
    expect(merged.photo_entry_path).toBe('Photo/keep.jpg');
  });

  it('merge null stub with capture_token allows null', () => {
    const merged = mergeTicketPhotoStubsFromCapture(
      { photo_entry_path: 'Photo/keep.jpg', photo_exit_path: null },
      {
        noop: false,
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'tok',
      },
    );
    expect(merged.photo_entry_path).toBeNull();
  });

  it('applyCaptureMerge stores capture_token on ticket', () => {
    const ticket = TicketStorage.create(baseTicket());
    const capture = {
      success: true as const,
      noop: false,
      results: [],
      ticket_photos: [
        {
          id: 'ph-1',
          ticket_id: ticket.id,
          camera_id: 'cam-1',
          camera_role: 'entry',
          event: 'gross',
          file_path: 'Photo/x.jpg',
          status: 'success',
          error_code: null,
          captured_at: '2026-07-31T10:00:00',
          camera_mode: 'primary',
        },
      ],
      photo_entry_path: 'Photo/x.jpg',
      photo_exit_path: null,
      capture_token: 'merge-token',
    } as CameraCaptureResponse;
    applyCaptureMergeToStorage(ticket.id, capture);
    expect(TicketStorage.getById(ticket.id)!.capture_token).toBe('merge-token');
    expect(TicketStorage.getById(ticket.id)!.photo_entry_path).toBe('Photo/x.jpg');
  });

  it('summarizeCaptureResults mixed → Снято N из M', () => {
    const msg = summarizeCaptureResults({
      success: true,
      noop: false,
      results: [
        { camera_id: '1', camera_role: 'entry', status: 'success', file_path: 'a', error_code: null },
        { camera_id: '2', camera_role: 'exit', status: 'failed', file_path: null, error_code: 'timeout' },
      ],
      ticket_photos: [],
      photo_entry_path: 'a',
      photo_exit_path: null,
      capture_token: 't',
    });
    expect(msg).toBe('Снято 1 из 2. Взвешивание сохранено.');
  });

  it('TicketStorage.update without photo_* does not wipe stubs', () => {
    const ticket = TicketStorage.create(
      baseTicket({ photo_entry_path: 'Photo/keep.jpg', photo_exit_path: 'Photo/exit.jpg' }),
    );
    const updated = TicketStorage.update(ticket.id, {
      notes: 'updated',
      tare_weight: 9000,
    });
    expect(updated!.photo_entry_path).toBe('Photo/keep.jpg');
    expect(updated!.photo_exit_path).toBe('Photo/exit.jpg');
    expect(updated!.notes).toBe('updated');
  });
});
