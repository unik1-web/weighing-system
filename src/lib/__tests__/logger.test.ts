import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';

const runtimeContext = {
  site_id: 'default-site',
  scale_id: 'scale-primary',
  scale_role: 'primary',
  adapter_id: 'cas',
  transport: 'serial_backend',
  session_id: 's-1',
  code: 'transport_unavailable',
  phase: 'read',
};

describe('logger scale runtime observability', () => {
  beforeEach(() => {
    logger.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T00:00:00Z'));
  });

  it('TC-UNIT-02: suppresses repeated runtime errors and emits aggregate counter', () => {
    logger.scaleRuntime.error('runtime transport unavailable', runtimeContext);
    vi.advanceTimersByTime(200);
    logger.scaleRuntime.error('runtime transport unavailable', runtimeContext);
    vi.advanceTimersByTime(900);
    logger.scaleRuntime.error('runtime transport unavailable', runtimeContext);

    const entries = logger
      .getEntries()
      .filter((entry) => entry.category === 'scale_runtime');
    expect(entries).toHaveLength(3);
    expect(entries[0].level).toBe('error');
    expect(entries[1].level).toBe('warn');
    expect(entries[1].message).toBe('Повтор runtime-ошибки подавлены debounce');
    expect(entries[1].details).toMatchObject({ suppressed_count: 1 });
    expect(entries[2].level).toBe('error');
  });

  it('TC-UNIT-03: redacts COM/TTY/IP in runtime logs', () => {
    logger.scaleRuntime.error('runtime probe', runtimeContext, {
      serial_port: 'COM3',
      tty_path: '/dev/ttyUSB0',
      ip_address: '192.168.1.10',
    });

    const entry = logger.getEntries().find((item) => item.category === 'scale_runtime');
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain('COM3');
    expect(JSON.stringify(entry)).not.toContain('/dev/ttyUSB0');
    expect(JSON.stringify(entry)).not.toContain('192.168.1.10');
    expect(JSON.stringify(entry)).toContain('COM***');
    expect(JSON.stringify(entry)).toContain('/dev/tty***');
    expect(JSON.stringify(entry)).toContain('***.***.***.***');
  });
});
