/** Domain helpers for single/dual weighing modes and weight source. */

import type { WeightSource } from './storage';

export type WeighingMode = 'single' | 'dual';
export type WeightPhase = 'gross' | 'tare';
/** Alias for WeightPhase (slot name). */
export type WeightSlot = WeightPhase;
export type OpenWeightState = 'zero' | 'one' | 'two';
/** Alias for OpenWeightState. */
export type OpenWeightClass = OpenWeightState;

/** Canonical WeightSource values (order used in UI summaries). */
export const WEIGHT_SOURCES: readonly WeightSource[] = [
  'manual',
  'instrument',
  'dictionary',
  'default',
] as const;

/** Russian labels for badges, journal filter, and reports. */
export const WEIGHT_SOURCE_LABELS: Record<WeightSource, string> = {
  instrument: 'ПРИБОР',
  manual: 'РУЧНОЙ',
  dictionary: 'СПРАВОЧНИК',
  default: 'ПО УМОЛЧАНИЮ',
};

/**
 * Normalizes a raw source string from ticket/DB.
 * Unknown / missing values map to `manual`.
 */
export function normalizeWeightSource(raw: string | null | undefined): WeightSource {
  if (raw === 'manual' || raw === 'instrument' || raw === 'dictionary' || raw === 'default') {
    return raw;
  }
  return 'manual';
}

/**
 * Journal filter predicate: ticket matches if gross OR tare equals source.
 * `all` always matches.
 */
export function ticketMatchesWeightSource(
  ticket: { gross_source?: string | null; tare_source?: string | null },
  source: WeightSource | 'all',
): boolean {
  if (source === 'all') return true;
  return (
    normalizeWeightSource(ticket.gross_source) === source ||
    normalizeWeightSource(ticket.tare_source) === source
  );
}

/**
 * Counts tickets by normalized gross_source and tare_source separately.
 */
export function summarizeWeightSources(
  tickets: Array<{ gross_source?: string | null; tare_source?: string | null }>,
): { gross: Record<WeightSource, number>; tare: Record<WeightSource, number> } {
  const gross: Record<WeightSource, number> = {
    manual: 0,
    instrument: 0,
    dictionary: 0,
    default: 0,
  };
  const tare: Record<WeightSource, number> = {
    manual: 0,
    instrument: 0,
    dictionary: 0,
    default: 0,
  };
  for (const ticket of tickets) {
    gross[normalizeWeightSource(ticket.gross_source)] += 1;
    tare[normalizeWeightSource(ticket.tare_source)] += 1;
  }
  return { gross, tare };
}

export type TareAutofillResult = {
  tareWeight: number;
  tareSource: 'dictionary' | 'default';
};

export interface ManualReasonRuleInput {
  policy: 'optional' | 'required';
  slotsOnStep: WeightSlot[];
  grossSource: WeightSource;
  tareSource: WeightSource;
}

/**
 * Resolves single-mode tare autofill from vehicle card or tara_default.
 * Returns null when autofill must not run (dual, locked, filled, no source).
 */
export function resolveTareAutofill(args: {
  allowed: boolean;
  locked: boolean;
  vehicleNumber: string;
  tareWeight: number | null;
  defaultTareWeight: number | null | undefined;
  taraDefault: number;
}): TareAutofillResult | null {
  if (!args.allowed) return null;
  if (args.locked) return null;
  if (!args.vehicleNumber || args.tareWeight != null) return null;
  if (args.defaultTareWeight != null) {
    return { tareWeight: args.defaultTareWeight, tareSource: 'dictionary' };
  }
  if (args.taraDefault > 0) {
    return { tareWeight: args.taraDefault, tareSource: 'default' };
  }
  return null;
}

export interface SlotEditability {
  grossEditable: boolean;
  tareEditable: boolean;
}

function isWeightPresent(value: number | null | undefined): boolean {
  return value != null && value > 0;
}

/**
 * Suggests capture phase by tara_threshold: weight ≤ threshold → tare, else gross.
 */
export function suggestPhase(weight: number, threshold: number): WeightPhase {
  return weight <= threshold ? 'tare' : 'gross';
}

/**
 * Returns true when interval between first and now exceeds maxHours.
 * maxHours ≤ 0 means "do not warn".
 */
