import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => {
  const debug = vi.fn();
  return {
    logger: {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

describe('apiPost credential redaction', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  it('does not pass raw passwords into debug logs', async () => {
    const { logger } = await import('../logger');
    const { apiPost } = await import('../api');

    await apiPost('/api/vescom/weighing_data', {
      date: '2026-07-29',
      db_path: 'X:/vescom.fdb',
      password: 'masterkey-secret',
      access_key: 'reo-secret',
    });

    expect(logger.debug).toHaveBeenCalled();
    const logged = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(logged.password).toBe('[redacted]');
    expect(logged.access_key).toBe('[redacted]');
    expect(logged.db_path).toBe('X:/vescom.fdb');
  });
});
