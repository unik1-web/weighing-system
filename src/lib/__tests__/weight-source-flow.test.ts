import { beforeEach, describe, expect, it } from 'vitest';
import { TicketStorage, TicketAuditStorage } from '../storage';
import {
  resolveTareAutofill,
  ticketMatchesWeightSource,
  summarizeWeightSources,
  shouldAutofillTare,
  normalizeWeightSource,
} from '../weighing-mode';

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

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
});

function baseTicket(
  overrides: Partial<Parameters<typeof TicketStorage.create>[0]> = {},
): Parameters<typeof TicketStorage.create>[0] {
  return {
    vehicle_number: 'А001АА56',
    vehicle_brand: '',
    trailer_number: '',
    driver_name: 'Иванов',
    cargo_name: 'Грунт',
    shipper_name: 'А',
    receiver_name: 'Б',
    carrier_name: 'В',
    price: 100,
    vat_rate: 20,
    gross_weight: 20000,
    tare_weight: 8500,
    net_weight: 11500,
    total_amount: 1150,
    gross_source: 'instrument',
    tare_source: 'dictionary',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-07-01T10:00:00',
    tare_datetime: '2026-07-01T10:00:00',
    scale_device: '',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed',
    completed_at: '2026-07-01T10:01:00',
    notes: '',
    weighing_mode: 'single',
    ...overrides,
  };
}

describe('weight-source flow (no-mock TicketStorage)', () => {
  it('TC-E2E-MAIN: single completed with dictionary tare round-trips', () => {
    // Simulates WeighingForm single + autofill from vehicle card → save
    const created = TicketStorage.create(
      baseTicket({
        gross_source: 'instrument',
        tare_source: 'dictionary',
        tare_weight: 8500,
      }),
    );
    const loaded = TicketStorage.getById(created.id);
    expect(loaded?.gross_source).toBe('instrument');
    expect(loaded?.tare_source).toBe('dictionary');
    expect(TicketStorage.getAll().find((t) => t.id === created.id)?.tare_source).toBe('dictionary');
  });

  it('TC-E2E-DEFAULT: tare_source default round-trips', () => {
    const created = TicketStorage.create(
      baseTicket({
        tare_source: 'default',
        tare_weight: 2500,
        net_weight: 17500,
      }),
    );
    expect(TicketStorage.getById(created.id)?.tare_source).toBe('default');
  });

  it('TC-E2E-AUTOFILL: resolveTareAutofill → TicketStorage.create payload', () => {
    const fromCard = resolveTareAutofill({
      allowed: shouldAutofillTare({ mode: 'single', completing: false }),
      locked: false,
      vehicleNumber: 'А001АА56',
      tareWeight: null,
      defaultTareWeight: 8500,
      taraDefault: 2500,
    });
    expect(fromCard).toEqual({ tareWeight: 8500, tareSource: 'dictionary' });

    const saved = TicketStorage.create(
      baseTicket({
        tare_weight: fromCard!.tareWeight,
        tare_source: fromCard!.tareSource,
        gross_source: 'instrument',
      }),
    );
    expect(saved.tare_source).toBe('dictionary');
    expect(saved.gross_source).not.toBe('dictionary');
    expect(saved.gross_source).not.toBe('default');

    const fromDefault = resolveTareAutofill({
      allowed: true,
      locked: false,
      vehicleNumber: 'А002АА56',
      tareWeight: null,
      defaultTareWeight: null,
      taraDefault: 2500,
    });
    expect(fromDefault?.tareSource).toBe('default');

    expect(
      resolveTareAutofill({
        allowed: true,
        locked: true,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: 8500,
        taraDefault: 2500,
      }),
    ).toBeNull();

    expect(
      resolveTareAutofill({
        allowed: shouldAutofillTare({ mode: 'dual', completing: false }),
        locked: false,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: 8500,
        taraDefault: 2500,
      }),
    ).toBeNull();
  });

  it('TC-E2E-FILTER / JRN: OR filter + all + unknown→manual', () => {
    TicketStorage.create(baseTicket({ tare_source: 'dictionary', gross_source: 'instrument' }));
    TicketStorage.create(
      baseTicket({
        vehicle_number: 'А002АА56',
        tare_source: 'manual',
        gross_source: 'manual',
      }),
    );
    TicketStorage.create(
      baseTicket({
        vehicle_number: 'А003АА56',
        tare_source: 'instrument',
        gross_source: 'manual',
      }),
    );
    // unknown raw source is normalized on read
    TicketStorage.create(
      baseTicket({
        vehicle_number: 'А004АА56',
        // cast: simulate legacy/corrupt value before normalizeTicket
        gross_source: 'broken' as 'manual',
        tare_source: 'instrument',
      }),
    );

    const all = TicketStorage.getAll();
    const byDictionary = all.filter((t) => ticketMatchesWeightSource(t, 'dictionary'));
    expect(byDictionary).toHaveLength(1);
    expect(byDictionary[0].tare_source).toBe('dictionary');

    const byInstrument = all.filter((t) => ticketMatchesWeightSource(t, 'instrument'));
    expect(byInstrument.length).toBeGreaterThanOrEqual(2);

    expect(all.filter((t) => ticketMatchesWeightSource(t, 'all'))).toHaveLength(all.length);

    const broken = all.find((t) => t.vehicle_number === 'А004АА56');
    expect(broken?.gross_source).toBe('manual');
    expect(ticketMatchesWeightSource(broken!, 'manual')).toBe(true);
  });

  it('TC-E2E-SUMMARY / RPT: summarizeWeightSources non-zero counts', () => {
    TicketStorage.create(baseTicket({ gross_source: 'instrument', tare_source: 'dictionary' }));
    TicketStorage.create(
      baseTicket({
        vehicle_number: 'А002АА56',
        gross_source: 'manual',
        tare_source: 'default',
      }),
    );
    const summary = summarizeWeightSources(TicketStorage.getAll());
    expect(summary.gross.instrument).toBe(1);
    expect(summary.gross.manual).toBe(1);
    expect(summary.tare.dictionary).toBe(1);
    expect(summary.tare.default).toBe(1);
  });

  it('TC-E2E-LEGACY: manual/instrument read and filter', () => {
    TicketStorage.create(
      baseTicket({
        gross_source: 'manual',
        tare_source: 'instrument',
        weighing_mode: 'dual',
        status: 'open',
        completed_at: null,
        tare_weight: null,
        net_weight: null,
        total_amount: null,
      }),
    );
    const ticket = TicketStorage.getAll()[0];
    expect(ticket.gross_source).toBe('manual');
    expect(ticket.tare_source).toBe('instrument');
    expect(ticketMatchesWeightSource(ticket, 'manual')).toBe(true);
    expect(ticketMatchesWeightSource(ticket, 'instrument')).toBe(true);
    expect(normalizeWeightSource(ticket.gross_source)).toBe('manual');
  });

  it('TC-E2E-06: happy-path gross is only instrument|manual', () => {
    const created = TicketStorage.create(
      baseTicket({ gross_source: 'instrument', tare_source: 'dictionary' }),
    );
    expect(['instrument', 'manual']).toContain(created.gross_source);
  });
});
