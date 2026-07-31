import type { ScaleConnectionDraft, NormalizedScaleReading } from '../contract';

function normalizeNumber(raw: string): number | null {
  const value = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse Newton frame without changing existing visible behavior.
 */
export function parseNewtonFrame(
  raw: string,
  _connection: ScaleConnectionDraft,
): NormalizedScaleReading | null {
  const frame = raw.trim();
  if (!frame) return null;
  const match = frame.match(
    /^(ST|US|MOT|UNST)?\s*,?\s*(GS|NT|GROSS|NET)?\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$/i,
  );
  if (!match) return null;
  const value = normalizeNumber(match[3]);
  if (value === null) return null;
  const state = (match[1] ?? 'ST').toUpperCase();
  return {
    value,
    stable: state === 'ST',
    raw: frame,
    unit: (match[4] ?? 'kg').toLowerCase(),
    negative: value < 0,
  };
}
