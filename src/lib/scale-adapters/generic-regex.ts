import type {
  GenericRegexValidationResult,
  NormalizedScaleReading,
  ScaleConnectionDraft,
  ValidationErrorCode,
  ValidationStatus,
} from './contract';

const REGEX_PATTERN_MAX_LENGTH = 512;
const REGEX_TEST_FRAME_MAX_LENGTH = 4096;
const REGEX_RUNTIME_FRAME_MAX_LENGTH = 1024;
const ALLOWED_FLAGS = new Set(['i', 'm', 's']);

function nowIso(): string {
  return new Date().toISOString();
}

function ensureParser(connection: ScaleConnectionDraft): NonNullable<ScaleConnectionDraft['parser']> {
  if (!connection.parser) {
    connection.parser = { kind: 'regex' };
  }
  return connection.parser;
}

function buildResult(
  status: ValidationStatus,
  options?: {
    valid?: boolean;
    code?: ValidationErrorCode;
    message?: string;
    preview?: NormalizedScaleReading | null;
  },
): GenericRegexValidationResult {
  return {
    valid:
      options?.valid ??
      (status === 'preview_validated' || status === 'pending_runtime'),
    validation_status: status,
    validation_error_code: options?.code ?? null,
    validation_error_message: options?.message ?? null,
    preview_reading: options?.preview ?? null,
  };
}

function updateParserValidationState(
  connection: ScaleConnectionDraft,
  result: GenericRegexValidationResult,
): void {
  const parser = ensureParser(connection);
  parser.validation_status = result.validation_status;
  parser.validation_error_code = result.validation_error_code;
  parser.validation_error_message = result.validation_error_message;
  parser.last_validation_at = nowIso();
}

export function applyGenericRegexValidationResult(
  connection: ScaleConnectionDraft,
  result: GenericRegexValidationResult,
): void {
  updateParserValidationState(connection, result);
}