export function isMaxTimeExceeded(firstIso: string, nowIso: string, maxHours: number): boolean {
  if (maxHours <= 0) return false;
  const first = Date.parse(firstIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(first) || Number.isNaN(now)) return false;
  return (now - first) / 3_600_000 > maxHours;
}

/** Alias for isMaxTimeExceeded. */
export const isMaxTimeBetweenExceeded = isMaxTimeExceeded;

/**
 * Fills weighing_mode only when the field is absent.
 * open → dual, otherwise → single. Existing value is kept.
 *
 * Stage-1 product rule: single mode always completes in one pass, so an
 * explicit open+single (e.g. after a sync that defaulted missing mode to
 * single) is treated as dual so incomplete tickets stay resumable.
 */
export function normalizeWeighingMode(ticket: {
  status: string;
  weighing_mode?: WeighingMode;
}): WeighingMode {
  if (ticket.status === 'open') {
    if (ticket.weighing_mode === undefined || ticket.weighing_mode === 'single') {
      return 'dual';
    }
    return ticket.weighing_mode;
  }
  if (ticket.weighing_mode !== undefined) return ticket.weighing_mode;
  return 'single';
}

/** Open dual tickets for the incomplete panel. */
export function filterIncompleteDual<T extends { status: string; weighing_mode?: WeighingMode }>(
  tickets: T[],
): T[] {
  return tickets.filter((t) => t.status === 'open' && normalizeWeighingMode(t) === 'dual');
}

export function netWeight(gross: number, tare: number): number {
  return Math.max(0, gross - tare);
}

export function totalAmount(net: number, price: number): number {
  return (net / 1000) * price;
}

/**
 * Autofill tare only in single mode and not during dual completion.
 */
export function shouldAutofillTare(
  modeOrOpts: WeighingMode | { mode: WeighingMode; completing?: boolean },
  completing = false,
): boolean {
  if (typeof modeOrOpts === 'object') {
    return modeOrOpts.mode === 'single' && !modeOrOpts.completing;
  }
  return modeOrOpts === 'single' && !completing;
}

/** Alias matching naming in the run brief. */
export const shouldAutoFillTare = shouldAutofillTare;

export function isCaptureAllowed(stable: boolean, stableMode: boolean): boolean {
  return stable || stableMode;
}

/**
 * Returns true when any weight saved on the current step has manual source.
 */
export function isManualWeightUsedOnCurrentStep(input: Omit<ManualReasonRuleInput, 'policy'>): boolean {
  const uniqueSlots = Array.from(new Set(input.slotsOnStep));
  for (const slot of uniqueSlots) {
    if (slot === 'gross' && input.grossSource === 'manual') {
      return true;
    }
    if (slot === 'tare' && input.tareSource === 'manual') {
      return true;
    }
  }
  return false;
}

/**
 * Checks if manual weight reason is mandatory on the current step.
 */
export function isManualWeightReasonRequiredOnCurrentStep(input: ManualReasonRuleInput): boolean {
  if (input.policy !== 'required') {
    return false;
  }
  return isManualWeightUsedOnCurrentStep(input);
}

/**
 * Classifies open-ticket weight slots: null/≤0 count as empty.
 */
export function classifyOpenWeightState(ticket: {
  gross_weight: number | null;
  tare_weight: number | null;
}): OpenWeightState {
  const count =
    (isWeightPresent(ticket.gross_weight) ? 1 : 0) + (isWeightPresent(ticket.tare_weight) ? 1 : 0);
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  return 'two';
}

/** Alias for classifyOpenWeightState. */
export function classifyOpenWeights(
  gross: number | null,
  tare: number | null,
): OpenWeightClass {
  return classifyOpenWeightState({ gross_weight: gross, tare_weight: tare });
}

/**
 * Slot editability for completion UI.
 * Prefer passing weights for state `one` so the filled slot is locked.
 */
export function slotEditability(
  state: OpenWeightState,
  weights?: { gross_weight: number | null; tare_weight: number | null },
): SlotEditability {
  if (state === 'zero') return { grossEditable: true, tareEditable: true };
  if (state === 'two') return { grossEditable: false, tareEditable: false };
  if (weights) {
    return {
      grossEditable: !isWeightPresent(weights.gross_weight),
      tareEditable: !isWeightPresent(weights.tare_weight),
    };
  }
  return { grossEditable: true, tareEditable: true };
}

