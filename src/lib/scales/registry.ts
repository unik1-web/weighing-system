import { BUILTIN_ADAPTERS } from './adapters/builtins';
import { customAdapter } from './adapters/custom';
import type {
  ScaleAdapter,
  ScaleAdapterId,
  ScaleConnectionProfile,
  ScaleDeviceConfig,
  ScaleDeviceId,
} from './types';

const ALL: ScaleAdapter[] = [...BUILTIN_ADAPTERS, customAdapter];

export const ADAPTERS: Record<ScaleAdapterId, ScaleAdapter> = ALL.reduce(
  (acc, adapter) => {
    acc[adapter.id] = adapter;
    return acc;
  },
  {} as Record<ScaleAdapterId, ScaleAdapter>,
);

export const ADAPTER_LIST: ScaleAdapter[] = ALL;

export function getAdapter(id: ScaleAdapterId): ScaleAdapter {
  return ADAPTERS[id] ?? ADAPTERS['microsim-m0601'];
}

export function isScaleAdapterId(raw: unknown): raw is ScaleAdapterId {
  return typeof raw === 'string' && raw in ADAPTERS;
}

export function normalizeAdapterId(raw: unknown): ScaleAdapterId {
  if (isScaleAdapterId(raw)) return raw;
  return 'microsim-m0601';
}

/** Legacy SCALE_DEVICES map (includes custom for UI lists). */
export const SCALE_DEVICES: Record<ScaleDeviceId, ScaleDeviceConfig> = ALL.reduce(
  (acc, adapter) => {
    const conn = adapter.defaultConnection();
    acc[adapter.id] = {
      id: adapter.id,
      name: adapter.name,
      baudRate: conn.baudRate,
      parity: conn.parity,
      dataBits: conn.dataBits,
      stopBits: conn.stopBits,
      lineTerminator: conn.lineTerminator,
    };
    return acc;
  },
  {} as Record<ScaleDeviceId, ScaleDeviceConfig>,
);

export const SCALE_DEVICE_LIST = Object.values(SCALE_DEVICES);

export function connectionFromAdapter(id: ScaleAdapterId): ScaleConnectionProfile {
  return getAdapter(id).defaultConnection();
}
