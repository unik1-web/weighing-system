import type { ScaleConnectionProfile, ScaleReading } from './types';

/**
 * Universal parser: extracts weight, sign, stability, and unit from
 * common indicator output formats. Handles Microsim, Newton, CAS, Midl.
 * Behavior matches the former ScaleConnection.parseFrame.
 */
export function parseUniversalFrame(raw: string): ScaleReading | null {
  const original = raw;
  let s = raw;
  let stable = true;
  let negative = false;
  const upper = s.toUpperCase();

  if (/\b(US|MOT|UNST)\b/i.test(upper.slice(0, 6))) {
    stable = false;
    s = s.replace(/^[A-Z]{2,3}\s*,?\s*/i, '');
  } else if (/\b(ST|STB|STABLE)\b/i.test(upper.slice(0, 8))) {
    stable = true;
    s = s.replace(/^[A-Z]{2,4}\s*,?\s*/i, '');
  }

  s = s.replace(/^(GS|NT|GROSS|NET)\s*,?\s*/i, '');

  if (s.includes('-')) {
    negative = true;
    s = s.replace('-', ' ');
  }
  s = s.replace(/\+/g, ' ').trim();

  let unit = 'kg';
  const unitMatch = s.match(/(kg|g|t|lb|kn|n)$/i);
  if (unitMatch) {
    unit = unitMatch[1].toLowerCase();
    s = s.slice(0, unitMatch.index).trim();
  }

  const numMatch = s.match(/-?\d[\d.,\s]*\d|\d/);
  if (!numMatch) return null;

  const numStr = numMatch[0].replace(/\s/g, '').replace(',', '.');
  const weight = parseFloat(numStr);
  if (isNaN(weight)) return null;

  return {
    weight: negative ? -Math.abs(weight) : weight,
    unit,
    stable,
    negative,
    raw: original,
  };
}

/** Compile custom regex; throws Error with Russian message on invalid pattern. */
export function compileParseRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Некорректное регулярное выражение: ${detail}`);
  }
}

/**
 * Mask: '#' = digit, '*' = optional digits, '.' = decimal separator,
 * other chars are literals. First numeric run → weight; stable=true by default.
 */
export function parseMaskFrame(raw: string, mask: string): ScaleReading | null {
  if (!mask.trim()) return null;
  let pattern = '';
  for (const ch of mask) {
    if (ch === '#') pattern += '\\d';
    else if (ch === '*') pattern += '\\d*';
    else if (ch === '.') pattern += '[.,]';
    else pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return null;
  }
  const m = raw.match(re);
  if (!m) return null;
  const numMatch = m[0].match(/-?\d[\d.,]*\d|-?\d/);
  if (!numMatch) return null;
  const numStr = numMatch[0].replace(',', '.');
  const weight = parseFloat(numStr);
  if (isNaN(weight)) return null;
  const negative = weight < 0;
  return {
    weight,
    unit: 'kg',
    stable: true,
    negative,
    raw,
  };
}

function groupValue(
  groups: Record<string, string> | undefined,
  name: string | undefined,
): string | undefined {
  if (!groups || !name) return undefined;
  const v = groups[name];
  return typeof v === 'string' ? v : undefined;
}

export function parseCustomFrame(
  raw: string,
  connection: ScaleConnectionProfile,
): ScaleReading | null {
  const regexSrc = connection.parseRegex?.trim() ?? '';
  const mask = connection.parseMask?.trim() ?? '';

  if (!regexSrc && !mask) {
    throw new Error('Задайте regex или маску разбора веса');
  }

  if (regexSrc) {
    const re = compileParseRegex(regexSrc);
    const m = raw.match(re);
    if (!m) return null;
    const groups = (m.groups ?? {}) as Record<string, string>;
    const weightRaw = groups.weight ?? m[1];
    if (weightRaw == null || weightRaw === '') return null;
    const numStr = String(weightRaw).replace(/\s/g, '').replace(',', '.');
    let weight = parseFloat(numStr);
    if (isNaN(weight)) return null;

    const signGroup = connection.parseSignGroup
      ? groupValue(groups, connection.parseSignGroup)
      : groups.sign;
    let negative = weight < 0;
    if (signGroup != null && String(signGroup).includes('-')) {
      negative = true;
      weight = -Math.abs(weight);
    } else if (negative) {
      weight = -Math.abs(weight);
    }

    const unitGroup = connection.parseUnitGroup
      ? groupValue(groups, connection.parseUnitGroup)
      : groups.unit;
    const unit = (unitGroup || 'kg').toLowerCase();

    let stable = true;
    const stableGroup = connection.parseStableGroup
      ? groupValue(groups, connection.parseStableGroup)
      : groups.stable;
    if (stableGroup != null) {
      const u = String(stableGroup).toUpperCase();
      if (/\b(US|MOT|UNST|UNSTABLE)\b/.test(u) || u === 'US' || u === 'MOT') {
        stable = false;
      } else if (/\b(ST|STB|STABLE)\b/.test(u) || u === 'ST' || u === 'STB') {
        stable = true;
      } else if (u === '0' || u === 'false') {
        stable = false;
      }
    }

    return {
      weight: negative ? -Math.abs(weight) : Math.abs(weight),
      unit,
      stable,
      negative,
      raw,
    };
  }

  return parseMaskFrame(raw, mask);
}

/** Validate custom connection parse config at connect time. */
export function validateCustomParseConfig(connection: ScaleConnectionProfile): void {
  const regexSrc = connection.parseRegex?.trim() ?? '';
  const mask = connection.parseMask?.trim() ?? '';
  if (!regexSrc && !mask) {
    throw new Error('Задайте regex или маску разбора веса');
  }
  if (regexSrc) {
    compileParseRegex(regexSrc);
  }
}
