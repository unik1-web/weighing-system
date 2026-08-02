import { describe, expect, it } from 'vitest';
import {
  findLastCompletedTrip,
  normalizeDriverInputMode,
  normalizePlateSource,
  resolveDriverCandidates,
  resolveVehicle,
  type VehicleDriverLink,
  type VehicleResolveContext,
} from '../vehicle-resolve';

const baseContext = (
  overrides: Partial<VehicleResolveContext> = {},
): VehicleResolveContext => ({
  vehicles: [],
  drivers: [
    { id: 'd1', name: 'Иванов И.И.' },
    { id: 'd2', name: 'Петров П.П.' },
  ],
  vehicleDrivers: [],
  completedTickets: [],
  taraDefault: 0,
  driverInputMode: 'all',
  ...overrides,
});

describe('normalizeDriverInputMode / normalizePlateSource', () => {
  it('defaults invalid driver mode to all', () => {
    expect(normalizeDriverInputMode('vehicle')).toBe('vehicle');
    expect(normalizeDriverInputMode('free')).toBe('free');
    expect(normalizeDriverInputMode('nope')).toBe('all');
    expect(normalizeDriverInputMode(null)).toBe('all');
  });

  it('soft-reads plate_source', () => {
    expect(normalizePlateSource('directory')).toBe('directory');
    expect(normalizePlateSource('operator')).toBe('operator');
    expect(normalizePlateSource('anpr')).toBe('anpr');
    expect(normalizePlateSource('legacy')).toBeNull();
    expect(normalizePlateSource(null)).toBeNull();
  });
});

describe('findLastCompletedTrip', () => {
  it('picks max completed_at / created_at for same plate', () => {
    const tickets = [
      {
        vehicle_number: 'А001АА56',
        status: 'completed',
        driver_name: 'Старый',
        created_at: '2026-01-01T10:00:00Z',
        completed_at: '2026-01-01T10:00:00Z',
      },
      {
        vehicle_number: 'А001АА56',
        status: 'completed',
        driver_name: 'Новый',
        created_at: '2026-01-02T10:00:00Z',
        completed_at: '2026-01-02T11:00:00Z',
      },
      {
        vehicle_number: 'А001АА56',
        status: 'open',
        driver_name: 'Открытый',
        created_at: '2026-01-03T10:00:00Z',
      },
    ];
    expect(findLastCompletedTrip('А001АА56', tickets)?.driver_name).toBe('Новый');
  });
});

describe('resolveDriverCandidates', () => {
  const history: VehicleDriverLink[] = [
    {
      id: '1',
      vehicle_number: 'А001АА56',
      driver_name: 'Иванов И.И.',
      last_used_at: '2026-01-02T00:00:00Z',
      use_count: 2,
    },
    {
      id: '2',
      vehicle_number: 'А001АА56',
      driver_name: 'Сидоров С.С.',
      last_used_at: '2026-01-01T00:00:00Z',
      use_count: 5,
    },
  ];

  it('vehicle mode returns history sorted by last_used_at then use_count', () => {
    expect(
      resolveDriverCandidates('А001АА56', 'vehicle', history, ['А', 'Б']),
    ).toEqual(['Иванов И.И.', 'Сидоров С.С.']);
  });

  it('vehicle mode falls back to all when history empty', () => {
    expect(resolveDriverCandidates('А001АА56', 'vehicle', [], ['А', 'Б'])).toEqual(['А', 'Б']);
  });

  it('all / free modes', () => {
    expect(resolveDriverCandidates('А001АА56', 'all', history, ['А', 'Б'])).toEqual(['А', 'Б']);
    expect(resolveDriverCandidates('А001АА56', 'free', history, ['А', 'Б'])).toEqual([]);
  });
});

