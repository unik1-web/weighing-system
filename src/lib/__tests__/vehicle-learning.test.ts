import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyVehicleLearningOnComplete } from '../vehicle-learning';
import {
  DictionaryStorage,
  VehicleDriversStorage,
  type WeighingTicket,
} from '../storage';
import { DICTIONARIES_UPDATED_EVENT } from '../storage-sync';

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

function baseTicket(overrides: Partial<WeighingTicket> = {}): WeighingTicket {
  return {
    id: 't1',
    ticket_number: 1,
    version: 1,
    vehicle_number: 'а001аа56',
    vehicle_brand: 'камаз',
    trailer_number: '',
    driver_name: 'иванов иван',
    cargo_name: ' Песок ',
    shipper_name: 'ООО Отправитель',
    receiver_name: '',
    carrier_name: '',
    price: 0,
    vat_rate: 0,
    gross_weight: 20000,
    tare_weight: 5200,
    net_weight: 14800,
    total_amount: 0,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-01-01T10:00:00Z',
    tare_datetime: '2026-01-01T10:05:00Z',
    scale_device: '',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed',
    created_at: '2026-01-01T09:00:00Z',
    completed_at: '2026-01-01T10:05:00Z',
    notes: '',
    weighing_mode: 'single',
    reo_status: 'not_required',
    reo_sent_at: null,
    auto_closed: false,
    ...overrides,
  };
}

describe('applyVehicleLearningOnComplete', () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    dispatchEvent.mockReset();
    vi.stubGlobal('window', { dispatchEvent });
    if (!globalThis.crypto?.randomUUID) {
      let n = 0;
      vi.stubGlobal('crypto', {
        randomUUID: () => `uuid-${++n}`,
      });
    }
  });

  it('ignores non-completed tickets and empty plates', () => {
    applyVehicleLearningOnComplete(baseTicket({ status: 'open' }));
    applyVehicleLearningOnComplete(baseTicket({ vehicle_number: '   ' }));
    expect(VehicleDriversStorage.getAll()).toEqual([]);
    expect(DictionaryStorage.getTable('vehicles')).toEqual([]);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('creates vehicle card + driver link and dispatches dictionaries-updated', () => {
    DictionaryStorage.add('drivers', { name: 'Иванов Иван', notes: '' });

    applyVehicleLearningOnComplete(baseTicket());

    const links = VehicleDriversStorage.getByVehicle('А001АА56');
    expect(links).toHaveLength(1);
    expect(links[0].driver_name).toBe('Иванов Иван');
    expect(links[0].use_count).toBe(1);
    expect(links[0].driver_id).toBeTruthy();

    const vehicles = DictionaryStorage.getTable('vehicles');
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].vehicle_number).toBe('А001АА56');
    expect(vehicles[0].vehicle_brand).toBe('Камаз');
    expect(vehicles[0].preferred_driver_name).toBe('Иванов Иван');
    expect(vehicles[0].preferred_cargo_name).toBe('Песок');
    expect(vehicles[0].preferred_shipper_name).toBe('ООО Отправитель');
    expect(vehicles[0].default_tare_weight).toBe(5200);

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: DICTIONARIES_UPDATED_EVENT }),
    );
  });

  it('updates existing vehicle prefs and increments driver use_count', () => {
    const existing = DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      notes: '',
      vehicle_number: 'А001АА56',
      vehicle_brand: 'Старый',
      preferred_driver_name: 'Старый водитель',
      preferred_cargo_name: 'Старый груз',
      preferred_shipper_name: 'Старый отправитель',
      default_tare_weight: 1000,
    });

    applyVehicleLearningOnComplete(baseTicket());
    applyVehicleLearningOnComplete(
      baseTicket({
        id: 't2',
        completed_at: '2026-01-02T10:05:00Z',
        cargo_name: 'Щебень',
        tare_weight: 5300,
      }),
    );

    const vehicles = DictionaryStorage.getTable('vehicles');
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe(existing.id);
    expect(vehicles[0].preferred_cargo_name).toBe('Щебень');
    expect(vehicles[0].default_tare_weight).toBe(5300);

    const links = VehicleDriversStorage.getByVehicle('А001АА56');
    expect(links).toHaveLength(1);
    expect(links[0].use_count).toBe(2);
    expect(links[0].last_used_at).toBe('2026-01-02T10:05:00Z');
  });

  it('skips driver link when driver_name empty but still learns cargo/tare', () => {
    applyVehicleLearningOnComplete(
      baseTicket({
        driver_name: '',
        cargo_name: 'Грунт',
        shipper_name: '',
      }),
    );

    expect(VehicleDriversStorage.getAll()).toEqual([]);
    const vehicles = DictionaryStorage.getTable('vehicles');
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].preferred_driver_name).toBeNull();
    expect(vehicles[0].preferred_cargo_name).toBe('Грунт');
    expect(vehicles[0].preferred_shipper_name).toBeNull();
  });
});
