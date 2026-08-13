export type {
  ScaleReading,
  ScaleAdapterId,
  ScaleDeviceId,
  ScaleTransportKind,
  ScaleConnectionProfile,
  ScaleAdapter,
  ScaleDeviceConfig,
  ScaleSession,
} from './types';

export {
  parseUniversalFrame,
  parseCustomFrame,
  parseMaskFrame,
  compileParseRegex,
  validateCustomParseConfig,
} from './parse';

export {
  ADAPTERS,
  ADAPTER_LIST,
  SCALE_DEVICES,
  SCALE_DEVICE_LIST,
  getAdapter,
  isScaleAdapterId,
  normalizeAdapterId,
  connectionFromAdapter,
} from './registry';

export { WebSerialTransport } from './web-serial-transport';
export {
  fetchScaleContext,
  fetchScaleStatus,
  connectBackendScale,
  disconnectBackendScale,
  fetchScaleReading,
} from './backend-client';
export type {
  ScaleContextResponse,
  ScaleStatusResponse,
  ScaleReadingResponse,
} from './backend-client';

export { ScaleSessionImpl, ScaleConnection, scaleConnection } from './session';
