import { describe, expect, it } from 'vitest';
import { formatVehiclePlate, normalizeVehicleKey } from '../vehicle-plate';
import { formatPersonName, formatVehicleBrand } from '../text-format';
import { normalizeImportDateTime, ticketImportKey } from '../import-keys';

describe('vehicle plate normalization', () => {
  it('maps latin lookalikes and adds default region 56', () => {
    expect(formatVehiclePlate('A123BC')).toBe('А123ВС56');
    expect(normalizeVehicleKey('A123BC')).toBe('а123вс56');
  });

  it('strips spaces/dashes and keeps existing region', () => {
    expect(formatVehiclePlate('А 123 ВС 77')).toBe('А123ВС77');
    expect(normalizeVehicleKey('А-123-ВС-77')).toBe('а123вс77');
  });

  it('treats differently formatted plates as the same key', () => {
    expect(normalizeVehicleKey('а123вс56')).toBe(normalizeVehicleKey('A 123 BC'));
  });

  it('returns empty for blank input', () => {
    expect(formatVehiclePlate('  ')).toBe('');
    expect(normalizeVehicleKey('')).toBe('');
  });
});

describe('text formatting', () => {
  it('formats person names and initials', () => {
    expect(formatPersonName('иванов и.и.')).toBe('Иванов И.И.');
    expect(formatPersonName('  петров   п.п.  ')).toBe('Петров П.П.');
  });

  it('formats brands and keeps leading digits', () => {
    expect(formatVehicleBrand('камаз 65115')).toBe('Камаз 65115');
    expect(formatVehicleBrand('')).toBe('');
  });
});

describe('import keys', () => {
  it('normalizes datetime with T or space separators', () => {
    expect(normalizeImportDateTime('2026-07-28T10:05:09')).toBe('2026-07-28 10:05:09');
    expect(normalizeImportDateTime('2026-07-28 10:05:09')).toBe('2026-07-28 10:05:09');
  });

  it('returns trimmed original for invalid dates', () => {
    expect(normalizeImportDateTime('  not-a-date  ')).toBe('not-a-date');
    expect(normalizeImportDateTime(null)).toBe('');
  });

  it('builds stable ticket import keys', () => {
    expect(
      ticketImportKey({
        gross_datetime: '2026-07-28T10:05:09',
        tare_datetime: '2026-07-28 11:00:00',
        vehicle_number: ' А123ВС56 ',
      }),
    ).toBe('2026-07-28 10:05:09_2026-07-28 11:00:00_А123ВС56');
  });
});
