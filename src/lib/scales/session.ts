import {
  connectBackendScale,
  disconnectBackendScale,
  fetchScaleReading,
} from './backend-client';
import { parseUniversalFrame, validateCustomParseConfig } from './parse';
import { getAdapter } from './registry';
import type {
  ScaleAdapterId,
  ScaleConnectionProfile,
  ScaleReading,
  ScaleSession,
  ScaleTransportKind,
} from './types';
import { WebSerialTransport } from './web-serial-transport';

type ReadingListener = (reading: ScaleReading) => void;
type StatusListener = (connected: boolean) => void;
type ErrorListener = (message: string) => void;

function resolveTransport(connection: ScaleConnectionProfile): ScaleTransportKind {
  return connection.transport ?? 'web_serial';
}

/**
 * Scale session: adapter parse + transport (Web Serial or backend poll).
 * Singleton exported as scaleConnection for compatibility.
 */
export class ScaleSessionImpl implements ScaleSession {
  private transport: WebSerialTransport | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private adapterId: ScaleAdapterId | null = null;
  private connection: ScaleConnectionProfile | null = null;
  private lastReading: ScaleReading | null = null;
  private connected = false;
  private readingListeners = new Set<ReadingListener>();
  private statusListeners = new Set<StatusListener>();
  private errorListeners = new Set<ErrorListener>();

  static isSupported(): boolean {
    return WebSerialTransport.isSupported();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLastReading(): ScaleReading | null {
    return this.lastReading;
  }

  getAdapterId(): ScaleAdapterId | null {
    return this.adapterId;
  }

  getAdapterName(): string {
    if (!this.adapterId) return '';
    return getAdapter(this.adapterId).name;
  }

  /** Legacy alias used by ScalePanel / useScale. */
  getDeviceName(): string {
    return this.getAdapterName();
  }

  async connect(
    adapterId: ScaleAdapterId,
    connection: ScaleConnectionProfile,
  ): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    if (adapterId === 'custom') {
      validateCustomParseConfig(connection);
    }

    const transportKind = resolveTransport(connection);
    this.adapterId = adapterId;
    this.connection = { ...connection, transport: transportKind };
    this.lastReading = null;

    if (transportKind === 'web_serial') {
      const web = new WebSerialTransport();
      this.transport = web;
      await web.open(connection, (line) => this.handleLine(line));
      this.setConnected(true);
      return;
    }

    try {
      await connectBackendScale({
        host: connection.host,
        tcpPort: connection.tcpPort,
        serialPath: connection.serialPath,
      });
    } catch (err) {
      this.adapterId = null;
      this.connection = null;
      throw err;
    }
    this.setConnected(true);
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    const wasBackend =
      this.connection != null &&
      resolveTransport(this.connection) !== 'web_serial' &&
      this.connected;
    if (wasBackend) {
      try {
        await disconnectBackendScale();
      } catch {
        /* best-effort */
      }
    }
    this.adapterId = null;
    this.connection = null;
    this.lastReading = null;
    this.setConnected(false);
  }

  onReading(listener: ReadingListener): () => void {
    this.readingListeners.add(listener);
    return () => {
      this.readingListeners.delete(listener);
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.isConnected());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private handleLine(line: string): void {
    if (!this.adapterId || !this.connection) return;
    const adapter = getAdapter(this.adapterId);
    try {
      const reading = adapter.parseFrame(line, this.connection);
      if (reading) {
        this.lastReading = reading;
        this.readingListeners.forEach((l) => l(reading));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorListeners.forEach((l) => l(message));
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, 250);
  }

  private stopPolling(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const res = await fetchScaleReading();
      if (!res.connected) {
        this.setConnected(false);
        this.stopPolling();
        return;
      }
      if (res.reading) {
        this.lastReading = res.reading;
        this.readingListeners.forEach((l) => l(res.reading!));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorListeners.forEach((l) => l(message));
    }
  }

  private setConnected(value: boolean): void {
    this.connected = value;
    this.statusListeners.forEach((l) => l(value));
  }
}

/**
 * Compatibility wrapper: accepts legacy `connect(deviceId)` or
 * `connect(adapterId, connection)`.
 */
export class ScaleConnection extends ScaleSessionImpl {
  override async connect(
    deviceIdOrAdapter: ScaleAdapterId,
    connection?: ScaleConnectionProfile,
  ): Promise<void> {
    if (connection != null) {
      return super.connect(deviceIdOrAdapter, connection);
    }
    const adapter = getAdapter(deviceIdOrAdapter);
    return super.connect(deviceIdOrAdapter, adapter.defaultConnection());
  }

  /** Expose universal parser for tests / legacy callers. */
  parseFrame(raw: string): ScaleReading | null {
    return parseUniversalFrame(raw);
  }
}

export const scaleConnection = new ScaleConnection();
