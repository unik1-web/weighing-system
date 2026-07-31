import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScaleConnectionDraft } from '../scale-adapters/contract';
import { parseCasFrame } from '../scale-adapters/builtin/cas';
import { parseMidlMiVdaFrame } from '../scale-adapters/builtin/midl-mi-vda';
import { parseMicrosimFrame } from '../scale-adapters/builtin/microsim-m0601';
import { parseNewtonFrame } from '../scale-adapters/builtin/newton';
import { parseReading } from '../scale-adapters/registry';

type FixtureCase = {
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

function loadBuiltinFixtures(): FixtureCase[] {
  const currentDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const fixturePath = resolve(
    currentDir,
    '../../../tests/fixtures/scale-adapters/builtin-readings.json',
  );
  const payload = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { cases: FixtureCase[] };
  return payload.cases;
}

describe('built-in scale adapters', () => {
  const cases = loadBuiltinFixtures();
  const parserByAdapter = {
    'microsim-m0601': parseMicrosimFrame,
    newton: parseNewtonFrame,
    cas: parseCasFrame,
    'midl-mi-vda': parseMidlMiVdaFrame,
  } as const;

  it('TC-UNIT-01: each built-in parser extracts value and stable', () => {
    for (const testCase of cases) {
      const parser = parserByAdapter[testCase.adapter_id];
      const actual = parser(testCase.raw, testCase.connection);
      expect(actual, testCase.name).toEqual(testCase.expected);
    }
  });

  it('TC-E2E-03: registry path preserves built-in reading behavior', () => {
    for (const testCase of cases) {
      const actual = parseReading(testCase.adapter_id, testCase.raw, testCase.connection);
      expect(actual, testCase.name).toEqual(testCase.expected);
    }
  });
});
