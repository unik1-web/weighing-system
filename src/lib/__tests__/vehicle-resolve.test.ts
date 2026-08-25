import { describe, expect, it } from 'vitest';
import {
  findLastCompletedTrip,
  normalizeDriverInputMode,
  normalizePlateSource,
  resolveDriverCandidates,
  resolveVehicle,
  type VehicleResolveContext,
} from '../vehicle-resolve';

function baseContext(
  overrides: Partial<VehicleResolveContext> = {},
): VehicleResolveContext {
  return {
    vehicles: [],
    drivers: [
      { id: 'd1', name: 'Иванов Иван' },
      { id: 'd2', name: 'Петров Пётр' },
    ],
    vehicleDrivers: [],
    completedTickets: [],
    taraDefault: 2500,
    driverInputMode: 'all',
    ...overrides,
  };
}

describe('normalizeDriverInputMode / normalizePlateSource', () => {
  it('accepts known modes and falls back to all', () => {
    expect(normalizeDriverInputMode('vehicle')).toBe('vehicle');
    expect(normalizeDriverInputMode('free')).toBe('free');
    expect(normalizeDriverInputMode('all')).toBe('all');
    expect(normalizeDriverInputMode('nope')).toBe('all');
    expect(normalizeDriverInputMode(null)).toBe('all');
    expect(normalizeDriverInputMode(1)).toBe('all');
  });

  it('accepts known plate sources and rejects unknown', () => {
    expect(normalizePlateSource('anpr')).toBe('anpr');
    expect(normalizePlateSource('operator')).toBe('operator');
    expect(normalizePlateSource('directory')).toBe('directory');
    expect(normalizePlateSource('legacy')).toBeNull();
    expect(normalizePlateSource(undefined)).toBeNull();
  });
});

describe('findLastCompletedTrip', () => {
  it('picks latest completed trip for normalized plate', () => {
    const last = findLastCompletedTrip('a001aa56', [
      {
        vehicle_number: 'А001АА56',
        status: 'completed',
        completed_at: '2026-01-01T10:00:00Z',
        created_at: '2026-01-01T09:00:00Z',
        driver_name: 'Старый',
      },
      {
        vehicle_number: 'А001АА 56',
        status: 'completed',
        completed_at: '2026-02-01T10:00:00Z',
        created_at: '2026-02-01T09:00:00Z',
        driver_name: 'Новый',
      },
      {
        vehicle_number: 'А001АА56',
        status: 'open',
        completed_at: '2026-03-01T10:00:00Z',
        created_at: '2026-03-01T09:00:00Z',
        driver_name: 'Открытый',
      },
      {
        vehicle_number: 'В999ВВ56',
        status: 'completed',
        completed_at: '2026-04-01T10:00:00Z',
        created_at: '2026-04-01T09:00:00Z',
        driver_name: 'Другой',
      },
    ]);
    expect(last?.driver_name).toBe('Новый');
  });

  it('falls back to created_at when completed_at missing', () => {
    const last = findLastCompletedTrip('А001АА56', [
      {
        vehicle_number: 'А001АА56',
        status: 'completed',
        created_at: '2026-01-15T12:00:00Z',
        driver_name: 'По created_at',
      },
      {
        vehicle_number: 'А001АА56',
        status: 'completed',
        completed_at: '2026-01-10T12:00:00Z',
        created_at: '2026-01-01T12:00:00Z',
        driver_name: 'Старее по completed',
      },
    ]);
    expect(last?.driver_name).toBe('По created_at');
  });
});

describe('resolveDriverCandidates', () => {
  const history = [
    {
      id: 'l1',
      vehicle_number: 'А001АА56',
      driver_name: 'История 1',
      last_used_at: '2026-02-01T00:00:00Z',
      use_count: 2,
    },
    {
      id: 'l2',
      vehicle_number: 'А001АА56',
      driver_name: 'История 2',
      last_used_at: '2026-01-01T00:00:00Z',
      use_count: 9,
    },
  ];
  const all = ['Иванов Иван', 'Петров Пётр'];

  it('returns empty for free mode', () => {
    expect(resolveDriverCandidates('А001АА56', 'free', history, all)).toEqual([]);
  });

  it('returns full dictionary for all mode', () => {
    expect(resolveDriverCandidates('А001АА56', 'all', history, all)).toEqual(all);
  });

  it('returns vehicle history ordered by last_used_at, else falls back to all', () => {
    expect(resolveDriverCandidates('А001АА56', 'vehicle', history, all)).toEqual([
      'История 1',
      'История 2',
    ]);
    expect(resolveDriverCandidates('В999ВВ56', 'vehicle', history, all)).toEqual(all);
  });
});

