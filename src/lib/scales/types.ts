/** Scale adapter / transport / reading types (roadmap stage 5). */

export interface ScaleReading {
  weight: number;
  unit: string;
  stable: boolean;
  negative: boolean;
  raw: string;
}

export type ScaleAdapterId =
  | 'microsim-m0601'
  | 'newton'
  | 'cas'
  | 'midl-mi-vda'
  | 'custom';

/** Alias for compatibility with stages 1–4. */
export type ScaleDeviceId = ScaleAdapterId;

export type ScaleTransportKind = 'web_serial' | 'serial' | 'tcp';

export interface ScaleConnectionProfile {
  transport?: ScaleTransportKind;
  baudRate: number;
  parity: 'none' | 'even' | 'odd';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  lineTerminator: string;
  parseRegex?: string;
  parseStableGroup?: string;
  parseUnitGroup?: string;
  parseSignGroup?: string;
  parseMask?: string;
  host?: string;
  tcpPort?: number;
  serialPath?: string;
}

export interface ScaleAdapter {
  readonly id: ScaleAdapterId;
  readonly name: string;
  defaultConnection(): ScaleConnectionProfile;
  parseFrame(line: string, connection: ScaleConnectionProfile): ScaleReading | null;
}

/** Legacy shape used by SCALE_DEVICES map (framing fields only). */
export interface ScaleDeviceConfig {
  id: ScaleDeviceId;
  name: string;
  baudRate: number;
  parity: 'none' | 'even' | 'odd';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  lineTerminator: string;
}

export interface ScaleSession {
  connect(adapterId: ScaleAdapterId, connection: ScaleConnectionProfile): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getLastReading(): ScaleReading | null;
  getAdapterId(): ScaleAdapterId | null;
  getAdapterName(): string;
  onReading(cb: (r: ScaleReading) => void): () => void;
  onStatusChange(cb: (connected: boolean) => void): () => void;
  onError(cb: (message: string) => void): () => void;
}
