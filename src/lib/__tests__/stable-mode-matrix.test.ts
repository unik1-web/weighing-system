import { describe, expect, it } from 'vitest';
import { isCaptureAllowed } from '../weighing-mode';

describe('stable_mode matrix', () => {
  it('TC-E2E-01: stable_mode=false + stable=true allows capture', () => {
    expect(isCaptureAllowed(true, false)).toBe(true);
  });

  it('TC-E2E-01: stable_mode=false + stable=false blocks capture', () => {
    expect(isCaptureAllowed(false, false)).toBe(false);
  });

  it('TC-E2E-01: stable_mode=true + stable=true allows capture', () => {
    expect(isCaptureAllowed(true, true)).toBe(true);
  });

  it('TC-E2E-01: stable_mode=true + stable=false allows capture with warning branch', () => {
    expect(isCaptureAllowed(false, true)).toBe(true);
  });
});
