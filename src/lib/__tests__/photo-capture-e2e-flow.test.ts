/**
 * Consolidated frontend E2E anchors for photo capture (UC-03/UC-04):
 * orchestration + preview grouping + ticket isolation + PrintAct without photos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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

import { PrintAct } from '@/components/PrintAct';
import { TicketPhotosPreview } from '@/components/TicketPhotosPreview';
import type { TicketPhoto } from '@/lib/cameras';
import {
  applyCaptureMergeToStorage,
  captureAfterWeightPersist,
  mergeTicketPhotoStubsFromCapture,
} from '@/lib/photo-capture';
import {
  groupPhotosByEvent,
  selectSuccessPreviewPhotos,
} from '@/lib/ticket-photos-preview';
import {
  DEFAULT_APP_SETTINGS,
  TicketAuditStorage,
  TicketPhotoStorage,
  TicketStorage,
  upsertTicketPhotosFromCapture,
  type WeighingTicket,
} from '@/lib/storage';

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

function photoRow(
  overrides: Partial<TicketPhoto> & Pick<TicketPhoto, 'id' | 'event' | 'camera_role' | 'ticket_id'>,
): TicketPhoto {
  return {
    camera_id: `cam-${overrides.camera_role}`,
    file_path: `Photo/2026/07/31/${overrides.id}.jpg`,
    status: 'success',
    error_code: null,
    captured_at: '2026-07-31T12:00:00.000Z',
    camera_mode: 'primary',
    ...overrides,
  };
}

function makePrintTicket(): WeighingTicket {
  return {
    id: 't-print-no-photo',
    ticket_number: 12,
    vehicle_number: 'А123АА56',
    vehicle_brand: 'Камаз',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'Грунт',
    shipper_name: 'Отправитель',
    receiver_name: 'Получатель',
    carrier_name: 'Перевозчик',
    price: 0,
    vat_rate: 20,
    gross_weight: 20000,
    tare_weight: 5000,
    net_weight: 15000,
    total_amount: 0,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-03-10T09:30:00',
    tare_datetime: '2026-03-10T09:35:00',
    scale_device: 'manual',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed',
    reo_status: 'pending',
    reo_sent_at: null,
    auto_closed: false,
    notes: '',
    created_at: '2026-03-10T09:30:00',
    completed_at: '2026-03-10T09:35:00',
    weighing_mode: 'single',
    version: 1,
    photo_entry_path: null,
    photo_exit_path: null,
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

describe('photo capture e2e flow', () => {
  it('TC-E2E: orchestration flush→capture→merge keeps weight and merges previews', async () => {
    const ticket = TicketStorage.create(baseTicket());
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        noop: false,
        results: [{ camera_id: 'cam-entry', status: 'success' }],
        ticket_photos: [
          photoRow({
            id: 'ph-e2e-1',
            ticket_id: ticket.id,
            event: 'gross',
            camera_role: 'entry',
            camera_id: 'cam-entry',
          }),
        ],
        photo_entry_path: 'Photo/2026/07/31/ph-e2e-1.jpg',
        photo_exit_path: null,
        capture_token: 'tok-e2e-1',
      }),
    );

    const capture = await captureAfterWeightPersist(ticket.id, 'gross');

    expect(fetchSpy).toHaveBeenCalled();
    expect(capture.capture?.success).toBe(true);
    expect(capture.capture?.photo_entry_path).toBe('Photo/2026/07/31/ph-e2e-1.jpg');
    expect(TicketStorage.getById(ticket.id)!.gross_weight).toBe(20000);
    expect(TicketStorage.getById(ticket.id)!.photo_entry_path).toBe(
      'Photo/2026/07/31/ph-e2e-1.jpg',
    );
    expect(TicketPhotoStorage.getByTicket(ticket.id)).toHaveLength(1);

    const html = renderToStaticMarkup(
      React.createElement(TicketPhotosPreview, { ticketId: ticket.id }),
    );
    expect(html).toContain('Снимки (1)');
    expect(html).toContain('data-event="gross"');
  });

  it('TC-UNIT-01: preview grouping orders gross then tare', () => {
    const rows = [
      photoRow({ id: 't1', ticket_id: 't-g', event: 'tare', camera_role: 'exit' }),
      photoRow({ id: 'g1', ticket_id: 't-g', event: 'gross', camera_role: 'overview' }),
      photoRow({ id: 'g2', ticket_id: 't-g', event: 'gross', camera_role: 'entry' }),
      photoRow({
        id: 'fail',
        ticket_id: 't-g',
        event: 'tare',
        camera_role: 'entry',
        status: 'failed',
        file_path: null,
      }),
    ];
    const groups = groupPhotosByEvent(rows);
    expect(groups.map((g) => g.event)).toEqual(['gross', 'tare']);
    expect(selectSuccessPreviewPhotos(rows)).toHaveLength(3);
  });

  it('TC-UNIT-02: merge isolation — ticket A capture does not erase ticket B photos', () => {
    const photoB = photoRow({
      id: 'ph-b',
      ticket_id: 'ticket-b',
      event: 'gross',
      camera_role: 'entry',
    });
    TicketPhotoStorage.upsertMany([photoB]);

    const merged = upsertTicketPhotosFromCapture(TicketPhotoStorage.getAll(), [
      photoRow({
        id: 'ph-a',
        ticket_id: 'ticket-a',
        event: 'gross',
        camera_role: 'entry',
      }),
    ]);
    TicketPhotoStorage.upsertMany(merged);

    const all = TicketPhotoStorage.getAll();
    expect(all.find((p) => p.ticket_id === 'ticket-b')?.id).toBe('ph-b');
    expect(all.find((p) => p.ticket_id === 'ticket-a')?.id).toBe('ph-a');
  });

  it('TC-UNIT-03: WeighingForm-style update without photo_* does not wipe stubs', () => {
    const ticket = TicketStorage.create(
      baseTicket({
        photo_entry_path: 'Photo/keep-entry.jpg',
        photo_exit_path: 'Photo/keep-exit.jpg',
      }),
    );
    const updated = TicketStorage.update(ticket.id, {
      notes: 'после фиксации',
      tare_weight: 8100,
    });
    expect(updated!.photo_entry_path).toBe('Photo/keep-entry.jpg');
    expect(updated!.photo_exit_path).toBe('Photo/keep-exit.jpg');
    expect(updated!.notes).toBe('после фиксации');
  });

  it('TC-E2E-05: PrintAct renders without photo stubs or ticket_photos', () => {
    const ticket = makePrintTicket();
    const actHtml = renderToStaticMarkup(
      React.createElement(PrintAct, {
        ticket,
        settings: { ...DEFAULT_APP_SETTINGS, print_layout: 'act' },
      }),
    );
    const receiptHtml = renderToStaticMarkup(
      React.createElement(PrintAct, {
        ticket,
        settings: { ...DEFAULT_APP_SETTINGS, print_layout: 'receipt' },
      }),
    );

    expect(actHtml).toContain('№ 12 от 10.03.2026');
    expect(receiptHtml).toContain('№ 12 от 10.03.2026');
    expect(actHtml).not.toContain('Photo/');
    expect(actHtml).not.toContain('/api/photos');
    expect(actHtml).not.toContain('Снимки');
    expect(receiptHtml).not.toContain('Photo/');
    expect(receiptHtml).not.toContain('/api/photos');
  });

  it('noop capture with token does not clear existing stubs', () => {
    const ticket = TicketStorage.create(
      baseTicket({ photo_entry_path: 'Photo/existing.jpg' }),
    );
    const merged = mergeTicketPhotoStubsFromCapture(
      { photo_entry_path: ticket.photo_entry_path, photo_exit_path: ticket.photo_exit_path },
      {
        success: true,
        noop: true,
        results: [],
        ticket_photos: [],
        photo_entry_path: null,
        photo_exit_path: null,
        capture_token: 'noop-tok',
      },
    );
    applyCaptureMergeToStorage(ticket.id, {
      success: true,
      noop: true,
      results: [],
      ticket_photos: [],
      photo_entry_path: null,
      photo_exit_path: null,
      capture_token: 'noop-tok',
    });
    expect(merged.photo_entry_path).toBe('Photo/existing.jpg');
    expect(TicketStorage.getById(ticket.id)!.photo_entry_path).toBe('Photo/existing.jpg');
  });
});
