// Multi-device scale abstraction via Web Serial API.
// Supports: Microsim M0601, Newton, CAS, Midl Mi VDA.

export interface ScaleReading {
  weight: number;
  unit: string;
  stable: boolean;
  negative: boolean;
  raw: string;
}

export type ScaleDeviceId = 'microsim-m0601' | 'newton' | 'cas' | 'midl-mi-vda';

export interface ScaleDeviceConfig {
  id: ScaleDeviceId;
  name: string;
  baudRate: number;
  parity: 'none' | 'even' | 'odd';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  // Frame terminator used to split the stream into lines
  lineTerminator: string;
}

export const SCALE_DEVICES: Record<ScaleDeviceId, ScaleDeviceConfig> = {
  'microsim-m0601': {
    id: 'microsim-m0601',
    name: 'Микросим М0601',
    baudRate: 9600,
    parity: 'none',
    dataBits: 8,
    stopBits: 1,
    lineTerminator: '\r',
  },
  'newton': {
    id: 'newton',
    name: 'Ньютон',
    baudRate: 9600,
    parity: 'none',
    dataBits: 8,
    stopBits: 1,
    lineTerminator: '\r\n',
  },
  'cas': {
    id: 'cas',
    name: 'CAS',
    baudRate: 9600,
    parity: 'even',
    dataBits: 7,
    stopBits: 1,
    lineTerminator: '\r\n',
  },
  'midl-mi-vda': {
    id: 'midl-mi-vda',
    name: 'Мидл Ми ВДА',
    baudRate: 9600,
    parity: 'none',
    dataBits: 8,
    stopBits: 1,
    lineTerminator: '\r\n',
  },
};

export const SCALE_DEVICE_LIST = Object.values(SCALE_DEVICES);

type ReadingListener = (reading: ScaleReading) => void;
type StatusListener = (connected: boolean) => void;

export class ScaleConnection {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private buffer = '';
  private readingListeners = new Set<ReadingListener>();
  private statusListeners = new Set<StatusListener>();
  private keepReading = false;
  private readLoopPromise: Promise<void> | null = null;
  private device: ScaleDeviceConfig | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  isConnected(): boolean {
    return this.port !== null;
  }

  getDeviceName(): string {
    return this.device?.name ?? '';
  }

  async connect(deviceId: ScaleDeviceId): Promise<void> {
    if (!ScaleConnection.isSupported()) {
      throw new Error('Web Serial API не поддерживается. Используйте Chrome или Edge.');
    }
    const config = SCALE_DEVICES[deviceId];
    this.device = config;
    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: config.baudRate,
      parity: config.parity,
      dataBits: config.dataBits,
      stopBits: config.stopBits,
    });
    this.keepReading = true;
    this.readLoopPromise = this.readLoop();
    this.emitStatus(true);
  }

  async disconnect(): Promise<void> {
    this.keepReading = false;
    if (this.reader) {
      await this.reader.cancel().catch(() => {});
      this.reader = null;
    }
    if (this.readLoopPromise) {
      await this.readLoopPromise.catch(() => {});
      this.readLoopPromise = null;
    }
    if (this.port) {
      try { await this.port.close(); } catch { /* ignore */ }
      this.port = null;
    }
    this.buffer = '';
    this.device = null;
    this.emitStatus(false);
  }

  onReading(listener: ReadingListener): () => void {
    this.readingListeners.add(listener);
    return () => this.readingListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.isConnected());
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(connected: boolean) {
    this.statusListeners.forEach((l) => l(connected));
  }

  private async readLoop(): Promise<void> {
    if (!this.port) return;
    this.reader = this.port.readable!.getReader();
    try {
      while (this.keepReading) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      /* port closed or error */
    } finally {
      try { this.reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  private processBuffer(): void {
    const term = this.device?.lineTerminator ?? '\r';
    let idx: number;
    while ((idx = this.buffer.indexOf(term)) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + term.length);
      if (line.length > 0) {
        const reading = this.parseFrame(line);
        if (reading) {
          this.readingListeners.forEach((l) => l(reading));
        }
      }
    }
  }

  // Universal parser: extracts weight, sign, stability, and unit from
  // common indicator output formats. Handles Microsim, Newton, CAS, Midl.
  parseFrame(raw: string): ScaleReading | null {
    const original = raw;
    let s = raw;
    let stable = true;
    let negative = false;
    const upper = s.toUpperCase();

    // Stability prefixes: ST (stable), US (unstable), STB, MOT, etc.
    if (/\b(US|MOT|UNST)\b/i.test(upper.slice(0, 6))) {
      stable = false;
      s = s.replace(/^[A-Z]{2,3}\s*,?\s*/i, '');
    } else if (/\b(ST|STB|STABLE)\b/i.test(upper.slice(0, 8))) {
      stable = true;
      s = s.replace(/^[A-Z]{2,4}\s*,?\s*/i, '');
    }

    // Mode prefixes (GS/NT/NT/GROSS/NET) — strip
    s = s.replace(/^(GS|NT|GROSS|NET)\s*,?\s*/i, '');

    // Sign
    if (s.includes('-')) {
      negative = true;
      s = s.replace('-', ' ');
    }
    s = s.replace(/\+/g, ' ').trim();

    // Unit detection
    let unit = 'kg';
    const unitMatch = s.match(/(kg|g|t|lb|kn|n)$/i);
    if (unitMatch) {
      unit = unitMatch[1].toLowerCase();
      s = s.slice(0, unitMatch.index).trim();
    }

    // Numeric extraction
    const numMatch = s.match(/-?\d[\d.,\s]*\d|\d/);
    if (!numMatch) return null;

    const numStr = numMatch[0].replace(/\s/g, '').replace(',', '.');
    const weight = parseFloat(numStr);
    if (isNaN(weight)) return null;

    return {
      weight: negative ? -Math.abs(weight) : weight,
      unit,
      stable,
      negative,
      raw: original,
    };
  }
}

export const scaleConnection = new ScaleConnection();
