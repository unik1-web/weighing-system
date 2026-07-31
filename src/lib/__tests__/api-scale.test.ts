import { afterEach, describe, expect, it, vi } from 'vitest';

import { scaleConnect, scaleDisconnect, scaleRead, scaleStatus } from '../api';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

installLocalStorage();

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('scale api client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-UNIT-03: parses success responses for connect/read/disconnect/status', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response({
          success: true,
          session_id: 's-1',
          status: 'connected',
          scale: {
            site_id: 'default-site',
            scale_id: 'scale-primary',
            scale_role: 'primary',
            adapter_id: 'stub-adapter',
            transport: 'serial_backend',
          },
          reading: null,
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          session_id: 's-1',
          status: 'reading',
          scale: {
            site_id: 'default-site',
            scale_id: 'scale-primary',
            scale_role: 'primary',
            adapter_id: 'stub-adapter',
            transport: 'serial_backend',
          },
          reading: {
            value: 12345,
            stable: true,
            raw: 'STUB 12345 kg',
            captured_at: '2026-07-31T00:00:00Z',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          session_id: 's-1',
          status: 'reading',
          reading: {
            value: 12345,
            stable: true,
            raw: 'STUB 12345 kg',
            captured_at: '2026-07-31T00:00:01Z',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          session_id: 's-1',
          status: 'disconnected',
        }),
      );

    const connect = await scaleConnect({
      expected_site_id: 'default-site',
      expected_scale_id: 'scale-primary',
      expected_scale_role: 'primary',
    });
    const status = await scaleStatus(connect.session_id);
    const read = await scaleRead({ session_id: connect.session_id, timeout_ms: 1000 });
    const disconnect = await scaleDisconnect(connect.session_id);

    expect(connect.status).toBe('connected');
    expect(status.status).toBe('reading');
    expect(read.reading.value).toBe(12345);
    expect(disconnect.status).toBe('disconnected');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns code+message on scale api errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(
        {
          success: false,
          code: 'session_not_found',
          message: 'Сессия не найдена',
        },
        false,
        404,
      ),
    );

    await expect(scaleStatus('missing')).rejects.toThrow('session_not_found: Сессия не найдена');
  });
});
