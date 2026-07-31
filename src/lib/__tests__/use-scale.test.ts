import { beforeEach, describe, expect, it, vi } from 'vitest';

const setReading = vi.fn();
const setConnected = vi.fn();
const setError = vi.fn();
const setManualOnly = vi.fn();
const setStatus = vi.fn();
const setTransport = vi.fn();

const runtimeClientMock = {
  connect: vi.fn(),
  read: vi.fn(),
  disconnect: vi.fn(),
  getStatus: vi.fn(() => ({ error: null })),
};

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T extends (...args: any[]) => any>(callback: T) => callback,
    useState: ((initial: unknown) => {
      if (!('count' in (globalThis as any))) {
        (globalThis as any).count = 0;
      }
      const index = (globalThis as any).count++;
      if (index === 0) return [initial, setReading];
      if (index === 1) return [false, setConnected];
      if (index === 2) return [null, setError];
      if (index === 3) return [false, setManualOnly];
      if (index === 4) return ['disconnected', setStatus];
      return [null, setTransport];
    }) as typeof actual.useState,
  };
});

vi.mock('@/lib/scale-runtime-client', () => {
  return {
    ScaleRuntimeClient: class {
      connect = runtimeClientMock.connect;
      read = runtimeClientMock.read;
      disconnect = runtimeClientMock.disconnect;
      getStatus = runtimeClientMock.getStatus;
    },
  };
});

describe('useScale', () => {
  beforeEach(() => {
    (globalThis as any).count = 0;
    setReading.mockReset();
    setConnected.mockReset();
    setError.mockReset();
    setManualOnly.mockReset();
    setStatus.mockReset();
    setTransport.mockReset();
    runtimeClientMock.connect.mockReset();
    runtimeClientMock.read.mockReset();
    runtimeClientMock.disconnect.mockReset();
    runtimeClientMock.getStatus.mockReset();
    runtimeClientMock.getStatus.mockReturnValue({ error: null });
  });

  it('TC-UNIT-02: updates state after connect -> read -> disconnect', async () => {
    const { useScale } = await import('@/hooks/useScale');
    runtimeClientMock.connect.mockResolvedValue({ mode: 'web_serial', status: 'connected' });
    runtimeClientMock.read.mockResolvedValue({
      value: 12345,
      stable: true,
      raw: 'STUB 12345 kg',
      captured_at: '2026-07-31T00:00:00Z',
    });
    runtimeClientMock.disconnect.mockResolvedValue(undefined);

    const hook = useScale();
    await hook.connect({
      id: 'scale-primary',
      site_id: 'default-site',
      role: 'primary',
      adapter_id: 'cas',
      connection: { transport: 'web_serial', device_id: 'cas' },
      created_at: '2026-07-31T00:00:00Z',
    });

    expect(setConnected).toHaveBeenCalledWith(true);
    expect(setStatus).toHaveBeenCalledWith('connected');
    expect(setReading).toHaveBeenCalledWith({
      weight: 12345,
      stable: true,
      raw: 'STUB 12345 kg',
      captured_at: '2026-07-31T00:00:00Z',
    });

    await hook.disconnect();
    expect(setConnected).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith('disconnected');
    expect(setReading).toHaveBeenCalledWith(null);
  });
});
