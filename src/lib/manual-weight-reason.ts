import type { WeightSource } from './weight-source';

export type ManualWeightReasonMode = 'off' | 'optional' | 'required';

export const MANUAL_WEIGHT_REASON_MODE_LABELS: Record<ManualWeightReasonMode, string> = {
  off: 'Выкл. (не показывать)',
  optional: 'Необязательно',
  required: 'Обязательно при ручном вводе',
};

export function normalizeManualWeightReasonMode(raw: unknown): ManualWeightReasonMode {
  if (raw === 'off' || raw === 'optional' || raw === 'required') return raw;
  return 'optional';
}

export interface ManualWeightReasonInput {
  mode: ManualWeightReasonMode;
  reason: string | null | undefined;
  gross_source: WeightSource;
  tare_source: WeightSource;
  gross_weight: number | null | undefined;
  tare_weight: number | null | undefined;
}

export interface ManualWeightReasonValidation {
  ok: boolean;
  /** Normalized reason to persist (null when off or empty optional). */
  reason: string | null;
  error: string | null;
}

function hasManualWeight(
  source: WeightSource,
  weight: number | null | undefined,
): boolean {
  return source === 'manual' && weight != null && Number.isFinite(weight);
}

/**
 * Validate and normalize manual_weight_reason for ticket save/complete.
 */
export function validateManualWeightReason(
  input: ManualWeightReasonInput,
): ManualWeightReasonValidation {
  const mode = normalizeManualWeightReasonMode(input.mode);
  if (mode === 'off') {
    return { ok: true, reason: null, error: null };
  }

  const trimmed = (input.reason ?? '').trim();
  const needsReason =
    hasManualWeight(input.gross_source, input.gross_weight) ||
    hasManualWeight(input.tare_source, input.tare_weight);

  if (mode === 'required' && needsReason && !trimmed) {
    return {
      ok: false,
      reason: null,
      error: 'Укажите причину ручного ввода веса',
    };
  }

  return {
    ok: true,
    reason: trimmed || null,
    error: null,
  };
}