describe('resolveVehicle', () => {
  it('prefers directory card over last trip and marks plate_source directory', () => {
    const result = resolveVehicle(
      'А001АА56',
      baseContext({
        vehicles: [
          {
            id: 'v1',
            vehicle_number: 'А001АА56',
            vehicle_brand: 'КАМАЗ',
            preferred_driver_name: 'Карточный',
            preferred_cargo_name: 'Песок',
            preferred_shipper_name: 'Карточка-отправитель',
            default_tare_weight: 3200,
          },
        ],
        completedTickets: [
          {
            vehicle_number: 'А001АА56',
            status: 'completed',
            vehicle_brand: 'Урал',
            driver_name: 'С рейса',
            cargo_name: 'Грунт',
            shipper_name: 'Рейс-отправитель',
            tare_weight: 2800,
            completed_at: '2026-01-01T10:00:00Z',
            created_at: '2026-01-01T09:00:00Z',
          },
        ],
        taraDefault: 2500,
      }),
    );

    expect(result.plate_source).toBe('directory');
    expect(result.matched_vehicle_id).toBe('v1');
    expect(result.vehicle_brand).toBe('КАМАЗ');
    expect(result.driver_name).toBe('Карточный');
    expect(result.cargo_name).toBe('Песок');
    expect(result.shipper_name).toBe('Карточка-отправитель');
    expect(result.tare).toEqual({ tare_weight: 3200, tare_source: 'dictionary' });
    expect(result.driver_candidates).toEqual(['Иванов Иван', 'Петров Пётр']);
  });

  it('falls back to last completed trip and tara_default when no card', () => {
    const result = resolveVehicle(
      'а001аа56',
      baseContext({
        completedTickets: [
          {
            vehicle_number: 'А001АА56',
            status: 'completed',
            vehicle_brand: 'МАЗ',
            driver_name: 'С рейса',
            cargo_name: 'Щебень',
            shipper_name: 'ООО Рейс',
            tare_weight: null,
            completed_at: '2026-01-01T10:00:00Z',
            created_at: '2026-01-01T09:00:00Z',
          },
        ],
        taraDefault: 2500,
        driverInputMode: 'all',
      }),
    );

    expect(result.plate_source).toBe('operator');
    expect(result.matched_vehicle_id).toBeNull();
    expect(result.vehicle_brand).toBe('МАЗ');
    expect(result.driver_name).toBe('С рейса');
    expect(result.cargo_name).toBe('Щебень');
    expect(result.shipper_name).toBe('ООО Рейс');
    expect(result.tare).toEqual({ tare_weight: 2500, tare_source: 'default' });
  });

  it('auto-fills single vehicle-history driver only in vehicle mode when prefs empty', () => {
    const withSingleHistory = resolveVehicle(
      'А001АА56',
      baseContext({
        driverInputMode: 'vehicle',
        vehicleDrivers: [
          {
            id: 'l1',
            vehicle_number: 'А001АА56',
            driver_name: 'Единственный',
            last_used_at: '2026-01-01T00:00:00Z',
            use_count: 3,
          },
        ],
      }),
    );
    expect(withSingleHistory.driver_name).toBe('Единственный');
    expect(withSingleHistory.driver_candidates).toEqual(['Единственный']);

    const withMultiple = resolveVehicle(
      'А001АА56',
      baseContext({
        driverInputMode: 'vehicle',
        vehicleDrivers: [
          {
            id: 'l1',
            vehicle_number: 'А001АА56',
            driver_name: 'Первый',
            last_used_at: '2026-02-01T00:00:00Z',
            use_count: 1,
          },
          {
            id: 'l2',
            vehicle_number: 'А001АА56',
            driver_name: 'Второй',
            last_used_at: '2026-01-01T00:00:00Z',
            use_count: 5,
          },
        ],
      }),
    );
    expect(withMultiple.driver_name).toBe('');
    expect(withMultiple.driver_candidates).toEqual(['Первый', 'Второй']);

    const allMode = resolveVehicle(
      'А001АА56',
      baseContext({
        driverInputMode: 'all',
        vehicleDrivers: [
          {
            id: 'l1',
            vehicle_number: 'А001АА56',
            driver_name: 'Единственный',
            last_used_at: '2026-01-01T00:00:00Z',
            use_count: 3,
          },
        ],
      }),
    );
    expect(allMode.driver_name).toBe('');
  });
});
