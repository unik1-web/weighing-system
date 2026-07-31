import { describe, expect, it } from 'vitest';
import {
  isManualWeightReasonRequiredOnCurrentStep,
  isManualWeightUsedOnCurrentStep,
} from '../weighing-mode';

describe('manual weight reason rules', () => {
  it('TC-UNIT-01: single mode requires reason only for manual slot on step', () => {
    expect(
      isManualWeightReasonRequiredOnCurrentStep({
        policy: 'required',
        slotsOnStep: ['gross', 'tare'],
        grossSource: 'instrument',
        tareSource: 'instrument',
      }),
    ).toBe(false);

    expect(
      isManualWeightReasonRequiredOnCurrentStep({
        policy: 'required',
        slotsOnStep: ['gross', 'tare'],
        grossSource: 'manual',
        tareSource: 'instrument',
      }),
    ).toBe(true);
  });

  it('dual first pass checks only saved slot', () => {
    expect(
      isManualWeightReasonRequiredOnCurrentStep({
        policy: 'required',
        slotsOnStep: ['gross'],
        grossSource: 'instrument',
        tareSource: 'manual',
      }),
    ).toBe(false);

    expect(
      isManualWeightReasonRequiredOnCurrentStep({
        policy: 'required',
        slotsOnStep: ['tare'],
        grossSource: 'instrument',
        tareSource: 'manual',
      }),
    ).toBe(true);
  });

  it('dual completion checks editable slot only', () => {
    expect(
      isManualWeightUsedOnCurrentStep({
        slotsOnStep: ['tare'],
        grossSource: 'manual',
        tareSource: 'instrument',
      }),
    ).toBe(false);

    expect(
      isManualWeightUsedOnCurrentStep({
        slotsOnStep: ['tare'],
        grossSource: 'instrument',
        tareSource: 'manual',
      }),
    ).toBe(true);
  });

  it('optional policy never requires reason', () => {
    expect(
      isManualWeightReasonRequiredOnCurrentStep({
        policy: 'optional',
        slotsOnStep: ['gross', 'tare'],
        grossSource: 'manual',
        tareSource: 'manual',
      }),
    ).toBe(false);
  });
});
