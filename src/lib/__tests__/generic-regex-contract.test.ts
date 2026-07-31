import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import type { ScaleConnectionDraft } from '../scale-adapters/contract';
import {
  parseGenericRegexReading,
  validateGenericRegexDraft,
} from '../scale-adapters/generic-regex';
import { previewScaleConnectionDraft } from '../scale-adapters/registry';

type GenericRegexFixture = {
  name: string;
  adapter_id: 'generic-regex';
  connection: ScaleConnectionDraft;
  raw: string;
  expected: {
    value: number;
    stable: boolean;
    raw: string;
  } | null;
};

function loadFixtureCases(): GenericRegexFixture[] {
  const currentDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const fixturePath = resolve(currentDir, '../../../tests/fixtures/scale-adapters/generic-regex.json');
  const payload = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { cases: GenericRegexFixture[] };
  return payload.cases;
}

describe('generic-regex portable contract', () => {
  it('TC-E2E-01: save with test_frame returns preview_validated', () => {
    const draft: ScaleConnectionDraft = {
      transport: 'serial_backend',
      device_id: null,
      parser: {
        kind: 'regex',
        pattern: '^(ST|US)\\s+(-?\\d+[\\.,]?\\d*)\\s*(kg)?$',
        flags: 'i',
        weight_group: 2,
        stability_group: 1,
        stable_values: ['ST'],
        unstable_values: ['US'],
        unit_group: 3,
        test_frame: 'ST 25340 kg',
      },
    };
    const preview = previewScaleConnectionDraft('generic-regex', draft, draft.parser?.test_frame);
    expect(preview?.valid).toBe(true);
    expect(preview?.validation_status).toBe('preview_validated');
    expect(preview?.preview_reading?.value).toBe(25340);
  });

  it('TC-E2E-02: save without test_frame returns pending_runtime', () => {
    const draft: ScaleConnectionDraft = {
      transport: 'serial_backend',
      device_id: null,
      parser: {
        kind: 'regex',
        pattern: '^(-?\\d+)$',
        flags: '',
        weight_group: 1,
      },
    };
    const result = validateGenericRegexDraft(draft);
    expect(result.valid).toBe(true);
    expect(result.validation_status).toBe('pending_runtime');
  });

  it('TC-E2E-03: runtime mismatch returns null and parse_mismatch', () => {
    const fixture = loadFixtureCases().find((item) => item.name === 'runtime-mismatch');
    if (!fixture) {
      throw new Error('runtime-mismatch fixture missing');
    }
    const parsed = parseGenericRegexReading(fixture.raw, fixture.connection);
    expect(parsed).toBeNull();
    expect(fixture.connection.parser?.validation_status).toBe('runtime_failed');
    expect(fixture.connection.parser?.validation_error_message).toBe('parse_mismatch');
  });

  it('TC-UNIT-01: non-portable regex is rejected', () => {
    const draft: ScaleConnectionDraft = {
      transport: 'serial_backend',
      device_id: null,
      parser: {
        kind: 'regex',
        pattern: '^(?<state>ST|US)\\s+(\\d+)$',
        flags: 'i',
        weight_group: 2,
      },
    };
    const result = validateGenericRegexDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.validation_error_code).toBe('regex_non_portable');
  });

  it('TC-UNIT-02: frontend limits return canonical error codes', () => {
    const tooLongPattern: ScaleConnectionDraft = {
      transport: 'serial_backend',
      device_id: null,
      parser: {
        kind: 'regex',
        pattern: `^${'1'.repeat(513)}$`,
        weight_group: 1,
      },
    };
    const patternResult = validateGenericRegexDraft(tooLongPattern);
    expect(patternResult.validation_error_code).toBe('regex_pattern_too_long');

    const tooLargeFrame: ScaleConnectionDraft = {
      transport: 'serial_backend',
      device_id: null,
      parser: {
        kind: 'regex',
        pattern: '^(\\d+)$',
        weight_group: 1,
      },
    };
    const frameResult = validateGenericRegexDraft(tooLargeFrame, '1'.repeat(4097));
    expect(frameResult.validation_error_code).toBe('regex_test_frame_too_large');
  });

  it('TC-UNIT-03: runtime frame > 1024 is rejected before parse', () => {
    const draft: ScaleConnectionDraft = {
      transport: 'serial_backend',
      device_id: null,
      parser: {
        kind: 'regex',
        pattern: '^(\\d+)$',
        weight_group: 1,
      },
    };
    const parsed = parseGenericRegexReading('1'.repeat(1025), draft);
    expect(parsed).toBeNull();
    expect(draft.parser?.validation_error_code).toBe('runtime_frame_too_large');
    expect(draft.parser?.validation_status).toBe('runtime_failed');
  });
});
