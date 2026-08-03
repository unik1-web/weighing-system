import { describe, expect, it, beforeEach } from 'vitest';
import {
  TicketAuditStorage,
  TicketRevisionStorage,
  TicketStorage,
  initializeStorage,
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

describe('TicketStorage revisions', () => {
  beforeEach(() => {
    localStorage.clear();
    initializeStorage();
    TicketAuditStorage.ensureInitialized();
    TicketRevisionStorage.ensureInitialized();
  });

  it('writes updated + revisions on significant field change', () => {
    const ticket = TicketStorage.create({
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
      gross_source: 'manual',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: null,
      tare_datetime: null,
      scale_device: '',
      operator_id: 'op1',
      operator_name: 'Оператор',
      status: 'completed',
      notes: '',
      completed_at: new Date().toISOString(),
      weighing_mode: 'single',
    });

    const updated = TicketStorage.update(ticket.id, { notes: 'правка' });
    expect(updated?.notes).toBe('правка');

    const revisions = TicketRevisionStorage.getByTicketId(ticket.id);
    expect(revisions.some((r) => r.field === 'notes' && r.new_value === 'правка')).toBe(true);
    const actions = TicketAuditStorage.getByTicketId(ticket.id).map((e) => e.action);
    expect(actions).toContain('updated');
  });

  it('skips audit on no-op update', () => {
    const ticket = TicketStorage.create({
      vehicle_number: 'А002АА56',
      vehicle_brand: '',
      trailer_number: '',
      driver_name: 'Сидоров',
      cargo_name: 'Песок',
      shipper_name: '',
      receiver_name: '',
      carrier_name: '',
      price: 0,
      vat_rate: 0,
      gross_weight: null,
      tare_weight: null,
      net_weight: null,
      total_amount: null,
      gross_source: 'manual',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: null,
      tare_datetime: null,
      scale_device: '',
      operator_id: 'op1',
      operator_name: 'Оператор',
      status: 'open',
      notes: '',
      completed_at: null,
      weighing_mode: 'dual',
    });

    const beforeAudit = TicketAuditStorage.getByTicketId(ticket.id).length;
    const beforeRev = TicketRevisionStorage.getByTicketId(ticket.id).length;
    TicketStorage.update(ticket.id, { notes: '' });
    expect(TicketAuditStorage.getByTicketId(ticket.id)).toHaveLength(beforeAudit);
    expect(TicketRevisionStorage.getByTicketId(ticket.id)).toHaveLength(beforeRev);
  });

  it('uses completed action (not updated) when finishing open ticket', () => {
    const ticket = TicketStorage.create({
      vehicle_number: 'А003АА56',
      vehicle_brand: '',
      trailer_number: '',
      driver_name: 'Козлов',
      cargo_name: 'Щебень',
      shipper_name: '',
      receiver_name: '',
      carrier_name: '',
      price: 100,
      vat_rate: 20,
      gross_weight: 12000,
      tare_weight: null,
      net_weight: null,
      total_amount: null,
      gross_source: 'instrument',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: new Date().toISOString(),
      tare_datetime: null,
      scale_device: '',
      operator_id: 'op1',
      operator_name: 'Оператор',
      status: 'open',
      notes: '',
      completed_at: null,
      weighing_mode: 'dual',
    });

    TicketStorage.update(ticket.id, {
      tare_weight: 4000,
      net_weight: 8000,
      status: 'completed',
      completed_at: new Date().toISOString(),
      total_amount: 800,
    });

    const actions = TicketAuditStorage.getByTicketId(ticket.id).map((e) => e.action);
    expect(actions).toContain('completed');
    expect(actions).not.toContain('updated');
    expect(TicketRevisionStorage.getByTicketId(ticket.id).length).toBeGreaterThan(0);
  });
});
