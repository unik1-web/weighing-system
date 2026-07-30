import { describe, expect, it } from 'vitest';
import {
  suggestPhase,
  isMaxTimeExceeded,
  normalizeWeighingMode,
  filterIncompleteDual,
  netWeight,
  totalAmount,
  shouldAutofillTare,
  isCaptureAllowed,
  classifyOpenWeightState,
  classifyOpenWeights,
  slotEditability,
  resolveCaptureSlot,
  emptySlotForOne,
  parseWeightInput,
  firstWeightDatetime,
  validateSingleComplete,
  validateDualFirstPass,
  validateDualComplete,
} from '../weighing-mode';

describe('suggestPhase', () => {
  it('returns tare when weight ≤ threshold', () => {
    expect(suggestPhase(15000, 15000)).toBe('tare');
    expect(suggestPhase(100, 15000)).toBe('tare');
  });

  it('returns gross when weight > threshold', () => {
    expect(suggestPhase(15001, 15000)).toBe('gross');
  });
});

describe('isMaxTimeExceeded', () => {
  it('returns false when maxHours ≤ 0', () => {
    expect(isMaxTimeExceeded('2026-01-01T00:00:00', '2026-01-03T00:00:00', 0)).toBe(false);
  });

  it('returns true when interval exceeds maxHours', () => {
    expect(isMaxTimeExceeded('2026-01-01T00:00:00', '2026-01-02T01:00:00', 24)).toBe(true);
  });

  it('returns false when within limit', () => {
    expect(isMaxTimeExceeded('2026-01-01T00:00:00', '2026-01-01T12:00:00', 24)).toBe(false);
  });
});

describe('normalizeWeighingMode', () => {
  it('keeps explicit dual on completed', () => {
    expect(normalizeWeighingMode({ status: 'completed', weighing_mode: 'dual' })).toBe('dual');
  });

  it('maps absent mode: open→dual, completed→single', () => {
    expect(normalizeWeighingMode({ status: 'open' })).toBe('dual');
    expect(normalizeWeighingMode({ status: 'completed' })).toBe('single');
  });
});

describe('filterIncompleteDual / classify', () => {
  it('filters only open dual', () => {
    const tickets = [
      { id: '1', status: 'open', weighing_mode: 'dual' as const },
      { id: '2', status: 'open', weighing_mode: 'single' as const },
      { id: '3', status: 'completed', weighing_mode: 'dual' as const },
    ];
    expect(filterIncompleteDual(tickets).map((t) => t.id)).toEqual(['1']);
  });

  it('classifies 0/1/2 weights', () => {
    expect(classifyOpenWeightState({ gross_weight: null, tare_weight: null })).toBe('zero');
    expect(classifyOpenWeightState({ gross_weight: 0, tare_weight: null })).toBe('zero');
    expect(classifyOpenWeightState({ gross_weight: 10000, tare_weight: null })).toBe('one');
    expect(classifyOpenWeightState({ gross_weight: 10000, tare_weight: 3000 })).toBe('two');
    expect(classifyOpenWeights(null, 5000)).toBe('one');
  });
});

describe('slotEditability / resolveCaptureSlot', () => {
  it('locks filled slot for one-weight state', () => {
    expect(
      slotEditability('one', { gross_weight: 20000, tare_weight: null }),
    ).toEqual({ grossEditable: false, tareEditable: true });
    expect(slotEditability('two')).toEqual({ grossEditable: false, tareEditable: false });
    expect(slotEditability('zero')).toEqual({ grossEditable: true, tareEditable: true });
  });

  it('routes capture by threshold without override', () => {
    expect(
      resolveCaptureSlot({
        phaseOverride: false,
        overridePhase: 'gross',
        weight: 1000,
        threshold: 15000,
        editability: { grossEditable: true, tareEditable: true },
      }),
    ).toBe('tare');
  });

  it('routes capture to override phase when editable', () => {
    expect(
      resolveCaptureSlot({
        phaseOverride: true,
        overridePhase: 'gross',
        weight: 1000,
        threshold: 15000,
        editableGross: true,
        editableTare: true,
      }),
    ).toBe('gross');
  });

  it('returns null for explicit override onto read-only slot', () => {
    expect(
      resolveCaptureSlot({
        phaseOverride: true,
        overridePhase: 'gross',
        weight: 20000,
        threshold: 15000,
        editability: { grossEditable: false, tareEditable: true },
      }),
    ).toBe(null);
  });

  it('open one with tare filled: weight ≤ threshold without override writes to empty gross', () => {
    const weights = { gross_weight: null, tare_weight: 8000 };
    expect(classifyOpenWeightState(weights)).toBe('one');
    expect(emptySlotForOne(weights)).toBe('gross');
    const editability = slotEditability('one', weights);
    expect(editability).toEqual({ grossEditable: true, tareEditable: false });
    // Threshold alone would suggest tare (12000 ≤ 15000), but tare is locked.
    expect(
      resolveCaptureSlot({
        phaseOverride: false,
        overridePhase: 'tare',
        weight: 12000,
        threshold: 15000,
        editability,
      }),
    ).toBe('gross');
  });

  it('open one with gross filled: weight > threshold without override writes to empty tare', () => {
    const weights = { gross_weight: 25000, tare_weight: null };
    const editability = slotEditability('one', weights);
    expect(
      resolveCaptureSlot({
        phaseOverride: false,
        overridePhase: 'gross',
        weight: 20000,
        threshold: 15000,
        editability,
      }),
    ).toBe('tare');
  });
});