function hasNonPortableConstructs(pattern: string): boolean {
  const checks = [
    /(?<!\\)\(\?<[=!]/, // lookbehind (?<= / (?<!)
    /(?<!\\)\(\?<[^=!]/, // named group (?<name>)
    /(?<!\\)\(\?P</, // python named group
    /(?<!\\)\(\?P=/, // python named backreference
    /(?<!\\)\\k</, // js named backreference
    /(?<!\\)\\[1-9]/, // numeric backreference
    /(?<!\\)\(\?\(/, // conditional pattern
    /(?<!\\)\(\?>/, // atomic group
  ];
  return checks.some((rule) => rule.test(pattern));
}

function hasValidFlags(rawFlags: string): boolean {
  if (!rawFlags) return true;
  const seen = new Set<string>();
  for (const flag of rawFlags) {
    if (!ALLOWED_FLAGS.has(flag) || seen.has(flag)) {
      return false;
    }
    seen.add(flag);
  }
  return true;
}

function countCapturingGroups(pattern: string): number {
  let count = 0;
  let escaped = false;
  let inCharClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[' && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === ']' && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (inCharClass) {
      continue;
    }
    if (char !== '(') {
      continue;
    }
    const next = pattern[index + 1];
    if (next === '?') {
      continue;
    }
    count += 1;
  }
  return count;
}

function toNumericWeight(rawWeight: string): number | null {
  const normalized = rawWeight.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRegexFlags(flags: string): string {
  return Array.from(new Set(flags.split('')))
    .filter((flag) => ALLOWED_FLAGS.has(flag))
    .join('');
}

function parseFrameInternal(
  raw: string,
  connection: ScaleConnectionDraft,
): NormalizedScaleReading | null {
  const parser = connection.parser;
  if (!parser?.pattern) return null;
  const flags = typeof parser.flags === 'string' ? toRegexFlags(parser.flags) : '';
  const weightGroup = parser.weight_group ?? 1;
  const stabilityGroup = parser.stability_group ?? null;
  const unitGroup = parser.unit_group ?? null;
  const stableValues = new Set((parser.stable_values ?? ['ST']).map((value) => value.toUpperCase()));
  const unstableValues = new Set((parser.unstable_values ?? ['US']).map((value) => value.toUpperCase()));

  let expression: RegExp;
  try {
    expression = new RegExp(parser.pattern, flags);
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  const match = expression.exec(trimmed);
  if (!match) return null;
  if (weightGroup <= 0 || weightGroup >= match.length) return null;

  const rawWeight = match[weightGroup];
  if (typeof rawWeight !== 'string' || !rawWeight.trim()) return null;
  const weight = toNumericWeight(rawWeight);
  if (weight === null) return null;

  let stable = true;
  if (stabilityGroup !== null && stabilityGroup !== undefined) {
    const stability = (match[stabilityGroup] ?? '').toUpperCase();
    if (unstableValues.has(stability)) {
      stable = false;
    } else if (stableValues.size > 0) {
      stable = stableValues.has(stability);
    }
  }

  const unit =
    unitGroup !== null && unitGroup !== undefined
      ? (match[unitGroup] ?? '').trim().toLowerCase() || undefined
      : undefined;

  return {
    value: weight,
    stable,
    raw: trimmed,
    unit,
    negative: weight < 0,
  };
}

function validateGroup(
  group: number | null | undefined,
  groupCount: number,
): boolean {
  if (group === null || group === undefined) return true;
  return Number.isInteger(group) && group > 0 && group <= groupCount;
}

export function validateGenericRegexDraft(
  connection: ScaleConnectionDraft,
  testFrame?: string | null,
): GenericRegexValidationResult {
  const parser = ensureParser(connection);
  const pattern = (parser.pattern ?? '').trim();
  const flags = (parser.flags ?? '').trim();
  const effectiveTestFrame =
    testFrame ?? (typeof parser.test_frame === 'string' ? parser.test_frame : null);

  if (!pattern) {
    return buildResult('runtime_failed', {
      valid: false,
      message: 'parser.pattern обязателен',
    });
  }
  if (pattern.length > REGEX_PATTERN_MAX_LENGTH) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_pattern_too_long',
      message: `Длина parser.pattern не должна превышать ${REGEX_PATTERN_MAX_LENGTH} символов`,
    });
  }
  if (!hasValidFlags(flags)) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_non_portable',
      message: 'Допустимы только флаги i, m, s без повторов',
    });
  }
  if (hasNonPortableConstructs(pattern)) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_non_portable',
      message: 'Regex содержит конструкции, несовместимые между JS и Python',
    });
  }

  let expression: RegExp;
  try {
    expression = new RegExp(pattern, toRegexFlags(flags));
  } catch (error) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_non_portable',
      message: error instanceof Error ? error.message : 'Некорректный regex',
    });
  }
  void expression;

  const groupCount = countCapturingGroups(pattern);
  const weightGroup = parser.weight_group ?? 1;
  if (!validateGroup(weightGroup, groupCount)) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_group_index_out_of_range',
      message: 'weight_group выходит за пределы capture-групп',
    });
  }
  if (!validateGroup(parser.stability_group, groupCount)) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_group_index_out_of_range',
      message: 'stability_group выходит за пределы capture-групп',
    });
  }
  if (!validateGroup(parser.unit_group, groupCount)) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_group_index_out_of_range',
      message: 'unit_group выходит за пределы capture-групп',
    });
  }

  if (effectiveTestFrame && effectiveTestFrame.length > REGEX_TEST_FRAME_MAX_LENGTH) {
    return buildResult('runtime_failed', {
      valid: false,
      code: 'regex_test_frame_too_large',
      message: `Длина test_frame не должна превышать ${REGEX_TEST_FRAME_MAX_LENGTH} символов`,
    });
  }

  if (!effectiveTestFrame) {
    return buildResult('pending_runtime');
  }

  const preview = parseFrameInternal(effectiveTestFrame, connection);
  if (!preview) {
    return buildResult('runtime_failed', {
      valid: false,
      message: 'test_frame не позволяет извлечь числовой вес',
    });
  }
  return buildResult('preview_validated', { preview });
}

export function parseGenericRegexReading(
  raw: string,
  connection: ScaleConnectionDraft,
): NormalizedScaleReading | null {
  const parser = ensureParser(connection);
  const frame = raw.trim();
  if (frame.length > REGEX_RUNTIME_FRAME_MAX_LENGTH) {
    parser.validation_status = 'runtime_failed';
    parser.validation_error_code = 'runtime_frame_too_large';
    parser.validation_error_message = `Длина runtime-кадра превышает ${REGEX_RUNTIME_FRAME_MAX_LENGTH} символов`;
    parser.last_validation_at = nowIso();
    return null;
  }

  const parsed = parseFrameInternal(frame, connection);
  if (!parsed) {
    parser.validation_status = 'runtime_failed';
    parser.validation_error_code = null;
    parser.validation_error_message = 'parse_mismatch';
    parser.last_validation_at = nowIso();
    return null;
  }

  parser.validation_status = 'runtime_validated';
  parser.validation_error_code = null;
  parser.validation_error_message = null;
  parser.last_validation_at = nowIso();
  return parsed;
}
