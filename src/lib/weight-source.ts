/** Domain helpers for weighing weight sources (instrument / manual / dictionary / default). */

export type WeightSource = 'instrument' | 'manual' | 'dictionary' | 'default';

export const WEIGHT_SOURCES: readonly WeightSource[] = [
  'instrument',
  'manual',
  'dictionary',
  'default',
] as const;

export const WEIGHT_SOURCE_LABELS: Record<WeightSource, string> = {
  instrument: 'Прибор',
  manual: 'Вручную',
  dictionary: 'Справочник',
  default: 'По умолчанию',
};

const WEIGHT_SOURCE_SET = new Set<string>(WEIGHT_SOURCES);

export function isWeightSource(raw: unknown): raw is WeightSource {
  return typeof raw === 'string' && WEIGHT_SOURCE_SET.has(raw);
}

/** Soft-read: known literal as-is; null/empty/unknown → manual. */
export function normalizeWeightSource(raw: unknown): WeightSource {
  if (isWeightSource(raw)) return raw;
  return 'manual';
}

export interface TareAutofillResult {
  tare_weight: number;
  tare_source: 'dictionary' | 'default';
}

/**
 * Resolve tare autofill from vehicle card or tara_default.
 * Caller must already guard shouldAutofillTare / blocked / empty tare.
 */
export function resolveTareAutofill(args: {
  defaultTareWeight: number | null | undefined;
  taraDefault: number;
}): TareAutofillResult | null {
  if (args.defaultTareWeight != null) {
    return { tare_weight: args.defaultTareWeight, tare_source: 'dictionary' };
  }
  if (args.taraDefault > 0) {
    return { tare_weight: args.taraDefault, tare_source: 'default' };
  }
  return null;
}

/** OR match on gross_source / tare_source; empty selected → no restriction. */
export function ticketMatchesWeightSources(
  ticket: { gross_source?: unknown; tare_source?: unknown },
  selected: readonly WeightSource[],
): boolean {
  if (selected.length === 0) return true;
  const gross = normalizeWeightSource(ticket.gross_source);
  const tare = normalizeWeightSource(ticket.tare_source);
  return selected.includes(gross) || selected.includes(tare);
}

export interface SourceCountRow {
  source: WeightSource;
  label: string;
  gross: number;
  tare: number;
  total: number;
}

/** Count source applications on filled weights only (gross/tare independently). */
export function countWeightSources(
  tickets: Array<{
    gross_weight: number | null;
    tare_weight: number | null;
    gross_source?: unknown;
    tare_source?: unknown;
  }>,
): SourceCountRow[] {
  const counts: Record<WeightSource, { gross: number; tare: number }> = {
    instrument: { gross: 0, tare: 0 },
    manual: { gross: 0, tare: 0 },
    dictionary: { gross: 0, tare: 0 },
    default: { gross: 0, tare: 0 },
  };

  for (const ticket of tickets) {
    if (ticket.gross_weight != null) {
      counts[normalizeWeightSource(ticket.gross_source)].gross += 1;
    }
    if (ticket.tare_weight != null) {
      counts[normalizeWeightSource(ticket.tare_source)].tare += 1;
    }
  }

  return WEIGHT_SOURCES.map((source) => {
    const { gross, tare } = counts[source];
    return {
      source,
      label: WEIGHT_SOURCE_LABELS[source],
      gross,
      tare,
      total: gross + tare,
    };
  });
}
