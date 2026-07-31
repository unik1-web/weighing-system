import { beforeEach, describe, expect, it } from 'vitest';

import { TicketStorage } from '../storage';

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

function baseTicket() {
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
  };
}

describe('active-year ticket numbering', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('TC-E2E-01: first ticket of active year starts with number 1', () => {
    localStorage.setItem(
      'app_settings',
      JSON.stringify({
        active_year: '2026',
      }),
    );
    localStorage.setItem(
      'app_weighing_tickets',
      JSON.stringify([
        {
          id: 'old-1',
          ticket_number: 9,
          created_at: '2025-12-30T10:00:00',
          year: 2025,
          ...baseTicket(),
        },
      ]),
    );

    const created = TicketStorage.create(baseTicket());
    expect(created.ticket_number).toBe(1);
    expect(created.year).toBe(2026);
  });

  it('keeps journal scoped to active year', () => {
    localStorage.setItem(
      'app_settings',
      JSON.stringify({
        active_year: '2026',
      }),
    );
    localStorage.setItem(
      'app_weighing_tickets',
      JSON.stringify([
        {
          id: 'y2025',
          ticket_number: 1,
          created_at: '2025-02-01T10:00:00',
          year: 2025,
          ...baseTicket(),
        },
        {
          id: 'y2026',
          ticket_number: 1,
          created_at: '2026-02-01T10:00:00',
          year: 2026,
          ...baseTicket(),
        },
      ]),
    );

    const tickets = TicketStorage.getAll();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].id).toBe('y2026');
  });
});
