import type { ScaleConnectionDraft, NormalizedScaleReading } from '../contract';

function normalizeNumber(raw: string): number | null {
  const value = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function stripTerminator(raw: string, connection: ScaleConnectionDraft): string {
  const terminator = connection.serial?.line_terminator;
  if (!terminator) return raw.trim();
  if (raw.endsWith(terminator)) {
    return raw.slice(0, raw.length - terminator.length).trim();
  }
  return raw.trim();
}

/**
 * Parse CAS frame with 7E1 profile and explicit terminator handling.
 */
export function parseCasFrame(
  raw: string,
  connection: ScaleConnectionDraft,
): NormalizedScaleReading | null {
  const frame = stripTerminator(raw, connection);
  if (!frame) return null;
  const match = frame.match(
    /^(ST|US|MOT|UNST)?\s*,?\s*(GS|NT)?\s*,?\s*([+-]?\d[\d\s]*(?:[.,]\d+)?)\s*(kg|g|t|lb|kn|n)?$/i,
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
