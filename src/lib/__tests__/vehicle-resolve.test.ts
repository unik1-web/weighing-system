import { describe, expect, it } from 'vitest';
import {
  driverDatalistOptions,
  findLastCompletedTicket,
  findVehicleByKey,
  resolveDriverAutofill,
  resolvePlateSource,
  resolveTripFields,
} from '../vehicle-resolve';
import { normalizeVehicleKey } from '../vehicle-plate';
import type { DictionaryEntry, VehicleDriverRecord, WeighingTicket } from '../storage';

function vehicle(overrides: Partial<DictionaryEntry> & { vehicle_number: string }): DictionaryEntry {
  return {
    id: overrides.id ?? 'v1',
    name: overrides.vehicle_number,
    notes: '',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function ticket(overrides: Partial<WeighingTicket> & { vehicle_number: string }): WeighingTicket {
  return {
    id: overrides.id ?? 't1',
    ticket_number: 1,
    vehicle_brand: '',
    trailer_number: '',
    driver_name: '',
    cargo_name: '',
    shipper_name: '',
    receiver_name: '',
    carrier_name: '',
    price: 0,
    vat_rate: 0,
    gross_weight: 10000,
    tare_weight: 5000,
    net_weight: 5000,
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
    created_at: '2026-07-01T10:00:00.000Z',
    completed_at: '2026-07-01T10:01:00.000Z',
    weighing_mode: 'single',
    version: 1,
    ...overrides,
  };
}

function driverRow(
  overrides: Partial<VehicleDriverRecord> & { vehicle_key: string; driver_name: string },
): VehicleDriverRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    last_used_at: overrides.last_used_at ?? '2026-07-01T10:00:00.000Z',
    use_count: overrides.use_count ?? 1,
    ...overrides,
  };
}