describe('parseWeightInput', () => {
  it('keeps explicit zero as 0, empty as null', () => {
    expect(parseWeightInput('')).toBeNull();
    expect(parseWeightInput('0')).toBe(0);
    expect(parseWeightInput('0.0')).toBe(0);
    expect(parseWeightInput('8000')).toBe(8000);
    expect(parseWeightInput('abc')).toBeNull();
  });

  it('allows single complete with tare 0 after parse', () => {
    const tare = parseWeightInput('0');
    expect(validateSingleComplete({ gross: 10000, tare })).toBeNull();
  });
});

describe('net / amount / autofill / capture', () => {
  it('computes net and amount as-is', () => {
    expect(netWeight(10000, 3000)).toBe(7000);
    expect(netWeight(2000, 5000)).toBe(0);
    expect(totalAmount(7000, 100)).toBe(700);
  });

  it('autofills tare only in single and not completing', () => {
    expect(shouldAutofillTare('single')).toBe(true);
    expect(shouldAutofillTare('dual')).toBe(false);
    expect(shouldAutofillTare({ mode: 'single', completing: true })).toBe(false);
    expect(shouldAutofillTare({ mode: 'dual', completing: false })).toBe(false);
  });

  it('allows capture when stable or stableMode', () => {
    expect(isCaptureAllowed(false, false)).toBe(false);
    expect(isCaptureAllowed(false, true)).toBe(true);
    expect(isCaptureAllowed(true, false)).toBe(true);
  });
});

describe('validators', () => {
  it('validateSingleComplete', () => {
    expect(validateSingleComplete({ gross: null, tare: 0 })).toMatch(/брутто/i);
    expect(validateSingleComplete({ gross: 10000, tare: null })).toMatch(/тара/i);
    expect(validateSingleComplete({ gross: 10000, tare: 0 })).toBeNull();
  });

  it('validateDualFirstPass', () => {
    expect(validateDualFirstPass({ gross: null, tare: null })).toMatch(/первого прохода/i);
    expect(validateDualFirstPass({ gross: 0, tare: null })).toMatch(/первого прохода/i);
    expect(validateDualFirstPass({ gross: 10000, tare: 3000 })).toMatch(/ровно один/i);
    expect(validateDualFirstPass({ gross: 10000, tare: null })).toBeNull();
  });

  it('validateDualComplete', () => {
    expect(validateDualComplete({ state: 'one', gross: 10000, tare: null })).toMatch(/второй/i);
    expect(validateDualComplete({ state: 'one', gross: 10000, tare: 3000 })).toBeNull();
    expect(validateDualComplete({ state: 'zero', gross: 10000, tare: null })).toMatch(/оба/i);
    expect(validateDualComplete({ state: 'two', gross: 10000, tare: 3000 })).toBeNull();
  });
});

describe('firstWeightDatetime', () => {
  it('prefers filled slot datetime then created_at', () => {
    expect(
      firstWeightDatetime({
        gross_weight: 20000,
        tare_weight: null,
        gross_datetime: '2026-01-01T10:00:00',
        tare_datetime: null,
        created_at: '2026-01-01T09:00:00',
      }),
    ).toBe('2026-01-01T10:00:00');
    expect(
      firstWeightDatetime({
        gross_weight: null,
        tare_weight: null,
        gross_datetime: null,
        tare_datetime: null,
        created_at: '2026-01-01T09:00:00',
      }),
    ).toBe('2026-01-01T09:00:00');
  });
});
