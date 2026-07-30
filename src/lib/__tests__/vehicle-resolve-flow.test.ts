import { beforeEach, describe, expect, it } from 'vitest';
import {
  DictionaryStorage,
  SettingsStorage,
  TicketAuditStorage,
  TicketStorage,
  VehicleDriversStorage,
  DEFAULT_APP_SETTINGS,
  onTicketCompletedLearning,
  updateVehiclePreferencesFromTrip,
} from '../storage';
import { normalizeVehicleKey } from '../vehicle-plate';
import { formatVehicleBrand } from '../text-format';
import { normalizeScaleDeviceId } from '../scales';
import {
  resolvePlateSource,
  resolveTripFields,
  driverDatalistOptions,
} from '../vehicle-resolve';
import {
  resolveTareAutofill,
  shouldAutofillTare,
  WEIGHT_SOURCE_LABELS,
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
    vehicle_brand: 'КамАЗ',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'ТКО',
    shipper_name: 'ООО Ромашка',
    receiver_name: 'Полигон',
    carrier_name: 'Перевозчик',
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
    gross_datetime: '2026-07-01T10:00:00.000Z',
    tare_datetime: '2026-07-01T10:00:00.000Z',
    scale_device: 'Микросим М0601',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed',
    completed_at: '2026-07-01T10:01:00.000Z',
    notes: '',
    weighing_mode: 'single',
    ...overrides,
  };
}

