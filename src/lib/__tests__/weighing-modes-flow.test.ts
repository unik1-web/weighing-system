import { beforeEach, describe, expect, it } from 'vitest';
import {
  TicketStorage,
  TicketAuditStorage,
  SettingsStorage,
} from '../storage';
import { filterIncompleteDual, netWeight, totalAmount } from '../weighing-mode';

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

describe('TC-E2E-MAIN: dual two-pass (no-mock TicketStorage)', () => {
  it('settings → dual open → complete → audit/version/filter', () => {
    SettingsStorage.updateAppSettings({
      weighing_mode_default: 'dual',
      tara_threshold: 15000,
      max_time_between: 24,
      tara_default: 0,
      stable_mode: false,
    });
    expect(SettingsStorage.getAppSettings().weighing_mode_default).toBe('dual');

    const open = TicketStorage.create({
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
      tare_weight: null,
      net_weight: null,
      total_amount: null,
      gross_source: 'manual',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: '2026-01-01T10:00:00',
      tare_datetime: null,
      scale_device: '',
      operator_id: null,
      operator_name: 'Оператор',
      status: 'open',
      completed_at: null,
      notes: '',
      weighing_mode: 'dual',
    });

    expect(open.status).toBe('open');
    expect(open.weighing_mode).toBe('dual');
    expect(open.version).toBe(1);
    expect(filterIncompleteDual(TicketStorage.getAll()).map((t) => t.id)).toEqual([open.id]);
    expect(TicketAuditStorage.getByTicketId(open.id).map((e) => e.action)).toEqual(['created']);

    const net = netWeight(20000, 5000);
    const amount = totalAmount(net, 100);
    const completed = TicketStorage.update(
      open.id,
      {
        tare_weight: 5000,
        tare_datetime: '2026-01-01T11:00:00',
        net_weight: net,
        total_amount: amount,
        status: 'completed',
        completed_at: '2026-01-01T11:00:00',
      },
      { expectedVersion: 1 },
    );

    expect(completed).not.toBeNull();
    expect(completed!.status).toBe('completed');
    expect(completed!.weighing_mode).toBe('dual');
    expect(completed!.version).toBe(2);
    expect(completed!.net_weight).toBe(15000);
    expect(filterIncompleteDual(TicketStorage.getAll())).toEqual([]);
    expect(TicketAuditStorage.getByTicketId(open.id).map((e) => e.action).sort()).toEqual([
      'completed',
      'created',
    ]);
  });

  it('CAS fail leaves open ticket and incomplete list unchanged', () => {
    const open = TicketStorage.create({
      vehicle_number: 'Б002ББ56',
      vehicle_brand: '',
      trailer_number: '',
      driver_name: 'Петров',
      cargo_name: 'Песок',
      shipper_name: 'А',
      receiver_name: 'Б',
      carrier_name: 'В',
      price: 50,
      vat_rate: 20,
      gross_weight: 18000,
      tare_weight: null,
      net_weight: null,
      total_amount: null,
      gross_source: 'manual',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: '2026-01-01T10:00:00',
      tare_datetime: null,
      scale_device: '',
      operator_id: null,
      operator_name: 'Оператор',
      status: 'open',
      completed_at: null,
      notes: '',
      weighing_mode: 'dual',
    });

    const conflict = TicketStorage.update(
      open.id,
      { status: 'completed', tare_weight: 4000, net_weight: 14000, total_amount: 700, completed_at: '2026-01-01T12:00:00' },
      { expectedVersion: 99 },
    );
    expect(conflict).toBeNull();
    expect(TicketStorage.getById(open.id)?.status).toBe('open');
    expect(filterIncompleteDual(TicketStorage.getAll()).map((t) => t.id)).toEqual([open.id]);
  });
});
