import { describe, expect, it, beforeEach } from 'vitest';
import {
  matchJournalFilters,
  ticketHasPhotos,
  DEFAULT_JOURNAL_FILTERS,
  type JournalFilterState,
} from '../journal-filters';
import {
  TicketPhotosStorage,
  type WeighingTicket,
} from '../storage';

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

function baseTicket(overrides: Partial<WeighingTicket> = {}): WeighingTicket {
  return {
    id: 't1',
    ticket_number: 1,
    vehicle_number: 'А001АА56',
    vehicle_brand: '',
    trailer_number: '',
    driver_name: 'Иванов',
    cargo_name: 'Грунт',
    shipper_name: '',
    receiver_name: '',
    carrier_name: '',
    price: 0,
    vat_rate: 0,
    gross_weight: 10000,
    tare_weight: 3000,
    net_weight: 7000,
    total_amount: 0,
    gross_source: 'instrument',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: null,
    tare_datetime: null,
    scale_device: '',
    operator_id: 'op1',
    operator_name: 'Петров',
    status: 'completed',
    reo_status: 'pending',
    reo_sent_at: null,
    notes: '',
    created_at: '2026-01-01T10:00:00Z',
    completed_at: '2026-01-01T10:05:00Z',
    weighing_mode: 'dual',
    site_id: 'site-1',
    scale_id: 'scale-1',
    scale_role: 'primary',
    ...overrides,
  };
}

describe('journal-filters', () => {
  beforeEach(() => {
    localStorage.clear();
    TicketPhotosStorage.ensureInitialized();
  });

  it('matches site / role / mode / anpr / operator', () => {
    const ticket = baseTicket({ anpr_status: 'enabled' });
    const filters: JournalFilterState = {
      ...DEFAULT_JOURNAL_FILTERS,
      siteId: 'site-1',
      scaleRole: 'primary',
      weighingMode: 'dual',
      anprStatus: 'enabled',
      operator: 'петр',
    };
    expect(matchJournalFilters(ticket, filters)).toBe(true);
    expect(matchJournalFilters(ticket, { ...filters, siteId: 'other' })).toBe(false);
    expect(matchJournalFilters(ticket, { ...filters, scaleRole: 'spare' })).toBe(false);
    expect(matchJournalFilters(ticket, { ...filters, weighingMode: 'single' })).toBe(false);
    expect(matchJournalFilters(ticket, { ...filters, anprStatus: 'failed' })).toBe(false);
  });

  it('matches photo via soft-path or TicketPhotosStorage', () => {
    const withPath = baseTicket({ photo_entry_path: 'Photo/a.jpg' });
    expect(ticketHasPhotos(withPath)).toBe(true);
    expect(
      matchJournalFilters(withPath, { ...DEFAULT_JOURNAL_FILTERS, photo: 'has' }),
    ).toBe(true);

    const bare = baseTicket({ id: 't2' });
    expect(ticketHasPhotos(bare)).toBe(false);
    TicketPhotosStorage.merge([
      {
        id: 'p1',
        ticket_id: 't2',
        phase: 'gross',
        camera_id: 'c1',
        camera_role: 'entry',
        relative_path: 'Photo/b.jpg',
        status: 'ok',
        error_message: null,
        camera_mode: 'normal',
        created_at: '2026-01-01T10:00:00Z',
      },
    ]);
    expect(ticketHasPhotos(bare)).toBe(true);
    expect(matchJournalFilters(bare, { ...DEFAULT_JOURNAL_FILTERS, photo: 'none' })).toBe(false);
  });

  it('treats unset anpr/site as unset filter', () => {
    const ticket = baseTicket({ site_id: null, anpr_status: null });
    expect(
      matchJournalFilters(ticket, { ...DEFAULT_JOURNAL_FILTERS, siteId: 'unset', anprStatus: 'unset' }),
    ).toBe(true);
  });
});
