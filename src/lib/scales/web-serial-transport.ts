import type { ScaleConnectionProfile } from './types';

export type LineCallback = (line: string) => void;

/**
 * Browser Web Serial transport: open port, read stream, split by lineTerminator.
 */
export class WebSerialTransport {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private buffer = '';
  private keepReading = false;
  private readLoopPromise: Promise<void> | null = null;
  private lineTerminator = '\r';
  private onLine: LineCallback | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  isOpen(): boolean {
    return this.port !== null;
  }

  async open(connection: ScaleConnectionProfile, onLine: LineCallback): Promise<void> {
    if (!WebSerialTransport.isSupported()) {
      throw new Error('Web Serial API не поддерживается. Используйте Chrome или Edge.');
    }
    this.onLine = onLine;
    this.lineTerminator = connection.lineTerminator || '\r';
    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: connection.baudRate,
      parity: connection.parity,
      dataBits: connection.dataBits,
      stopBits: connection.stopBits,
    });
    this.keepReading = true;
    this.readLoopPromise = this.readLoop();
  }

  async close(): Promise<void> {
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
      try {
        await this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
    this.buffer = '';
    this.onLine = null;
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
      try {
        this.reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private processBuffer(): void {
    const term = this.lineTerminator;
    let idx: number;
    while ((idx = this.buffer.indexOf(term)) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + term.length);
      if (line.length > 0) {
        this.onLine?.(line);
      }
    }
  }
}