describe('resolveVehicle priorities', () => {
  it('prefs beat last trip beat empty', () => {
    const result = resolveVehicle(
      'А001АА56',
      baseContext({
        vehicles: [
          {
            id: 'v1',
            name: 'А001АА56',
            vehicle_number: 'А001АА56',
            vehicle_brand: 'КамАЗ',
            preferred_driver_name: 'Предпочитаемый',
            preferred_cargo_name: 'Грунт',
            preferred_shipper_name: 'ООО А',
            default_tare_weight: 3200,
          },
        ],
        completedTickets: [
          {
            vehicle_number: 'А001АА56',
            status: 'completed',
            vehicle_brand: 'МАЗ',
            driver_name: 'Из рейса',
            cargo_name: 'Песок',
            shipper_name: 'ООО Б',
            tare_weight: 3000,
            created_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:00:00Z',
          },
        ],
        taraDefault: 2500,
      }),
    );
    expect(result.vehicle_brand).toBe('КамАЗ');
    expect(result.driver_name).toBe('Предпочитаемый');
    expect(result.cargo_name).toBe('Грунт');
    expect(result.shipper_name).toBe('ООО А');
    expect(result.tare).toEqual({ tare_weight: 3200, tare_source: 'dictionary' });
    expect(result.plate_source).toBe('directory');
    expect(result.matched_vehicle_id).toBe('v1');
  });

  it('falls back to last trip then tara_default', () => {
    const result = resolveVehicle(
      'А002АА56',
      baseContext({
        completedTickets: [
          {
            vehicle_number: 'А002АА56',
            status: 'completed',
            vehicle_brand: 'МАЗ',
            driver_name: 'Из рейса',
            cargo_name: 'Песок',
            shipper_name: 'ООО Б',
            tare_weight: 3000,
            created_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:00:00Z',
          },
        ],
        taraDefault: 2500,
      }),
    );
    expect(result.vehicle_brand).toBe('МАЗ');
    expect(result.driver_name).toBe('Из рейса');
    expect(result.tare).toEqual({ tare_weight: 3000, tare_source: 'dictionary' });
    expect(result.plate_source).toBe('operator');
  });

  it('uses tara_default when no card/last tare', () => {
    const result = resolveVehicle('А003АА56', baseContext({ taraDefault: 2500 }));
    expect(result.tare).toEqual({ tare_weight: 2500, tare_source: 'default' });
  });

  it('auto-fills single history driver in vehicle mode when prefs/last empty', () => {
    const result = resolveVehicle(
      'А001АА56',
      baseContext({
        driverInputMode: 'vehicle',
        vehicleDrivers: [
          {
            id: '1',
            vehicle_number: 'А001АА56',
            driver_name: 'Один Водитель',
            last_used_at: '2026-01-01T00:00:00Z',
            use_count: 1,
          },
        ],
      }),
    );
    expect(result.driver_name).toBe('Один Водитель');
    expect(result.driver_candidates).toEqual(['Один Водитель']);
  });

  it('does not auto-fill when multiple history drivers and prefs empty', () => {
    const result = resolveVehicle(
      'А001АА56',
      baseContext({
        driverInputMode: 'vehicle',
        vehicleDrivers: [
          {
            id: '1',
            vehicle_number: 'А001АА56',
            driver_name: 'Первый',
            last_used_at: '2026-01-02T00:00:00Z',
            use_count: 1,
          },
          {
            id: '2',
            vehicle_number: 'А001АА56',
            driver_name: 'Второй',
            last_used_at: '2026-01-01T00:00:00Z',
            use_count: 1,
          },
        ],
      }),
    );
    expect(result.driver_name).toBe('');
    expect(result.driver_candidates).toEqual(['Первый', 'Второй']);
  });

  it('honours plateSourceOverride for ANPR accept', () => {
    const withCard = resolveVehicle(
      'А001АА56',
      baseContext({
        vehicles: [{ id: 'v1', vehicle_number: 'А001АА56', vehicle_brand: 'КамАЗ' }],
      }),
      { plateSourceOverride: 'anpr' },
    );
    expect(withCard.plate_source).toBe('anpr');
    expect(withCard.vehicle_brand).toBe('КамАЗ');

    const without = resolveVehicle('А999ХХ56', baseContext(), { plateSourceOverride: 'anpr' });
    expect(without.plate_source).toBe('anpr');
  });
});
