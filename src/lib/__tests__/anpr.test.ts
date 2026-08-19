import { describe, expect, it } from 'vitest';
import {
  canOfferAnpr,
  confidenceToPercent,
  finalizePlateSource,
} from '../anpr';

describe('finalizePlateSource', () => {
  it('maps accept / edit / reject', () => {
    expect(finalizePlateSource('accept', 'directory')).toBe('anpr');
    expect(finalizePlateSource('accept', 'operator')).toBe('anpr');
    expect(finalizePlateSource('edit', 'directory')).toBe('operator');
    expect(finalizePlateSource('reject', 'directory')).toBe('directory');
    expect(finalizePlateSource('reject', 'operator')).toBe('operator');
  });
});

describe('canOfferAnpr', () => {
  it('requires all gate flags', () => {
    expect(
      canOfferAnpr({
        anpr_enabled: true,
        video_enabled: true,
        anpr_mode: 'enabled',
        hasOverview: true,
      }),
    ).toBe(true);
    expect(
      canOfferAnpr({
        anpr_enabled: false,
        video_enabled: true,
        anpr_mode: 'enabled',
        hasOverview: true,
      }),
    ).toBe(false);
    expect(
      canOfferAnpr({
        anpr_enabled: true,
        video_enabled: false,
        anpr_mode: 'enabled',
        hasOverview: true,
      }),
    ).toBe(false);
    expect(
      canOfferAnpr({
        anpr_enabled: true,
        video_enabled: true,
        anpr_mode: 'disabled_by_configuration',
        hasOverview: true,
      }),
    ).toBe(false);
    expect(
      canOfferAnpr({
        anpr_enabled: true,
        video_enabled: true,
        anpr_mode: 'enabled',
        hasOverview: false,
      }),
    ).toBe(false);
  });
});

describe('confidenceToPercent', () => {
  it('formats 0..1 as percent string', () => {
    expect(confidenceToPercent(0.87)).toBe('Уверенность: 87%');
    expect(confidenceToPercent(1)).toBe('Уверенность: 100%');
    expect(confidenceToPercent(0)).toBe('Уверенность: 0%');
    expect(confidenceToPercent(null)).toBe('Уверенность: —');
  });
});
