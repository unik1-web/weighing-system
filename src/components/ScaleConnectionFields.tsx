import { useMemo } from 'react';

import type { ScaleConnectionJson } from '@/lib/storage';
import type { ScaleTransport } from '@/lib/scale-adapters/contract';
import { previewScaleConnectionDraft } from '@/lib/scale-adapters/registry';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600';

interface Props {
  adapterId: string;
  connection: ScaleConnectionJson;
  onChange: (next: ScaleConnectionJson) => void;
}

function ensureParser(connection: ScaleConnectionJson) {
  return (
    connection.parser ?? {
      kind: 'regex' as const,
      pattern: '',
      flags: 'i',
      weight_group: 1,
      stability_group: null,
      stable_values: ['ST'],
      unstable_values: ['US'],
      unit_group: null,
      validation_status: 'pending_runtime' as const,
      last_validation_at: null,
      validation_error_code: null,
      validation_error_message: null,
      test_frame: null,
    }
  );
}

function updateSerialField(
  connection: ScaleConnectionJson,
  patch: Partial<NonNullable<ScaleConnectionJson['serial']>>,
): ScaleConnectionJson {
  const current = connection.serial ?? {
    port: null,
    baud_rate: 9600,
    data_bits: 8,
    stop_bits: 1,
    parity: 'none',
    line_terminator: '\r\n',
    read_timeout_ms: 1000,
  };
  return {
    ...connection,
    serial: {
      ...current,
      ...patch,
    },
  };
}

function normalizeStringList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalGroup(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function ScaleConnectionFields({ adapterId, connection, onChange }: Props) {
  const parser = ensureParser(connection);
  const preview = useMemo(() => {
    if (adapterId !== 'generic-regex') return null;
    return previewScaleConnectionDraft(adapterId, connection, parser.test_frame ?? null);
  }, [adapterId, connection, parser.test_frame]);

  const transport = connection.transport as ScaleTransport;

  return (
    <div className="space-y-3">
      {transport === 'serial_backend' && (
        <>
          <div>
            <label className={labelClass}>serial.port</label>
            <input
              value={connection.serial?.port ?? ''}
              onChange={(event) =>
                onChange(updateSerialField(connection, { port: event.target.value || null }))
              }
              placeholder="/dev/ttyUSB0 или COM3"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>serial.baud_rate</label>
            <input
              type="number"
              value={connection.serial?.baud_rate ?? 9600}
              onChange={(event) =>
                onChange(
                  updateSerialField(connection, {
                    baud_rate: Number(event.target.value) || 9600,
                  }),
                )
              }
              className={inputClass}
            />
          </div>
        </>
      )}

      {transport === 'tcp_client' && (
        <>
          <div>
            <label className={labelClass}>tcp.host</label>
            <input
              value={connection.tcp?.host ?? ''}
              onChange={(event) =>
                onChange({
                  ...connection,
                  tcp: {
                    host: event.target.value || null,
                    port: connection.tcp?.port ?? 502,
                    connect_timeout_ms: connection.tcp?.connect_timeout_ms ?? 1000,
                  },
                })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>tcp.port</label>
            <input
              type="number"
              value={connection.tcp?.port ?? 502}
              onChange={(event) =>
                onChange({
                  ...connection,
                  tcp: {
                    host: connection.tcp?.host ?? null,
                    port: Number(event.target.value) || 502,
                    connect_timeout_ms: connection.tcp?.connect_timeout_ms ?? 1000,
                  },
                })
              }
              className={inputClass}
            />
          </div>
        </>
      )}

      {adapterId === 'generic-regex' && (
        <>
          <div>
            <label className={labelClass}>pattern</label>
            <input
              value={parser.pattern ?? ''}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    pattern: event.target.value,
                  },
                })
              }
              placeholder="^(ST|US)\\s+(-?\\d+[\\.,]?\\d*)\\s*(kg)?$"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>flags</label>
            <input
              value={parser.flags ?? 'i'}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    flags: event.target.value,
                  },
                })
              }
              placeholder="i"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>weight_group</label>
            <input
              type="number"
              value={parser.weight_group ?? 1}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    weight_group: Number(event.target.value) || 1,
                  },
                })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>stability_group</label>
            <input
              type="number"
              value={parser.stability_group ?? ''}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    stability_group: parseOptionalGroup(event.target.value),
                  },
                })
              }
              placeholder="1"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>stable_values</label>
            <input
              value={(parser.stable_values ?? ['ST']).join(', ')}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    stable_values: normalizeStringList(event.target.value),
                  },
                })
              }
              placeholder="ST"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>unstable_values</label>
            <input
              value={(parser.unstable_values ?? ['US']).join(', ')}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    unstable_values: normalizeStringList(event.target.value),
                  },
                })
              }
              placeholder="US, MOT"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>unit_group</label>
            <input
              type="number"
              value={parser.unit_group ?? ''}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    unit_group: parseOptionalGroup(event.target.value),
                  },
                })
              }
              placeholder="3"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>test_frame</label>
            <textarea
              value={parser.test_frame ?? ''}
              onChange={(event) =>
                onChange({
                  ...connection,
                  parser: {
                    ...parser,
                    test_frame: event.target.value || null,
                  },
                })
              }
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>
          {preview && (
            <div
              className={
                preview.valid
                  ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'
                  : 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'
              }
            >
              {preview.valid && preview.validation_status === 'preview_validated' && preview.preview_reading && (
                <span>
                  preview_validated: вес {preview.preview_reading.value} ({preview.preview_reading.raw})
                </span>
              )}
              {preview.valid && preview.validation_status === 'pending_runtime' && (
                <span>pending_runtime: конфигурация сохранится после синтаксической проверки</span>
              )}
              {!preview.valid && (
                <span>
                  {preview.validation_error_code ?? 'validation_error'}: {preview.validation_error_message ?? 'Ошибка валидации'}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
