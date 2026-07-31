import {
  SCALE_ADAPTER_CATALOG,
  type AdapterCatalogEntry,
  type NormalizedScaleReading,
  type ScaleConnectionDraft,
  type ScaleTransport,
} from './contract';
import { parseCasFrame } from './builtin/cas';
import { parseMidlMiVdaFrame } from './builtin/midl-mi-vda';
import { parseMicrosimFrame } from './builtin/microsim-m0601';
import { parseNewtonFrame } from './builtin/newton';
import {
  applyGenericRegexValidationResult,
  parseGenericRegexReading,
  validateGenericRegexDraft,
} from './generic-regex';

export interface AdapterFieldSchema {
  transport_fields: string[];
  parser_fields: string[];
}

export interface DraftValidationResult {
  valid: boolean;
  errors: string[];
}

type AdapterParser = (
  raw: string,
  connection: ScaleConnectionDraft,
) => NormalizedScaleReading | null;

const BUILTIN_ADAPTER_IDS = new Set(['microsim-m0601', 'newton', 'cas', 'midl-mi-vda']);

const ADAPTER_PARSERS: Record<string, AdapterParser> = {
  'microsim-m0601': parseMicrosimFrame,
  newton: parseNewtonFrame,
  cas: parseCasFrame,
  'midl-mi-vda': parseMidlMiVdaFrame,
  'generic-regex': (raw, connection) => parseGenericRegexReading(raw, connection),
};

const SERIAL_FIELDS = [
  'serial.port',
  'serial.baud_rate',
  'serial.data_bits',
  'serial.stop_bits',
  'serial.parity',
  'serial.line_terminator',
  'serial.read_timeout_ms',
];

const TCP_FIELDS = ['tcp.host', 'tcp.port', 'tcp.connect_timeout_ms'];

const REGEX_FIELDS = [
  'parser.kind',
  'parser.pattern',
  'parser.flags',
  'parser.weight_group',
  'parser.stability_group',
  'parser.stable_values',
  'parser.unstable_values',
  'parser.unit_group',
  'parser.validation_status',
  'parser.last_validation_at',
  'parser.validation_error_code',
  'parser.validation_error_message',
];

function getCatalogEntry(adapterId: string): AdapterCatalogEntry {
  const adapter = SCALE_ADAPTER_CATALOG.adapters.find((item) => item.id === adapterId);
  if (!adapter) {
    throw new Error(`Unknown adapter_id: ${adapterId}`);
  }
  return adapter;
}

function getTransportFields(transport: ScaleTransport): string[] {
  if (transport === 'serial_backend') return SERIAL_FIELDS;
  if (transport === 'tcp_client') return TCP_FIELDS;
  return [];
}

export function listScaleAdapters(): {
  adapter_schema_version: string;
  adapters: AdapterCatalogEntry[];
} {
  return {
    adapter_schema_version: SCALE_ADAPTER_CATALOG.adapter_schema_version,
    adapters: SCALE_ADAPTER_CATALOG.adapters,
  };
}

export function getAdapterSchema(adapterId: string, transport: ScaleTransport): AdapterFieldSchema {
  const adapter = getCatalogEntry(adapterId);
  const parserFields = adapter.id === 'generic-regex' ? REGEX_FIELDS : ['parser.kind'];
  return {
    transport_fields: getTransportFields(transport),
    parser_fields: parserFields,
  };
}

export function validateScaleConnectionDraft(
  adapterId: string,
  draft: ScaleConnectionDraft,
): DraftValidationResult {
  const resolvedAdapterId = resolveAdapterId(adapterId, draft);
  const adapter = getCatalogEntry(resolvedAdapterId);
  const errors: string[] = [];
  if (!adapter.transports.includes(draft.transport)) {
    errors.push(`transport_not_supported:${draft.transport}`);
  }
  if (BUILTIN_ADAPTER_IDS.has(resolvedAdapterId)) {
    if (draft.device_id !== resolvedAdapterId) {
      errors.push(`device_id_mismatch:${resolvedAdapterId}`);
    }
    if (draft.transport !== 'web_serial' && draft.transport !== 'serial_backend') {
      errors.push(`transport_not_supported:${draft.transport}`);
    }
  }
  if (resolvedAdapterId === 'generic-regex') {
    const validation = validateGenericRegexDraft(draft, draft.parser?.test_frame ?? undefined);
    applyGenericRegexValidationResult(draft, validation);
    if (!validation.valid) {
      if (validation.validation_error_code) {
        errors.push(`validation_error_code:${validation.validation_error_code}`);
      }
      if (validation.validation_error_message) {
        errors.push(validation.validation_error_message);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function previewScaleConnectionDraft(
  adapterId: string,
  draft: ScaleConnectionDraft,
  testFrame?: string | null,
) {
  const resolvedAdapterId = resolveAdapterId(adapterId, draft);
  if (resolvedAdapterId !== 'generic-regex') {
    return null;
  }
  return validateGenericRegexDraft(draft, testFrame ?? draft.parser?.test_frame ?? undefined);
}

function resolveAdapterId(adapterId: string, connection: ScaleConnectionDraft): string {
  if (adapterId === 'web_serial' && connection.device_id) {
    return connection.device_id;
  }
  return adapterId;
}

export function parseReading(
  adapterId: string,
  raw: string,
  connection: ScaleConnectionDraft,
): NormalizedScaleReading | null {
  const resolvedAdapterId = resolveAdapterId(adapterId, connection);
  const parser = ADAPTER_PARSERS[resolvedAdapterId];
  if (!parser) {
    throw new Error(`No parser for adapter_id: ${resolvedAdapterId}`);
  }
  return parser(raw, connection);
}

/**
 * Backward-compatible alias used by stage-1 tests.
 */
export function parseScaleReadingStub(
  adapterId: string,
  draft: ScaleConnectionDraft,
  raw: string,
): NormalizedScaleReading {
  const parsed = parseReading(adapterId, raw, draft);
  if (!parsed) {
    throw new Error(`Unable to parse frame for adapter_id: ${adapterId}`);
  }
  return parsed;
}
