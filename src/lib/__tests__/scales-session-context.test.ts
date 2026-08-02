import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStorage, ScalesStorage } from '../storage';
import {
  ensureSiteMigrated,
  getActiveScaleContext,
  connectionFromDevice,
  normalizeScaleConnection,
  upsertScale,
  enableSpareScale,
  switchScaleSet,
} from '../site-runtime';
import { getAdapter, SCALE_DEVICES } from '../scales';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
  });
}

installLocalStorage();

beforeEach(() => {
  localStorage.clear();
});

describe('active scale context → adapter/connection', () => {
  it('connectionFromDevice includes transport web_serial', () => {
    const c = connectionFromDevice('cas');
    expect(c.transport).toBe('web_serial');
    expect(c.parity).toBe('even');
    expect(c.dataBits).toBe(7);
  });

  it('custom adapter defaults empty parse fields', () => {
    const adapter = getAdapter('custom');
    expect(adapter.name).toBe('Произвольный разбор');
    const c = adapter.defaultConnection();
    expect(c.parseRegex).toBe('');
    expect(SCALE_DEVICES.custom).toBeDefined();
  });

  it('getActiveScaleContext returns adapter_id and connection from active scale', () => {
    SettingsStorage.updateAppSettings({ scale_device_id: 'newton' });
    ensureSiteMigrated();
    const ctx = getActiveScaleContext();
    expect(ctx.adapter_id).toBe('newton');
    expect(ctx.activeScale.connection.lineTerminator).toBe('\r\n');
  });

  it('normalizeScaleConnection fills missing transport', () => {
    const n = normalizeScaleConnection('microsim-m0601', {
      baudRate: 9600,
      parity: 'none',
      dataBits: 8,
      stopBits: 1,
      lineTerminator: '\r',
    });
    expect(n.transport).toBe('web_serial');
  });

  it('switch to spare uses spare adapter connection', () => {
    ensureSiteMigrated();
    enableSpareScale({ adapter_id: 'cas' });
    const spare = ScalesStorage.getAll().find((s) => s.role === 'spare')!;
    upsertScale({
      ...spare,
      connection: {
        ...connectionFromDevice('cas'),
        transport: 'tcp',
        host: '10.0.0.1',
        tcpPort: 9002,
      },
    });
    switchScaleSet({
      to: 'spare',
      reason: 'repair',
      operator_id: null,
      operator_name: 'Оператор',
      camera_ack: 'no_cameras',
    });
    const ctx = getActiveScaleContext();
    expect(ctx.adapter_id).toBe('cas');
    expect(ctx.activeScale.connection.transport).toBe('tcp');
    expect(ctx.activeScale.connection.tcpPort).toBe(9002);
  });
});
