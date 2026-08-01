import { describe, expect, it } from 'vitest';
import {
  normalizeWeightSource,
  isWeightSource,
  resolveTareAutofill,
  ticketMatchesWeightSources,
  countWeightSources,
  WEIGHT_SOURCES,
  WEIGHT_SOURCE_LABELS,
} from '../weight-source';

describe('normalizeWeightSource', () => {
  it('returns known literals as-is', () => {
    for (const source of WEIGHT_SOURCES) {
      expect(normalizeWeightSource(source)).toBe(source);
    }
  });

  it('maps null / empty / unknown to manual', () => {
    expect(normalizeWeightSource(null)).toBe('manual');
    expect(normalizeWeightSource(undefined)).toBe('manual');
    expect(normalizeWeightSource('')).toBe('manual');
    expect(normalizeWeightSource('legacy')).toBe('manual');
    expect(normalizeWeightSource(1)).toBe('manual');
  });
});

describe('isWeightSource', () => {
  it('accepts only known literals', () => {
    expect(isWeightSource('dictionary')).toBe(true);
    expect(isWeightSource('default')).toBe(true);
    expect(isWeightSource('foo')).toBe(false);
    expect(isWeightSource(null)).toBe(false);
  });
});

describe('resolveTareAutofill', () => {
  it('prefers dictionary over default', () => {
    expect(
      resolveTareAutofill({ defaultTareWeight: 3200, taraDefault: 2500 }),
    ).toEqual({ tare_weight: 3200, tare_source: 'dictionary' });
  });

  it('uses last completed tare as dictionary before tara_default', () => {
    expect(
      resolveTareAutofill({
        defaultTareWeight: null,
        lastCompletedTareWeight: 3100,
        taraDefault: 2500,
      }),
    ).toEqual({ tare_weight: 3100, tare_source: 'dictionary' });
  });

  it('uses tara_default when vehicle card has no tare', () => {
    expect(
      resolveTareAutofill({ defaultTareWeight: null, taraDefault: 2500 }),
    ).toEqual({ tare_weight: 2500, tare_source: 'default' });
  });

  it('returns null when neither source is available', () => {
    expect(resolveTareAutofill({ defaultTareWeight: null, taraDefault: 0 })).toBeNull();
    expect(resolveTareAutofill({ defaultTareWeight: undefined, taraDefault: -1 })).toBeNull();
  });
});

describe('ticketMatchesWeightSources', () => {
  it('returns true when selected is empty', () => {
    expect(
      ticketMatchesWeightSources({ gross_source: 'manual', tare_source: 'instrument' }, []),
    ).toBe(true);
  });

  it('matches OR across gross and tare', () => {
    const ticket = { gross_source: 'instrument', tare_source: 'dictionary' };
    expect(ticketMatchesWeightSources(ticket, ['dictionary'])).toBe(true);
    expect(ticketMatchesWeightSources(ticket, ['manual'])).toBe(false);
    expect(ticketMatchesWeightSources(ticket, ['manual', 'instrument'])).toBe(true);
  });

  it('normalizes unknown sources before matching', () => {
    expect(
      ticketMatchesWeightSources({ gross_source: 'legacy', tare_source: null }, ['manual']),
    ).toBe(true);
  });
});

describe('countWeightSources', () => {
  it('counts only non-null weights and splits gross/tare', () => {
    const rows = countWeightSources([
      {
        gross_weight: 20000,
        tare_weight: 5000,
        gross_source: 'instrument',
        tare_source: 'dictionary',
      },
      {
        gross_weight: 18000,
        tare_weight: null,
        gross_source: 'manual',
        tare_source: 'default',
      },
      {
        gross_weight: null,
        tare_weight: 2500,
        gross_source: 'manual',
        tare_source: 'default',
      },
    ]);

    const bySource = Object.fromEntries(rows.map((r) => [r.source, r]));
    expect(bySource.instrument).toMatchObject({ gross: 1, tare: 0, total: 1 });
    expect(bySource.manual).toMatchObject({ gross: 1, tare: 0, total: 1 });
    expect(bySource.dictionary).toMatchObject({ gross: 0, tare: 1, total: 1 });
    expect(bySource.default).toMatchObject({ gross: 0, tare: 1, total: 1 });
    expect(bySource.instrument.label).toBe(WEIGHT_SOURCE_LABELS.instrument);
  });
});
