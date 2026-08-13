import { describe, expect, it } from 'vitest';
import {
  parseUniversalFrame,
  parseCustomFrame,
  compileParseRegex,
  validateCustomParseConfig,
} from '../scales/parse';
import type { ScaleConnectionProfile } from '../scales/types';

describe('parseUniversalFrame (4 profiles)', () => {
  it('parses stable microsim-like frame', () => {
    const r = parseUniversalFrame('ST,GS,+  12345.6kg');
    expect(r).not.toBeNull();
    expect(r!.weight).toBeCloseTo(12345.6);
    expect(r!.unit).toBe('kg');
    expect(r!.stable).toBe(true);
    expect(r!.negative).toBe(false);
  });

  it('parses unstable US prefix', () => {
    const r = parseUniversalFrame('US,NT,-   100.0kg');
    expect(r).not.toBeNull();
    expect(r!.stable).toBe(false);
    expect(r!.negative).toBe(true);
    expect(r!.weight).toBeCloseTo(-100);
  });

  it('parses CAS-like with spaces', () => {
    const r = parseUniversalFrame('ST,GS,  15200 kg');
    expect(r).not.toBeNull();
    expect(r!.weight).toBeCloseTo(15200);
  });

  it('parses simple numeric line', () => {
    const r = parseUniversalFrame('8750.5');
    expect(r).not.toBeNull();
    expect(r!.weight).toBeCloseTo(8750.5);
    expect(r!.stable).toBe(true);
  });

  it('returns null when no number', () => {
    expect(parseUniversalFrame('ST,GS,kg')).toBeNull();
  });
});

describe('parseCustomFrame', () => {
  const base: ScaleConnectionProfile = {
    baudRate: 9600,
    parity: 'none',
    dataBits: 8,
    stopBits: 1,
    lineTerminator: '\r\n',
  };

  it('parses named weight group', () => {
    const r = parseCustomFrame('ST,1234.5kg', {
      ...base,
      parseRegex: '(?<stable>ST|US),(?<weight>-?\\d+(?:[.,]\\d+)?)\\s*(?<unit>kg)?',
    });
    expect(r).not.toBeNull();
    expect(r!.weight).toBeCloseTo(1234.5);
    expect(r!.unit).toBe('kg');
    expect(r!.stable).toBe(true);
  });

  it('parses mask when regex empty', () => {
    const r = parseCustomFrame('ST,001234kg', {
      ...base,
      parseRegex: '',
      parseMask: 'ST,######kg',
    });
    expect(r).not.toBeNull();
    expect(r!.weight).toBe(1234);
  });

  it('throws when neither regex nor mask', () => {
    expect(() =>
      parseCustomFrame('123', { ...base, parseRegex: '', parseMask: '' }),
    ).toThrow(/Задайте regex или маску/);
  });

  it('compileParseRegex throws Russian error', () => {
    expect(() => compileParseRegex('(')).toThrow(/Некорректное регулярное выражение/);
  });

  it('validateCustomParseConfig rejects bad regex', () => {
    expect(() =>
      validateCustomParseConfig({ ...base, parseRegex: '[', parseMask: '' }),
    ).toThrow(/Некорректное регулярное выражение/);
  });
});
