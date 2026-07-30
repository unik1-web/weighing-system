import { beforeEach, describe, expect, it } from 'vitest';
import {
  DictionaryStorage,
  SettingsStorage,
  TicketAuditStorage,
  TicketStorage,
  VehicleDriversStorage,
  normalizeDriverInputMode,
  onTicketCompletedLearning,
  updateVehiclePreferencesFromTrip,
  DEFAULT_APP_SETTINGS,
} from '../storage';
import { normalizeScaleDeviceId } from '../scales';
import { normalizeVehicleKey } from '../vehicle-plate';
import { formatPersonName, formatVehicleBrand } from '../text-format';

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

describe('VehicleDriversStorage / preferences / settings', () => {
  it('TC-E2E-01: recordUsage twice increments use_count', () => {
    const key = normalizeVehicleKey('А001АА56');
    const first = VehicleDriversStorage.recordUsage(key, 'иванов и.и.', '2026-07-01T10:00:00.000Z');
    expect(first?.use_count).toBe(1);
    const second = VehicleDriversStorage.recordUsage(key, 'Иванов И.И.', '2026-07-02T10:00:00.000Z');
    expect(second?.use_count).toBe(2);
    expect(second?.last_used_at).toBe('2026-07-02T10:00:00.000Z');
    expect(VehicleDriversStorage.getByVehicleKey(key)).toHaveLength(1);
  });

  it('TC-E2E-02: updateVehiclePreferencesFromTrip writes preferred when card exists', () => {
    const card = DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
      vehicle_brand: 'КамАЗ',
      default_tare_weight: 8500,
    });
    const key = normalizeVehicleKey('А001АА56');
    updateVehiclePreferencesFromTrip(key, {
      preferred_driver_name: 'Петров П.П.',
      preferred_cargo_name: 'ТКО',
      preferred_shipper_name: 'ООО Ромашка',
    });
    const updated = DictionaryStorage.getTable('vehicles').find((v) => v.id === card.id);
    expect(updated?.preferred_driver_name).toBe(formatPersonName('Петров П.П.'));
    expect(updated?.preferred_cargo_name).toBe('ТКО');
    expect(updated?.preferred_shipper_name).toBe('ООО Ромашка');
    expect(updated?.vehicle_brand).toBe(formatVehicleBrand('КамАЗ'));
    expect(updated?.default_tare_weight).toBe(8500);

    expect(
      updateVehiclePreferencesFromTrip(normalizeVehicleKey('Х999ХХ99'), {
        preferred_driver_name: 'X',
      }),
    ).toBeNull();
  });

  it('TC-E2E-03: legacy ticket without stubs → null; update keeps plate_source', () => {
    const created = TicketStorage.create({
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
      gross_source: 'manual',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: null,
      tare_datetime: null,
      scale_device: '',
      operator_id: null,
      operator_name: 'Оператор',
      status: 'completed',
      completed_at: '2026-07-01T10:01:00.000Z',
      notes: '',
      weighing_mode: 'single',
    });
    const loaded = TicketStorage.getById(created.id);
    expect(loaded?.plate_source).toBeNull();
    expect(loaded?.scale_role).toBeNull();
    expect(loaded?.photo_entry_path).toBeNull();
    expect(loaded?.photo_exit_path).toBeNull();

    const updated = TicketStorage.update(created.id, { plate_source: 'operator' });
    expect(updated?.plate_source).toBe('operator');
  });

  it('TC-UNIT-01: empty driver/number → recordUsage no-op', () => {
    expect(VehicleDriversStorage.recordUsage('', 'Иванов', '2026-07-01T10:00:00.000Z')).toBeNull();
    expect(
      VehicleDriversStorage.recordUsage(normalizeVehicleKey('А001АА56'), '  ', '2026-07-01T10:00:00.000Z'),
    ).toBeNull();
    expect(VehicleDriversStorage.getAll()).toHaveLength(0);
  });

  it('TC-UNIT-02: normalizeScaleDeviceId unknown → default', () => {
    expect(normalizeScaleDeviceId('nope')).toBe('microsim-m0601');
    expect(normalizeScaleDeviceId('cas')).toBe('cas');
  });

  it('TC-UNIT-03: unknown driver_input_mode → vehicle', () => {
    expect(normalizeDriverInputMode('weird')).toBe('vehicle');
    expect(DEFAULT_APP_SETTINGS.driver_input_mode).toBe('vehicle');
    expect(DEFAULT_APP_SETTINGS.scale_device_id).toBe('microsim-m0601');
    SettingsStorage.updateAppSettings({ driver_input_mode: 'all' as never });
    expect(SettingsStorage.getAppSettings().driver_input_mode).toBe('all');
  });

  it('onTicketCompletedLearning upserts history and preferred', () => {
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
    });
    onTicketCompletedLearning({
      vehicle_number: 'А001АА56',
      driver_name: 'Иванов И.И.',
      cargo_name: 'ТКО',
      shipper_name: 'ООО',
      completed_at: '2026-07-01T12:00:00.000Z',
    });
    const key = normalizeVehicleKey('А001АА56');
    expect(VehicleDriversStorage.getByVehicleKey(key)[0]?.use_count).toBe(1);
    const card = DictionaryStorage.getTable('vehicles')[0];
    expect(card.preferred_driver_name).toBe(formatPersonName('Иванов И.И.'));
    expect(card.preferred_cargo_name).toBe('ТКО');
  });
});
