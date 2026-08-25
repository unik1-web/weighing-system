import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../errors';

describe('getErrorMessage', () => {
  it('prefers Error.message and non-empty strings', () => {
    expect(getErrorMessage(new Error('сеть недоступна'))).toBe('сеть недоступна');
    expect(getErrorMessage('таймаут')).toBe('таймаут');
    expect(getErrorMessage('   ', 'fallback')).toBe('fallback');
  });

  it('serializes plain objects / blank Error and falls back when empty', () => {
    expect(getErrorMessage({ code: 500, message: 'fail' })).toContain('"code": 500');
    // Blank Error.message skips the Error branch, then serializes the Error object.
    expect(getErrorMessage(new Error('   '))).toContain('"message"');
    expect(getErrorMessage({})).toBe('Произошла ошибка');
    expect(getErrorMessage(null, 'custom')).toBe('custom');
    expect(getErrorMessage(undefined)).toBe('Произошла ошибка');
  });
});