describe('vehicle-resolve', () => {
  it('TC-UNIT-01: brand/cargo/shipper priorities card → last completed → empty', () => {
    const key = normalizeVehicleKey('А123ВС77');
    const vehicles = [
      vehicle({
        vehicle_number: 'А123ВС77',
        vehicle_brand: 'КамАЗ',
        preferred_cargo_name: 'ТКО',
        preferred_shipper_name: 'ООО Ромашка',
      }),
    ];
    const tickets = [
      ticket({
        vehicle_number: 'А123ВС77',
        vehicle_brand: 'Урал',
        cargo_name: 'Песок',
        shipper_name: 'Старый',
        completed_at: '2026-06-01T10:00:00.000Z',
      }),
    ];

    const fromCard = resolveTripFields({
      key,
      vehicles,
      tickets,
      driversHistory: [],
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(fromCard.vehicle_brand).toBe('КамАЗ');
    expect(fromCard.cargo_name).toBe('ТКО');
    expect(fromCard.shipper_name).toBe('ООО Ромашка');

    const fromTicket = resolveTripFields({
      key,
      vehicles: [],
      tickets,
      driversHistory: [],
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(fromTicket.vehicle_brand).toBe('Урал');
    expect(fromTicket.cargo_name).toBe('Песок');
    expect(fromTicket.shipper_name).toBe('Старый');

    const empty = resolveTripFields({
      key,
      vehicles: [],
      tickets: [],
      driversHistory: [],
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(empty).toEqual({});
  });

  it('TC-UNIT-02: driver history=1 → autofill', () => {
    const key = normalizeVehicleKey('А123ВС77');
    expect(
      resolveDriverAutofill({
        history: [driverRow({ vehicle_key: key, driver_name: 'Иванов И.И.' })],
        preferred: 'Петров П.П.',
        lastTicket: ticket({ vehicle_number: 'А123ВС77', driver_name: 'Сидоров' }),
      }),
    ).toBe('Иванов И.И.');
  });

  it('TC-UNIT-03: driver history=0 → fallthrough preferred → last ticket', () => {
    expect(
      resolveDriverAutofill({
        history: [],
        preferred: 'Петров П.П.',
        lastTicket: ticket({ vehicle_number: 'А123ВС77', driver_name: 'Сидоров' }),
      }),
    ).toBe('Петров П.П.');

    expect(
      resolveDriverAutofill({
        history: [],
        preferred: '',
        lastTicket: ticket({ vehicle_number: 'А123ВС77', driver_name: 'Сидоров' }),
      }),
    ).toBe('Сидоров');

    expect(resolveDriverAutofill({ history: [], preferred: '', lastTicket: null })).toBe('');
  });

  it('TC-UNIT-04: driver history>1 → no autofill and no fallthrough', () => {
    const key = normalizeVehicleKey('А123ВС77');
    expect(
      resolveDriverAutofill({
        history: [
          driverRow({ vehicle_key: key, driver_name: 'Иванов И.И.' }),
          driverRow({ vehicle_key: key, driver_name: 'Петров П.П.', id: 'd2' }),
        ],
        preferred: 'Предпочтительный',
        lastTicket: ticket({ vehicle_number: 'А123ВС77', driver_name: 'Сидоров' }),
      }),
    ).toBe('');
  });

  it('TC-UNIT-05: non-empty form fields are not patched', () => {
    const key = normalizeVehicleKey('А123ВС77');
    const patch = resolveTripFields({
      key,
      vehicles: [
        vehicle({
          vehicle_number: 'А123ВС77',
          vehicle_brand: 'КамАЗ',
          preferred_cargo_name: 'ТКО',
          preferred_shipper_name: 'ООО',
          preferred_driver_name: 'Иванов',
        }),
      ],
      tickets: [],
      driversHistory: [],
      current: {
        vehicle_brand: 'Моя марка',
        driver_name: 'Мой водитель',
        cargo_name: 'Мой груз',
        shipper_name: 'Мой отправитель',
      },
    });
    expect(patch).toEqual({});
  });

  it('TC-UNIT-06: datalist modes vehicle / all / free', () => {
    const key = normalizeVehicleKey('А123ВС77');
    const history = [
      driverRow({
        vehicle_key: key,
        driver_name: 'Иванов И.И.',
        last_used_at: '2026-07-02T10:00:00.000Z',
        use_count: 1,
      }),
      driverRow({
        vehicle_key: key,
        driver_name: 'Петров П.П.',
        last_used_at: '2026-07-01T10:00:00.000Z',
        use_count: 5,
        id: 'd2',
      }),
    ];
    const allDrivers = [{ name: 'Сидоров С.С.' }, { name: 'Иванов И.И.' }];

    expect(driverDatalistOptions({ mode: 'free', history, allDrivers })).toEqual([]);
    expect(driverDatalistOptions({ mode: 'vehicle', history: [], allDrivers })).toEqual([]);
    expect(driverDatalistOptions({ mode: 'vehicle', history, allDrivers })).toEqual([
      'Иванов И.И.',
      'Петров П.П.',
    ]);
    expect(driverDatalistOptions({ mode: 'all', history, allDrivers })).toEqual([
      'Иванов И.И.',
      'Петров П.П.',
      'Сидоров С.С.',
    ]);
  });

  it('TC-UNIT-07: resolvePlateSource directory vs operator via key', () => {
    const vehicles = [vehicle({ vehicle_number: 'А123ВС77' })];
    const key = normalizeVehicleKey('а123вс77');
    expect(resolvePlateSource(key, vehicles)).toBe('directory');
    expect(resolvePlateSource(normalizeVehicleKey('Х999ХХ99'), vehicles)).toBe('operator');
    expect(resolvePlateSource('', vehicles)).toBe('operator');
  });

  it('TC-UNIT-08: resolveTripFields does not return tare from last ticket', () => {
    const key = normalizeVehicleKey('А123ВС77');
    const patch = resolveTripFields({
      key,
      vehicles: [],
      tickets: [
        ticket({
          vehicle_number: 'А123ВС77',
          tare_weight: 9999,
          vehicle_brand: 'Урал',
        }),
      ],
      driversHistory: [],
      current: { vehicle_brand: '', driver_name: '', cargo_name: '', shipper_name: '' },
    });
    expect(patch).not.toHaveProperty('tare_weight');
    expect(patch).not.toHaveProperty('tare_source');
    expect(patch.vehicle_brand).toBe('Урал');
  });

  it('findVehicleByKey / findLastCompletedTicket use normalizeVehicleKey', () => {
    const vehicles = [vehicle({ vehicle_number: 'А123ВС77' })];
    const key = normalizeVehicleKey('А123ВС 77');
    expect(findVehicleByKey(vehicles, key)?.vehicle_number).toBe('А123ВС77');

    const tickets = [
      ticket({
        id: 'old',
        vehicle_number: 'А123ВС77',
        completed_at: '2026-01-01T00:00:00.000Z',
      }),
      ticket({
        id: 'new',
        vehicle_number: 'А123ВС77',
        completed_at: '2026-07-01T00:00:00.000Z',
      }),
      ticket({
        id: 'open',
        vehicle_number: 'А123ВС77',
        status: 'open',
        completed_at: null,
      }),
    ];
    expect(findLastCompletedTicket(tickets, key)?.id).toBe('new');
  });
});
