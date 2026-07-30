import { beforeEach, describe, expect, it } from 'vitest';
import {
  TicketStorage,
  TicketAuditStorage,
  SettingsStorage,
  type WeighingTicket,
} from '../storage';
import { buildReoPayload, validateReoTicket } from '../reo';

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

function legacyCompletedWithoutMode(): WeighingTicket {
  const raw = {
    id: 'imp-1',
    ticket_number: 10,
    vehicle_number: 'А001АА56',
    vehicle_brand: 'КАМАЗ',
    trailer_number: '',
    driver_name: 'Иванов',
    cargo_name: 'Грунт',
    shipper_name: 'А',
    receiver_name: 'Б',
    carrier_name: 'В',
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
    reo_status: 'pending' as const,
    reo_sent_at: null,
    notes: '',
    created_at: '2026-01-01T10:00:00',
    completed_at: '2026-01-01T10:05:00',
  };
  localStorage.setItem('app_weighing_tickets', JSON.stringify([raw]));
  const ticket = TicketStorage.getById('imp-1');
  if (!ticket) throw new Error('ticket missing');
  return ticket;
}

describe('weighing regressions: journal / REO / import normalize', () => {
  it('imported completed without weighing_mode normalizes to single', () => {
    const ticket = legacyCompletedWithoutMode();
    expect(ticket.weighing_mode).toBe('single');
    expect(ticket.version).toBe(1);
  });

  it('buildReoPayload works without requiring weighing_mode fields', () => {
    SettingsStorage.updateAppSettings({
      reo_enabled: true,
      reo_object_id: 'obj',
      reo_access_key: 'key',
      reo_cargo_names: ['Грунт'],
    });
    const ticket = legacyCompletedWithoutMode();
    const payload = buildReoPayload([ticket]);
    expect(payload.weightControls).toHaveLength(1);
    expect(payload.weightControls[0].registrationNumber).toBe('А001АА56');
    expect(payload.weightControls[0].garbageWeight).toBe('15000');
  });

  it('open dual is not REO-eligible; print gate is completed-only', () => {
    SettingsStorage.updateAppSettings({
      reo_enabled: true,
      reo_object_id: 'obj',
      reo_access_key: 'key',
      reo_object_url: 'https://example.test/reo',
      reo_cargo_names: ['Грунт'],
    });
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
    expect(validateReoTicket(open)).toBe('Можно отправлять только завершённые записи');
    expect(open.status !== 'completed').toBe(true);
  });

  it('markReoSent increments version on completed without mode column in source', () => {
    const ticket = legacyCompletedWithoutMode();
    expect(ticket.version).toBe(1);
    const sent = TicketStorage.markReoSent(ticket.id);
    expect(sent?.reo_status).toBe('sent');
    expect(sent?.version).toBe(2);
    expect(sent?.weighing_mode).toBe('single');
  });

  it('journal filter by status still works after normalize', () => {
    legacyCompletedWithoutMode();
    TicketStorage.create({
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
    const all = TicketStorage.getAll();
    expect(all.filter((t) => t.status === 'completed')).toHaveLength(1);
    expect(all.filter((t) => t.status === 'open')).toHaveLength(1);
  });
});
