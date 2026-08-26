import { describe, expect, it } from 'vitest';
import {
  getAdapter,
  isScaleAdapterId,
  normalizeAdapterId,
  connectionFromAdapter,
} from '../registry';

describe('normalizeAdapterId / getAdapter', () => {
  it('keeps known builtin and custom ids', () => {
    expect(normalizeAdapterId('cas')).toBe('cas');
    expect(normalizeAdapterId('microsim-m0601')).toBe('microsim-m0601');
    expect(normalizeAdapterId('custom')).toBe('custom');
    expect(isScaleAdapterId('newton')).toBe(true);
  });

  it('falls back unknown / non-string to microsim-m0601', () => {
    expect(normalizeAdapterId('unknown-device')).toBe('microsim-m0601');
    expect(normalizeAdapterId(null)).toBe('microsim-m0601');
    expect(normalizeAdapterId(12)).toBe('microsim-m0601');
    expect(isScaleAdapterId('nope')).toBe(false);
  });

  it('getAdapter returns microsim defaults for missing id cast', () => {
    const adapter = getAdapter('not-real' as 'microsim-m0601');
    expect(adapter.id).toBe('microsim-m0601');
    const conn = connectionFromAdapter('cas');
    expect(conn.parity).toBe('even');
    expect(conn.dataBits).toBe(7);
  });
});
