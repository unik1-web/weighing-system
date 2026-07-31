import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketStorage,
  TicketAuditStorage,
  SettingsStorage,
  DEFAULT_APP_SETTINGS,
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

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
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
    vat_rate: 20,
    gross_weight: 20000,
    tare_weight: 5000,
    net_weight: 15000,
    total_amount: 1500,
    gross_source: 'manual' as const,
    tare_source: 'manual' as const,
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-01-01T10:00:00',
    tare_datetime: '2026-01-01T10:05:00',
    scale_device: '',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed' as const,
    completed_at: '2026-01-01T10:05:00',
    notes: '',
    ...overrides,
  };
}

describe('SettingsStorage weighing defaults', () => {
  it('returns defaults for new weighing keys', () => {
    const settings = SettingsStorage.getAppSettings();
    expect(settings.weighing_mode_default).toBe(DEFAULT_APP_SETTINGS.weighing_mode_default);
    expect(settings.stable_mode).toBe(false);
    expect(settings.tara_threshold).toBe(15000);
    expect(settings.max_time_between).toBe(24);
    expect(settings.tara_default).toBe(0);
    expect(settings.manual_weight_reason_policy).toBe('optional');
  });

  it('parses stable_mode and round-trips new keys', () => {
    SettingsStorage.updateAppSettings({
      weighing_mode_default: 'dual',
      stable_mode: true,
      tara_threshold: 12000,
      max_time_between: 12,
      tara_default: 2500,
      manual_weight_reason_policy: 'required',
    });
    const settings = SettingsStorage.getAppSettings();
    expect(settings.weighing_mode_default).toBe('dual');
    expect(settings.stable_mode).toBe(true);
    expect(settings.tara_threshold).toBe(12000);
    expect(settings.max_time_between).toBe(12);
    expect(settings.tara_default).toBe(2500);
    expect(settings.manual_weight_reason_policy).toBe('required');
  });
});

describe('TicketStorage normalize / create / CAS', () => {
  it('create fills weighing_mode and version; audit created+completed for single', () => {
    const ticket = TicketStorage.create(baseTicket({ weighing_mode: 'single' }));
    expect(ticket.weighing_mode).toBe('single');
    expect(ticket.version).toBe(1);
    const events = TicketAuditStorage.getByTicketId(ticket.id);
    expect(events.map((e) => e.action).sort()).toEqual(['completed', 'created']);
  });

  it('create open dual writes only created audit', () => {
    const ticket = TicketStorage.create(
      baseTicket({
        status: 'open',
        weighing_mode: 'dual',
        tare_weight: null,
        net_weight: null,
        total_amount: null,
        completed_at: null,
        tare_datetime: null,
      }),
    );
    expect(ticket.weighing_mode).toBe('dual');
    expect(ticket.status).toBe('open');
    expect(TicketAuditStorage.getByTicketId(ticket.id).map((e) => e.action)).toEqual(['created']);
  });

  it('normalize does not overwrite completed+dual', () => {
    const raw = {
      ...baseTicket({ weighing_mode: 'dual', version: 3 }),
      id: 'legacy-dual',
      ticket_number: 1,
      created_at: '2026-01-01T00:00:00',
      reo_status: 'pending' as const,
      reo_sent_at: null,
    };
    localStorage.setItem('app_weighing_tickets', JSON.stringify([raw]));
    const ticket = TicketStorage.getById('legacy-dual');
    expect(ticket?.weighing_mode).toBe('dual');
    expect(ticket?.version).toBe(3);
  });

  it('normalize fills absent mode by status', () => {
    const openRaw = {
      ...baseTicket({ status: 'open', tare_weight: null, net_weight: null, total_amount: null, completed_at: null }),
      id: 'legacy-open',
      ticket_number: 2,
      created_at: '2026-01-01T00:00:00',
      reo_status: 'pending' as const,
      reo_sent_at: null,
    };
    delete (openRaw as { weighing_mode?: string }).weighing_mode;
    delete (openRaw as { version?: number }).version;
    localStorage.setItem('app_weighing_tickets', JSON.stringify([openRaw]));
    const ticket = TicketStorage.getById('legacy-open');
    expect(ticket?.weighing_mode).toBe('dual');
    expect(ticket?.version).toBe(1);
  });

  it('update CAS: success increments version; mismatch returns null', () => {
    const ticket = TicketStorage.create(baseTicket({ weighing_mode: 'dual', status: 'open', tare_weight: null, net_weight: null, total_amount: null, completed_at: null }));
    expect(ticket.version).toBe(1);

    const ok = TicketStorage.update(
      ticket.id,
      {
        tare_weight: 5000,
        net_weight: 15000,
        total_amount: 1500,
        status: 'completed',
        completed_at: '2026-01-01T12:00:00',
      },
      { expectedVersion: 1 },
    );
    expect(ok?.version).toBe(2);
    expect(ok?.status).toBe('completed');

    const conflict = TicketStorage.update(ticket.id, { notes: 'x' }, { expectedVersion: 1 });
    expect(conflict).toBeNull();
    expect(TicketStorage.getById(ticket.id)?.notes).toBe('');
  });

  it('ignores updates.version and increments on REO without CAS', () => {
    const ticket = TicketStorage.create(baseTicket());
    const updated = TicketStorage.update(ticket.id, { version: 99, notes: 'n' } as never);
    expect(updated?.version).toBe(2);
    expect(updated?.notes).toBe('n');

    const reo = TicketStorage.markReoSent(ticket.id);
    expect(reo?.version).toBe(3);
    expect(reo?.reo_status).toBe('sent');
  });

  it('warns on version conflict', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ticket = TicketStorage.create(baseTicket({ status: 'open', weighing_mode: 'dual', tare_weight: null, net_weight: null, total_amount: null, completed_at: null }));
    TicketStorage.update(ticket.id, { notes: 'a' }, { expectedVersion: 999 });
    warn.mockRestore();
  });
});
