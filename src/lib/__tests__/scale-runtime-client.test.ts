import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScaleRuntimeClient } from '../scale-runtime-client';

vi.mock('../api', () => {
  return {
    scaleConnect: vi.fn(),
    scaleRead: vi.fn(),
    scaleDisconnect: vi.fn(),
  };
});

const scaleConnectionMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(),
  onReading: vi.fn(),
}));

vi.mock('../scales', () => {
  return {
    scaleConnection: scaleConnectionMock,
  };
});

describe('ScaleRuntimeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scaleConnectionMock.isConnected.mockReturnValue(true);
    scaleConnectionMock.disconnect.mockResolvedValue(undefined);
    scaleConnectionMock.onReading.mockImplementation((listener: (reading: any) => void) => {
      listener({
        weight: 12345,
        stable: true,
        raw: 'ST 12345 kg',
      });
      return () => undefined;
    });
  });

  it('TC-UNIT-01: chooses web_serial and backend_api for configured scales', async () => {
    const { scaleConnect } = await import('../api');
    vi.mocked(scaleConnect).mockResolvedValue({
      success: true,
      session_id: 's-1',
      status: 'connected',
      scale: {
        site_id: 'default-site',
        scale_id: 'scale-spare',
        scale_role: 'spare',
        adapter_id: 'newton',
        transport: 'serial_backend',
      },
      reading: null,
    });

    const client = new ScaleRuntimeClient();
    const webSerialResult = await client.connect({
      id: 'scale-primary',
      site_id: 'default-site',
      role: 'primary',
      adapter_id: 'cas',
      connection: { transport: 'web_serial', device_id: 'cas' },
      created_at: '2026-07-31T00:00:00Z',
    });
    expect(webSerialResult).toEqual({ mode: 'web_serial', status: 'connected' });
    expect(scaleConnectionMock.connect).toHaveBeenCalledWith('cas');

    const backendResult = await client.connect({
      id: 'scale-spare',
      site_id: 'default-site',
      role: 'spare',
      adapter_id: 'newton',
      connection: { transport: 'serial_backend', device_id: 'newton' },
      created_at: '2026-07-31T00:00:00Z',
    });
    expect(backendResult).toEqual({ mode: 'backend_api', status: 'connected' });
  });

  it('TC-UNIT-02: unsupported_transport branch switches to manual_only', async () => {
    const { scaleConnect } = await import('../api');
    vi.mocked(scaleConnect).mockRejectedValue(
      new Error('unsupported_transport: Транспорт не поддерживается текущим релизом'),
    );

    const client = new ScaleRuntimeClient();
    const result = await client.connect({
      id: 'scale-spare',
      site_id: 'default-site',
      role: 'spare',
      adapter_id: 'newton',
      connection: { transport: 'serial_backend', device_id: 'newton' },
      created_at: '2026-07-31T00:00:00Z',
    });
    expect(result).toEqual({ mode: 'backend_api', status: 'manual_only' });
    expect(client.getStatus().error).toContain('unsupported_transport');
  });

  it('TC-UNIT-03: read_timeout branch switches to manual_only on read', async () => {
    const { scaleConnect, scaleRead } = await import('../api');
    vi.mocked(scaleConnect).mockResolvedValue({
      success: true,
      session_id: 's-1',
      status: 'connected',
      scale: {
        site_id: 'default-site',
        scale_id: 'scale-spare',
        scale_role: 'spare',
        adapter_id: 'newton',
        transport: 'serial_backend',
      },
      reading: null,
    });
    vi.mocked(scaleRead).mockRejectedValue(new Error('read_timeout: timeout'));

    const client = new ScaleRuntimeClient();
    await client.connect({
      id: 'scale-spare',
      site_id: 'default-site',
      role: 'spare',
      adapter_id: 'newton',
      connection: { transport: 'serial_backend', device_id: 'newton' },
      created_at: '2026-07-31T00:00:00Z',
    });

    const reading = await client.read(1000);
    expect(reading).toBeNull();
    expect(client.getStatus().status).toBe('manual_only');
    expect(client.getStatus().error).toContain('read_timeout');
  });

  it('TC-UNIT-04: transport_unavailable branch switches to manual_only', async () => {
    scaleConnectionMock.connect.mockRejectedValueOnce(new Error('port busy'));
    const client = new ScaleRuntimeClient();
    const result = await client.connect({
      id: 'scale-primary',
      site_id: 'default-site',
      role: 'primary',
      adapter_id: 'cas',
      connection: { transport: 'web_serial', device_id: 'cas' },
      created_at: '2026-07-31T00:00:00Z',
    });
    expect(result).toEqual({ mode: 'web_serial', status: 'manual_only' });
    expect(client.getStatus().error).toContain('transport_unavailable');
  });

  it('TC-UNIT-05: stale_session branch switches to manual_only', async () => {
    const { scaleConnect } = await import('../api');
    vi.mocked(scaleConnect).mockRejectedValue(
      new Error('stale_session: Сессия устарела после переключения комплекта.'),
    );

    const client = new ScaleRuntimeClient();
    const result = await client.connect({
      id: 'scale-spare',
      site_id: 'default-site',
      role: 'spare',
      adapter_id: 'newton',
      connection: { transport: 'serial_backend', device_id: 'newton' },
      created_at: '2026-07-31T00:00:00Z',
    });
    expect(result).toEqual({ mode: 'backend_api', status: 'manual_only' });
    expect(client.getStatus().error).toContain('stale_session');
  });

  it('reads web_serial through ScaleConnection listener', async () => {
    const client = new ScaleRuntimeClient();
    await client.connect({
      id: 'scale-primary',
      site_id: 'default-site',
      role: 'primary',
      adapter_id: 'cas',
      connection: { transport: 'web_serial', device_id: 'cas' },
      created_at: '2026-07-31T00:00:00Z',
    });

    const reading = await client.read(1000);
    expect(reading?.value).toBe(12345);
    expect(reading?.raw).toBe('ST 12345 kg');
    expect(client.getStatus().status).toBe('reading');
  });
});
