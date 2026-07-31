import type { ScaleConnectionDraft, NormalizedScaleReading } from '../contract';

function normalizeNumber(raw: string): number | null {
  const value = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse Microsim M0601 Web Serial frame.
 */
export function parseMicrosimFrame(
  raw: string,
  _connection: ScaleConnectionDraft,
): NormalizedScaleReading | null {
  const frame = raw.trim();
  if (!frame) return null;
  const match = frame.match(/^(ST|US)\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$/i);
  if (!match) return null;
  const value = normalizeNumber(match[2]);
  if (value === null) return null;
  return {
    value,
    stable: match[1].toUpperCase() === 'ST',
    raw: frame,
    unit: (match[3] ?? 'kg').toLowerCase(),
    negative: value < 0,
  };
}