describe('vehicle-resolve flow (no-mock storage)', () => {
  it('TC-E2E-01: frequent vehicle → patch fields + dictionary tare', () => {
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
      vehicle_brand: 'КамАЗ',
      default_tare_weight: 8500,
      preferred_cargo_name: 'ТКО',
      preferred_shipper_name: 'ООО Ромашка',
      preferred_driver_name: 'Запасной',
    });
    const key = normalizeVehicleKey('А001АА56');
    VehicleDriversStorage.recordUsage(key, 'Иванов И.И.', '2026-07-01T09:00:00.000Z');

    const patch = resolveTripFields({
      key,
      vehicles: DictionaryStorage.getTable('vehicles'),
      tickets: TicketStorage.getAll(),
      driversHistory: VehicleDriversStorage.getByVehicleKey(key),
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(patch.vehicle_brand).toBe(formatVehicleBrand('КамАЗ'));
    expect(patch.driver_name).toBe('Иванов И.И.');
    expect(patch.cargo_name).toBe('ТКО');
    expect(patch.shipper_name).toBe('ООО Ромашка');

    const vehicle = DictionaryStorage.getTable('vehicles')[0];
    const tare = resolveTareAutofill({
      allowed: shouldAutofillTare({ mode: 'single', completing: false }),
      locked: false,
      vehicleNumber: 'А001АА56',
      tareWeight: null,
      defaultTareWeight: vehicle.default_tare_weight,
      taraDefault: SettingsStorage.getAppSettings().tara_default,
    });
    expect(tare).toEqual({ tareWeight: 8500, tareSource: 'dictionary' });
  });

  it('TC-E2E-02: history=0 fallthrough preferred / last completed', () => {
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
      preferred_driver_name: 'Петров П.П.',
    });
    TicketStorage.create(
      baseTicket({
        driver_name: 'Сидоров С.С.',
        completed_at: '2026-06-01T10:00:00.000Z',
      }),
    );
    const key = normalizeVehicleKey('А001АА56');
    const withPreferred = resolveTripFields({
      key,
      vehicles: DictionaryStorage.getTable('vehicles'),
      tickets: TicketStorage.getAll(),
      driversHistory: [],
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(withPreferred.driver_name).toBe('Петров П.П.');
  });

  it('TC-E2E-03: history>1 → driver not autofilled', () => {
    const key = normalizeVehicleKey('А001АА56');
    VehicleDriversStorage.recordUsage(key, 'Иванов И.И.', '2026-07-01T09:00:00.000Z');
    VehicleDriversStorage.recordUsage(key, 'Петров П.П.', '2026-07-02T09:00:00.000Z');
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
      preferred_driver_name: 'Запасной',
    });
    const patch = resolveTripFields({
      key,
      vehicles: DictionaryStorage.getTable('vehicles'),
      tickets: [],
      driversHistory: VehicleDriversStorage.getByVehicleKey(key),
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(patch.driver_name).toBeUndefined();
  });

  it('TC-E2E-04: complete learns history+preferred; open dual does not', () => {
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
      vehicle_brand: 'КамАЗ',
      default_tare_weight: 8000,
    });
    const open = TicketStorage.create(
      baseTicket({
        status: 'open',
        completed_at: null,
        weighing_mode: 'dual',
        tare_weight: null,
        net_weight: null,
        total_amount: null,
      }),
    );
    expect(VehicleDriversStorage.getAll()).toHaveLength(0);

    const completed = TicketStorage.create(
      baseTicket({
        plate_source: 'directory',
        scale_role: null,
        photo_entry_path: null,
        photo_exit_path: null,
      }),
    );
    onTicketCompletedLearning(completed);
    const key = normalizeVehicleKey('А001АА56');
    expect(VehicleDriversStorage.getByVehicleKey(key)[0]?.use_count).toBe(1);
    const card = DictionaryStorage.getTable('vehicles')[0];
    expect(card.preferred_driver_name).toBeTruthy();
    expect(card.default_tare_weight).toBe(8000);
    expect(card.vehicle_brand).toBe(formatVehicleBrand('КамАЗ'));
    expect(open.status).toBe('open');
  });

  it('TC-E2E-05: plate_source directory↔operator on save relative to directory', () => {
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
    });
    const vehicles = DictionaryStorage.getTable('vehicles');
    expect(resolvePlateSource(normalizeVehicleKey('А001АА56'), vehicles)).toBe('directory');
    expect(resolvePlateSource(normalizeVehicleKey('Х999ХХ99'), vehicles)).toBe('operator');

    const created = TicketStorage.create(
      baseTicket({
        plate_source: resolvePlateSource(normalizeVehicleKey('А001АА56'), vehicles),
        scale_role: null,
        photo_entry_path: null,
        photo_exit_path: null,
      }),
    );
    expect(TicketStorage.getById(created.id)?.plate_source).toBe('directory');

    const updated = TicketStorage.update(created.id, {
      vehicle_number: 'Х999ХХ99',
      plate_source: resolvePlateSource(normalizeVehicleKey('Х999ХХ99'), vehicles),
    });
    expect(updated?.plate_source).toBe('operator');
  });

  it('TC-E2E-06: settings defaults and invalid scale_device_id', () => {
    expect(SettingsStorage.getAppSettings().driver_input_mode).toBe('vehicle');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe(
      DEFAULT_APP_SETTINGS.scale_device_id,
    );
    SettingsStorage.updateAppSettings({ scale_device_id: 'nope' as never });
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('microsim-m0601');
    expect(normalizeScaleDeviceId('newton')).toBe('newton');
    SettingsStorage.updateAppSettings({ driver_input_mode: 'free' });
    expect(SettingsStorage.getAppSettings().driver_input_mode).toBe('free');
    expect(
      driverDatalistOptions({
        mode: 'free',
        history: [],
        allDrivers: [{ name: 'X' }],
      }),
    ).toEqual([]);
  });

  it('TC-E2E-07: non-empty fields are not overwritten by patch', () => {
    DictionaryStorage.add('vehicles', {
      name: 'А001АА56',
      vehicle_number: 'А001АА56',
      notes: '',
      vehicle_brand: 'КамАЗ',
      preferred_cargo_name: 'ТКО',
    });
    const key = normalizeVehicleKey('А001АА56');
    const patch = resolveTripFields({
      key,
      vehicles: DictionaryStorage.getTable('vehicles'),
      tickets: [],
      driversHistory: [],
      current: {
        vehicle_brand: 'Уже введено',
        driver_name: '',
        cargo_name: 'Уже груз',
        shipper_name: '',
      },
    });
    expect(patch.vehicle_brand).toBeUndefined();
    expect(patch.cargo_name).toBeUndefined();
    expect(patch.shipper_name).toBeUndefined();
  });

  it('CSV/card weight source labels match WEIGHT_SOURCE_LABELS', () => {
    const label = (raw: string | null | undefined) =>
      WEIGHT_SOURCE_LABELS[normalizeWeightSource(raw)];
    expect(label('dictionary')).toBe(WEIGHT_SOURCE_LABELS.dictionary);
    expect(label('default')).toBe(WEIGHT_SOURCE_LABELS.default);
    expect(label('instrument')).toBe(WEIGHT_SOURCE_LABELS.instrument);
    expect(label('manual')).toBe(WEIGHT_SOURCE_LABELS.manual);
    expect(label('unknown')).toBe(WEIGHT_SOURCE_LABELS.manual);
  });

  it('updateVehiclePreferencesFromTrip without card is safe', () => {
    expect(
      updateVehiclePreferencesFromTrip(normalizeVehicleKey('Х999ХХ99'), {
        preferred_driver_name: 'X',
      }),
    ).toBeNull();
  });
});