/**
 * Empty slot for open-weight state `one` (the other slot is filled).
 * Returns null when not exactly one weight is present.
 */
export function emptySlotForOne(weights: {
  gross_weight: number | null;
  tare_weight: number | null;
}): WeightPhase | null {
  if (classifyOpenWeightState(weights) !== 'one') return null;
  return isWeightPresent(weights.gross_weight) ? 'tare' : 'gross';
}

/**
 * Resolves which weight slot instrument capture should write to.
 * Without override, if threshold points at a locked slot and the other is editable
 * (completion `one`), redirects to the empty slot. Explicit override on a locked
 * slot returns null.
 */
export function resolveCaptureSlot(args: {
  phaseOverride: boolean;
  overridePhase: WeightPhase;
  weight: number;
  threshold: number;
  editability?: SlotEditability;
  editableGross?: boolean;
  editableTare?: boolean;
}): WeightPhase | null {
  const editability: SlotEditability = args.editability ?? {
    grossEditable: args.editableGross ?? true,
    tareEditable: args.editableTare ?? true,
  };

  const target: WeightPhase = args.phaseOverride
    ? args.overridePhase
    : suggestPhase(args.weight, args.threshold);

  if (target === 'gross' && !editability.grossEditable) {
    if (!args.phaseOverride && editability.tareEditable) return 'tare';
    return null;
  }
  if (target === 'tare' && !editability.tareEditable) {
    if (!args.phaseOverride && editability.grossEditable) return 'gross';
    return null;
  }
  return target;
}

/**
 * Parses a weight input string: empty → null; "0" / 0 → 0.
 */
export function parseWeightInput(raw: string): number | null {
  if (raw === '') return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return n;
}

/** Datetime of the first filled weight slot, fallback created_at. */
export function firstWeightDatetime(ticket: {
  gross_weight: number | null;
  tare_weight: number | null;
  gross_datetime: string | null;
  tare_datetime: string | null;
  created_at: string;
}): string {
  if (isWeightPresent(ticket.gross_weight) && ticket.gross_datetime) {
    return ticket.gross_datetime;
  }
  if (isWeightPresent(ticket.tare_weight) && ticket.tare_datetime) {
    return ticket.tare_datetime;
  }
  if (ticket.gross_datetime) return ticket.gross_datetime;
  if (ticket.tare_datetime) return ticket.tare_datetime;
  return ticket.created_at;
}

/**
 * Validates single-mode complete: gross required; tare required (explicit 0 ok).
 * Returns Russian error message or null if ok.
 */
export function validateSingleComplete(args: {
  gross: number | null;
  tare: number | null;
}): string | null {
  if (args.gross == null || args.gross <= 0) return 'Введите брутто вес.';
  if (args.tare == null) return 'Для одиночного режима нужна тара.';
  return null;
}

/**
 * Validates dual first pass: exactly one weight > 0.
 */
export function validateDualFirstPass(args: {
  gross: number | null;
  tare: number | null;
}): string | null {
  const hasGross = isWeightPresent(args.gross);
  const hasTare = isWeightPresent(args.tare);
  if (!hasGross && !hasTare) {
    return 'Зафиксируйте вес первого прохода (значение больше 0).';
  }
  if (hasGross && hasTare) {
    return 'Оставьте ровно один вес либо переключитесь в одиночный режим.';
  }
  return null;
}

/**
 * Validates dual complete by open-weight class.
 */
export function validateDualComplete(args: {
  state: OpenWeightState;
  gross: number | null;
  tare: number | null;
}): string | null {
  const hasGross = isWeightPresent(args.gross);
  const hasTare = isWeightPresent(args.tare);
  if (args.state === 'two') {
    if (hasGross && hasTare) return null;
    return 'Для завершения нужны оба веса.';
  }
  if (args.state === 'zero') {
    if (hasGross && hasTare) return null;
    return 'Введите оба веса (больше 0) для завершения.';
  }
  // one: second weight must be > 0
  if (hasGross && hasTare) return null;
  return 'Введите второй вес (больше 0).';
}
