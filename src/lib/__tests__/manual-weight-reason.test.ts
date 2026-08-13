import { describe, expect, it } from 'vitest';
import {
  normalizeManualWeightReasonMode,
  validateManualWeightReason,
} from '../manual-weight-reason';

describe('normalizeManualWeightReasonMode', () => {
  it('defaults to optional', () => {
    expect(normalizeManualWeightReasonMode(undefined)).toBe('optional');
    expect(normalizeManualWeightReasonMode('nope')).toBe('optional');
  });

  it('accepts known modes', () => {
    expect(normalizeManualWeightReasonMode('off')).toBe('off');
    expect(normalizeManualWeightReasonMode('required')).toBe('required');
  });
});

describe('validateManualWeightReason', () => {
  it('off always null reason', () => {
    const r = validateManualWeightReason({
      mode: 'off',
      reason: 'something',
      gross_source: 'manual',
      tare_source: 'manual',
      gross_weight: 100,
      tare_weight: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('optional allows empty', () => {
    const r = validateManualWeightReason({
      mode: 'optional',
      reason: '  ',
      gross_source: 'manual',
      tare_source: 'instrument',
      gross_weight: 100,
      tare_weight: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('required blocks empty when manual weight present', () => {
    const r = validateManualWeightReason({
      mode: 'required',
      reason: '',
      gross_source: 'manual',
      tare_source: 'instrument',
      gross_weight: 100,
      tare_weight: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Укажите причину ручного ввода веса/);
  });

  it('required passes when instrument/dictionary only', () => {
    const r = validateManualWeightReason({
      mode: 'required',
      reason: '',
      gross_source: 'instrument',
      tare_source: 'dictionary',
      gross_weight: 100,
      tare_weight: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('required accepts trimmed reason', () => {
    const r = validateManualWeightReason({
      mode: 'required',
      reason: '  прибор недоступен  ',
      gross_source: 'manual',
      tare_source: 'manual',
      gross_weight: 1,
      tare_weight: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('прибор недоступен');
  });
});
