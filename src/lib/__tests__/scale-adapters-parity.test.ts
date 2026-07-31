import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScaleConnectionDraft } from '../scale-adapters/contract';
import { parseReading } from '../scale-adapters/registry';

type BuiltinFixtureCase = {
  name: string;
  adapter_id: 'microsim-m0601' | 'newton' | 'cas' | 'midl-mi-vda';
  connection: ScaleConnectionDraft;
  raw: string;
  expected: {
    value: number;
    stable: boolean;
    raw: string;
    unit: string;
    negative: boolean;
  };
};

type GenericRegexFixtureCase = {
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

function loadJson<T>(relativePath: string): T {
  const currentDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const fixturePath = resolve(currentDir, relativePath);
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as T;
}

describe('scale adapters parity fixtures', () => {
  it('TC-UNIT-01: built-in adapters keep expected normalized readings', () => {
    const payload = loadJson<{ cases: BuiltinFixtureCase[] }>(
      '../../../tests/fixtures/scale-adapters/builtin-readings.json',
    );
    for (const testCase of payload.cases) {
      const actual = parseReading(testCase.adapter_id, testCase.raw, testCase.connection);
      expect(actual, testCase.name).toEqual(testCase.expected);
    }
  });

  it('TC-E2E-04: generic-regex fixtures keep expected runtime behavior', () => {
    const payload = loadJson<{ cases: GenericRegexFixtureCase[] }>(
      '../../../tests/fixtures/scale-adapters/generic-regex.json',
    );
    for (const testCase of payload.cases) {
      const actual = parseReading(testCase.adapter_id, testCase.raw, testCase.connection);
      if (testCase.expected === null) {
        expect(actual, testCase.name).toBeNull();
      } else {
        expect(actual, testCase.name).toMatchObject(testCase.expected);
      }
    }
  });
});
