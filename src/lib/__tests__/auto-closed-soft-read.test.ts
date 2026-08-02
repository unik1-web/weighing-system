import { beforeEach, describe, expect, it } from 'vitest';
import { softReadBool, TicketStorage } from '../storage';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
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
    },
    configurable: true,
  });
}

installLocalStorage();

describe('auto_closed soft-read', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('softReadBool treats missing as false', () => {
    expect(softReadBool(undefined)).toBe(false);
    expect(softReadBool(null)).toBe(false);
    expect(softReadBool(0)).toBe(false);
    expect(softReadBool(1)).toBe(true);
    expect(softReadBool('true')).toBe(true);
  });

  it('normalizes missing auto_closed on load', () => {
    localStorage.setItem(
      'app_weighing_tickets',
      JSON.stringify([
        {
          id: 't1',
          ticket_number: 1,
          vehicle_number: 'A',
          vehicle_brand: '',
          trailer_number: '',
          driver_name: 'D',
          cargo_name: 'C',
          shipper_name: 'S',
          receiver_name: 'R',
          carrier_name: 'K',
          price: 0,
          vat_rate: 0,
          gross_weight: 1000,
          tare_weight: 500,
          net_weight: 500,
          total_amount: 0,
          gross_source: 'manual',
          tare_source: 'manual',
          gross_raw: null,
          tare_raw: null,
          gross_datetime: null,
          tare_datetime: null,
          scale_device: '',
          operator_id: null,
          operator_name: 'Op',
          status: 'completed',
          reo_status: 'pending',
          reo_sent_at: null,
          notes: '',
          created_at: '2026-01-01T00:00:00',
          completed_at: '2026-01-01T00:00:00',
        },
      ]),
    );
    const ticket = TicketStorage.getById('t1');
    expect(ticket?.auto_closed).toBe(false);
  });
});
