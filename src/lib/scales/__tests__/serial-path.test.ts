import { describe, expect, it } from 'vitest';
import { normalizeSerialPath } from '../serial-path';

describe('normalizeSerialPath', () => {
  it('normalizes Windows COM port spellings', () => {
    expect(normalizeSerialPath('com 3')).toBe('COM3');
    expect(normalizeSerialPath('COM 3')).toBe('COM3');
    expect(normalizeSerialPath('COM3')).toBe('COM3');
    expect(normalizeSerialPath(' com 3 ')).toBe('COM3');
  });

  it('leaves Linux device paths unchanged', () => {
    expect(normalizeSerialPath('/dev/ttyUSB0')).toBe('/dev/ttyUSB0');
  });
});
