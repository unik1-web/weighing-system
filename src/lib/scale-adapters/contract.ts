import catalogJson from '../../../shared/scale-adapters/catalog.json';
import type { ScaleDeviceId } from '../scales';

export type ScaleTransport = 'web_serial' | 'serial_backend' | 'tcp_client';
export type ParserKind = 'preset' | 'regex';
export type ValidationStatus =
  | 'preview_validated'
  | 'pending_runtime'
  | 'runtime_validated'
  | 'runtime_failed';
export type ValidationErrorCode =
  | 'regex_pattern_too_long'
  | 'regex_test_frame_too_large'
  | 'regex_non_portable'
  | 'regex_group_index_out_of_range'
  | 'runtime_frame_too_large';

export type SerialParity = 'none' | 'even' | 'odd';

export interface SerialDraft {
  port: string | null;
  baud_rate: number | null;
  data_bits: 7 | 8 | null;
  stop_bits: 1 | 2 | null;
  parity: SerialParity | null;
  line_terminator: string | null;
  read_timeout_ms: number | null;
}

export interface TcpDraft {
  host: string | null;
  port: number | null;
  connect_timeout_ms: number | null;
}

export interface ParserDraft {
  kind: ParserKind | null;
  pattern?: string | null;
  flags?: string | null;
  weight_group?: number | null;
  stability_group?: number | null;
  stable_values?: string[] | null;
  unstable_values?: string[] | null;
  unit_group?: number | null;
  validation_status?: ValidationStatus | null;
  last_validation_at?: string | null;
  validation_error_code?: ValidationErrorCode | string | null;
  validation_error_message?: string | null;
  test_frame?: string | null;
}

export interface ScaleConnectionDraft {
  transport: ScaleTransport;
  device_id: ScaleDeviceId | null;
  serial?: SerialDraft;
  tcp?: TcpDraft;
  parser?: ParserDraft;
}

export interface NormalizedScaleReading {
  value: number;
  stable: boolean;
  raw: string;
  unit?: string;
  negative?: boolean;
}

export interface GenericRegexValidationResult {
  valid: boolean;
  validation_status: ValidationStatus;
  validation_error_code: ValidationErrorCode | null;
  validation_error_message: string | null;
  preview_reading: NormalizedScaleReading | null;
}

export interface AdapterCatalogTransport {
  label: string;
  supports_runtime: boolean;
}

export interface AdapterCatalogEntry {
  id: string;
  title: string;
  kind: 'builtin' | 'generic-regex';
  parser_kind: ParserKind;
  transports: ScaleTransport[];
}

export interface ScaleAdapterCatalog {
  adapter_schema_version: string;
  transports: Record<ScaleTransport, AdapterCatalogTransport>;
  adapters: AdapterCatalogEntry[];
}

export const SCALE_ADAPTER_CATALOG: ScaleAdapterCatalog = catalogJson as ScaleAdapterCatalog;
