import { describe, expect, it } from 'vitest';
import {
  WEIGHT_SOURCE_LABELS,
  WEIGHT_SOURCES,
  normalizeWeightSource,
  ticketMatchesWeightSource,
  summarizeWeightSources,
  resolveTareAutofill,
} from '../weighing-mode';

describe('WeightSource helpers', () => {
  it('TC-UNIT-01: normalizeWeightSource keeps known values and maps unknown to manual', () => {
    expect(normalizeWeightSource('dictionary')).toBe('dictionary');
    expect(normalizeWeightSource('instrument')).toBe('instrument');
    expect(normalizeWeightSource('default')).toBe('default');
    expect(normalizeWeightSource('manual')).toBe('manual');
    expect(normalizeWeightSource('nope')).toBe('manual');
    expect(normalizeWeightSource(undefined)).toBe('manual');
    expect(normalizeWeightSource(null)).toBe('manual');
  });

  it('TC-UNIT-02: ticketMatchesWeightSource matches gross or all', () => {
    const ticket = { gross_source: 'instrument', tare_source: 'manual' };
    expect(ticketMatchesWeightSource(ticket, 'instrument')).toBe(true);
    expect(ticketMatchesWeightSource(ticket, 'dictionary')).toBe(false);
    expect(ticketMatchesWeightSource(ticket, 'all')).toBe(true);
  });

  it('TC-UNIT-03: OR match on tare dictionary', () => {
    const ticket = { gross_source: 'manual', tare_source: 'dictionary' };
    expect(ticketMatchesWeightSource(ticket, 'dictionary')).toBe(true);
    expect(ticketMatchesWeightSource(ticket, 'manual')).toBe(true);
    expect(ticketMatchesWeightSource(ticket, 'instrument')).toBe(false);
  });

  it('TC-UNIT-04: summarizeWeightSources counts gross and tare', () => {
    const summary = summarizeWeightSources([
      { gross_source: 'instrument', tare_source: 'dictionary' },
      { gross_source: 'manual', tare_source: 'default' },
    ]);
    expect(summary.gross.instrument).toBe(1);
    expect(summary.gross.manual).toBe(1);
    expect(summary.gross.dictionary).toBe(0);
    expect(summary.tare.dictionary).toBe(1);
    expect(summary.tare.default).toBe(1);
    expect(summary.tare.manual).toBe(0);
  });

  it('TC-UNIT-05: resolveTareAutofill dictionary / default / zero', () => {
    expect(
      resolveTareAutofill({
        allowed: true,
        locked: false,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: 8500,
        taraDefault: 2500,
      }),
    ).toEqual({ tareWeight: 8500, tareSource: 'dictionary' });

    expect(
      resolveTareAutofill({
        allowed: true,
        locked: false,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: null,
        taraDefault: 2500,
      }),
    ).toEqual({ tareWeight: 2500, tareSource: 'default' });

    expect(
      resolveTareAutofill({
        allowed: true,
        locked: false,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: null,
        taraDefault: 0,
      }),
    ).toBeNull();
  });

  it('TC-UNIT-06: resolveTareAutofill blocked by lock / !allowed / filled', () => {
    const base = {
      vehicleNumber: 'А001АА56',
      tareWeight: null as number | null,
      defaultTareWeight: 8500,
      taraDefault: 2500,
    };
    expect(resolveTareAutofill({ ...base, allowed: true, locked: true })).toBeNull();
    expect(resolveTareAutofill({ ...base, allowed: false, locked: false })).toBeNull();
    expect(
      resolveTareAutofill({ ...base, allowed: true, locked: false, tareWeight: 1000 }),
    ).toBeNull();
  });

  it('TC-UNIT-07: card tare has priority over tara_default', () => {
    expect(
      resolveTareAutofill({
        allowed: true,
        locked: false,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: 9000,
        taraDefault: 2500,
      })?.tareSource,
    ).toBe('dictionary');
  });

  it('TC-UNIT-LOCK-01: after lock resolve stays null even with empty tare', () => {
    const filled = resolveTareAutofill({
      allowed: true,
      locked: false,
      vehicleNumber: 'А001АА56',
      tareWeight: null,
      defaultTareWeight: 8500,
      taraDefault: 0,
    });
    expect(filled?.tareSource).toBe('dictionary');
    expect(
      resolveTareAutofill({
        allowed: true,
        locked: true,
        vehicleNumber: 'А001АА56',
        tareWeight: null,
        defaultTareWeight: 8500,
        taraDefault: 0,
      }),
    ).toBeNull();
  });

  it('WEIGHT_SOURCE_LABELS and WEIGHT_SOURCES are canonical', () => {
    expect(WEIGHT_SOURCE_LABELS.dictionary).toBe('СПРАВОЧНИК');
    expect(WEIGHT_SOURCE_LABELS.default).toBe('ПО УМОЛЧАНИЮ');
    expect(WEIGHT_SOURCE_LABELS.instrument).toBe('ПРИБОР');
    expect(WEIGHT_SOURCE_LABELS.manual).toBe('РУЧНОЙ');
    expect([...WEIGHT_SOURCES]).toEqual(['manual', 'instrument', 'dictionary', 'default']);
  });

  it('unknown source normalizes for filter as manual', () => {
    const ticket = { gross_source: 'weird', tare_source: 'instrument' };
    expect(ticketMatchesWeightSource(ticket, 'manual')).toBe(true);
    expect(ticketMatchesWeightSource(ticket, 'instrument')).toBe(true);
    expect(ticketMatchesWeightSource(ticket, 'dictionary')).toBe(false);
  });
});
