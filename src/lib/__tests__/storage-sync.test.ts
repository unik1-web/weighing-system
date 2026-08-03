import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createMemoryLocalStorage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

describe('storage-sync pause/resume and apply', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', createMemoryLocalStorage());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({}),
      })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('applyStorageData only writes app_ string values', async () => {
    const { applyStorageData } = await import('../storage-sync');
    applyStorageData({
      app_users: '[]',
      other_key: 'nope',
      // @ts-expect-error intentional non-string value
      app_bad: 123,
    });

    expect(localStorage.getItem('app_users')).toBe('[]');
    expect(localStorage.getItem('other_key')).toBeNull();
    expect(localStorage.getItem('app_bad')).toBeNull();
  });

  it('queues database sync while paused and flushes after resume', async () => {
    localStorage.setItem('app_weighing_tickets', '[]');
    localStorage.setItem('app_settings', JSON.stringify({ org_name: 'Полигон' }));

    const {
      pauseDatabaseSync,
      resumeDatabaseSync,
      scheduleDatabaseSync,
    } = await import('../storage-sync');

    pauseDatabaseSync();
    scheduleDatabaseSync();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();

    resumeDatabaseSync();
    await vi.advanceTimersByTimeAsync(400);

    expect(fetch).toHaveBeenCalledWith(
      '/api/database',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: { app_weighing_tickets: '[]' } }),
      }),
    );
  });
});
