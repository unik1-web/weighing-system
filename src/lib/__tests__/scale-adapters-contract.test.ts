import { describe, expect, it } from 'vitest';

import {
  getAdapterSchema,
  listScaleAdapters,
  parseReading,
  validateScaleConnectionDraft,
} from '../scale-adapters/registry';

describe('scale adapters contract', () => {
  it('TC-E2E-01: listAdapters -> getSchema -> validateDraft -> parse', () => {
    const listed = listScaleAdapters();
    expect(listed.adapter_schema_version).toBeTruthy();

    const schema = getAdapterSchema('cas', 'web_serial');
    expect(schema.parser_fields).toContain('parser.kind');

    const draft = {
      transport: 'web_serial' as const,
      device_id: 'cas' as const,
    };
    const validation = validateScaleConnectionDraft('cas', draft);
    expect(validation.valid).toBe(true);

    const reading = parseReading('cas', 'ST,GS,+00045.0kg\r\n', {
      ...draft,
      serial: {
        port: null,
        baud_rate: null,
        data_bits: 7,
        stop_bits: 1,
        parity: 'even',
        line_terminator: '\r\n',
        read_timeout_ms: null,
      },
    });
    expect(reading).toEqual({
      value: 45,
      stable: true,
      raw: 'ST,GS,+00045.0kg',
      unit: 'kg',
      negative: false,
    });
  });

  it('TC-UNIT-01: catalog includes expected adapter ids', () => {
    const listed = listScaleAdapters();
    const ids = listed.adapters.map((adapter) => adapter.id).sort();
    expect(ids).toEqual(
      ['microsim-m0601', 'newton', 'cas', 'midl-mi-vda', 'generic-regex'].sort(),
    );
    expect(listed.adapter_schema_version).toBe('1.0');
  });

  it('TC-UNIT-02: generic-regex schema has parser and serial fields', () => {
    const schema = getAdapterSchema('generic-regex', 'serial_backend');
    expect(schema.transport_fields).toContain('serial.port');
    expect(schema.parser_fields).toContain('parser.pattern');
    expect(schema.parser_fields).toContain('parser.validation_status');
  });
});
