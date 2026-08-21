import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CamerasStorage,
  TicketPhotosStorage,
  SettingsStorage,
  type Camera,
} from '../storage';
import {
  CAMERA_ROLE_LABELS,
  createCameraDraft,
  enforceMaxCameras,
  maskCameraUrl,
  photoUrl,
  saveReference,
  shouldShowCameraSettings,
  triggerCaptureAfterSave,
  upsertCamera,
} from '../cameras';

const flushMock = vi.fn(async () => {});
const pauseMock = vi.fn();
const resumeMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('../storage-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage-sync')>();
  return {
    ...actual,
    flushDatabaseSync: () => flushMock(),
    pauseDatabaseSync: () => pauseMock(),
    resumeDatabaseSync: () => resumeMock(),
  };
});

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    apiPost: (url: string, body?: unknown) => apiPostMock(url, body),
  };
});

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

describe('cameras domain', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('app_weighing_tickets', JSON.stringify([{ id: 't1' }]));
    flushMock.mockReset().mockResolvedValue(undefined);
    pauseMock.mockReset();
    resumeMock.mockReset();
    apiPostMock.mockReset();
  });

  it('enforces max 4 cameras per site', () => {
    const siteId = 'site-1';
    for (let i = 0; i < 4; i++) {
      upsertCamera(createCameraDraft(siteId, 'overview'));
    }
    expect(CamerasStorage.forSite(siteId)).toHaveLength(4);
    expect(enforceMaxCameras(siteId)).toBe(false);
    expect(() => upsertCamera(createCameraDraft(siteId, 'entry'))).toThrow(/Не более/);
  });

  it('soft-reads video_enabled default false', () => {
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(false);
    SettingsStorage.updateAppSettings({ video_enabled: true });
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(true);
  });

  it('merges ticket photos and builds photo URL', () => {
    TicketPhotosStorage.merge([
      {
        id: 'p1',
        ticket_id: 't1',
        phase: 'gross',
        camera_id: 'c1',
        camera_role: 'entry',
        relative_path: 'Photo/2026/08/02/t1_gross_entry.jpg',
        status: 'ok',
        error_message: null,
        camera_mode: 'normal',
        created_at: '2026-08-02T10:00:00',
      },
    ]);
    expect(TicketPhotosStorage.forTicket('t1')).toHaveLength(1);
    const url = photoUrl('Photo/2026/08/02/t1_gross_entry.jpg');
    expect(url).toContain('/api/cameras/photo');
    expect(url).toContain('path=Photo');
    expect(url).not.toContain('t=');
  });

  it('photoUrl adds cache-bust query when provided', () => {
    const url = photoUrl('Photo/refs/x_normal.jpg', 123);
    expect(url).toContain('/api/cameras/photo');
    expect(url).toContain('path=Photo%2Frefs%2Fx_normal.jpg');
    expect(url).toContain('t=123');
    expect(photoUrl('Photo/refs/x_normal.jpg')).not.toContain('t=');
    expect(photoUrl(null, 1)).toBeNull();
  });

  it('saveReference flushes sync then posts optional capture url', async () => {
    const camera: Camera = {
      ...createCameraDraft('site-1', 'overview'),
      id: 'cam-1',
      capture_url: 'http://cam/snap.jpg',
      reference_normal_path: 'Photo/refs/cam-1_normal.jpg',
    };
    apiPostMock.mockResolvedValue({ success: true, camera });
    const result = await saveReference('cam-1', 'normal', {
      captureUrl: 'http://cam/form.jpg',
      captureKind: 'http_snapshot',
    });
    expect(flushMock).toHaveBeenCalled();
    expect(apiPostMock).toHaveBeenCalledWith('/api/cameras/reference', {
      camera_id: 'cam-1',
      mode: 'normal',
      capture_url: 'http://cam/form.jpg',
      capture_kind: 'http_snapshot',
    });
    expect(flushMock.mock.invocationCallOrder[0]).toBeLessThan(
      apiPostMock.mock.invocationCallOrder[0],
    );
    expect(result.id).toBe('cam-1');
    expect(CamerasStorage.getAll().find((c) => c.id === 'cam-1')?.reference_normal_path).toBe(
      'Photo/refs/cam-1_normal.jpg',
    );
  });

  it('saveReference throws when camera payload missing', async () => {
    apiPostMock.mockResolvedValue({ success: true });
    await expect(saveReference('cam-x', 'spare')).rejects.toThrow(/Эталон не сохранён/);
  });

  it('shouldShowCameraSettings always shows the settings block', () => {
    expect(shouldShowCameraSettings(null, false)).toBe(true);
    expect(
      shouldShowCameraSettings(
        { success: true, capture_available: true, backends: [], video_enabled: false, photo_root: 'Photo' },
        false,
      ),
    ).toBe(true);
    expect(
      shouldShowCameraSettings(
        { success: false, capture_available: false, backends: [], video_enabled: false, photo_root: 'Photo' },
        false,
      ),
    ).toBe(true);
  });

  it('createCameraDraft labels roles in Russian', () => {
    const cam: Camera = createCameraDraft('s1', 'entry');
    expect(cam.role).toBe('entry');
    expect(cam.name).toBe(CAMERA_ROLE_LABELS.entry);
    expect(cam.roi).toBeNull();
  });

  it('maskCameraUrl hides password in userinfo', () => {
    expect(maskCameraUrl('http://admin:secret@192.168.1.1/snap.jpg')).toBe(
      'http://admin:***@192.168.1.1/snap.jpg',
    );
    expect(maskCameraUrl('rtsp://u:p@10.0.0.2:554/stream1')).toBe(
      'rtsp://u:***@10.0.0.2:554/stream1',
    );
    expect(maskCameraUrl('http://192.168.1.1/snap.jpg')).toBe('http://192.168.1.1/snap.jpg');
  });

  it('apply-style patch updates capture_url and kind on draft', () => {
    const cam = createCameraDraft('site-1', 'overview');
    const patched: Camera = {
      ...cam,
      capture_url: 'http://admin:x@192.168.1.64/ISAPI/Streaming/channels/101/picture',
      capture_kind: 'http_snapshot',
    };
    upsertCamera(patched);
    const stored = CamerasStorage.forSite('site-1').find((c) => c.id === cam.id);
    expect(stored?.capture_url).toContain('ISAPI');
    expect(stored?.capture_kind).toBe('http_snapshot');
  });

  it('triggerCaptureAfterSave skips when video disabled', async () => {
    SettingsStorage.updateAppSettings({ video_enabled: false });
    upsertCamera(createCameraDraft('site-1', 'entry'));
    const result = await triggerCaptureAfterSave('t1', ['gross'], 'site-1');
    expect(result).toEqual({ ok: true });
    expect(flushMock).not.toHaveBeenCalled();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('triggerCaptureAfterSave skips when no enabled cameras', async () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    const cam = createCameraDraft('site-1', 'entry');
    cam.enabled = false;
    upsertCamera(cam);
    const result = await triggerCaptureAfterSave('t1', ['gross'], 'site-1');
    expect(result).toEqual({ ok: true });
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('triggerCaptureAfterSave flushes before capture and reports partial fail', async () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    upsertCamera(createCameraDraft('site-1', 'entry'));

    const callOrder: string[] = [];
    flushMock.mockImplementation(async () => {
      callOrder.push('flush');
    });
    pauseMock.mockImplementation(() => {
      callOrder.push('pause');
    });
    resumeMock.mockImplementation(() => {
      callOrder.push('resume');
    });
    apiPostMock.mockImplementation(async (url: string) => {
      callOrder.push(`post:${url}`);
      if (url === '/api/config') {
        return { success: true };
      }
      if (url === '/api/database') {
        return { success: true };
      }
      if (url === '/api/cameras/capture') {
        return {
          success: true,
          photos: [
            {
              id: 'p1',
              ticket_id: 't1',
              phase: 'gross',
              camera_id: 'c1',
              camera_role: 'entry',
              relative_path: 'Photo/x.jpg',
              status: 'failed',
              error_message: 'timeout',
              camera_mode: 'normal',
              created_at: '2026-08-02T10:00:00',
            },
            {
              id: 'p2',
              ticket_id: 't1',
              phase: 'gross',
              camera_id: 'c2',
              camera_role: 'overview',
              relative_path: 'Photo/y.jpg',
              status: 'ok',
              error_message: null,
              camera_mode: 'normal',
              created_at: '2026-08-02T10:00:00',
            },
          ],
          stubs: {
            photo_entry_path: null,
            photo_exit_path: null,
            photo_overview_path: 'Photo/y.jpg',
          },
        };
      }
      return {};
    });

    const result = await triggerCaptureAfterSave('t1', ['gross'], 'site-1');
    expect(result).toEqual({
      ok: true,
      message: 'Часть фото для талона не сохранена: timeout',
    });
    expect(callOrder[0]).toBe('pause');
    expect(callOrder[1]).toBe('flush');
    expect(callOrder).toContain('post:/api/config');
    expect(callOrder).toContain('post:/api/database');
    expect(callOrder).toContain('post:/api/cameras/capture');
    const configIdx = callOrder.indexOf('post:/api/config');
    const syncIdx = callOrder.indexOf('post:/api/database');
    const postIdx = callOrder.indexOf('post:/api/cameras/capture');
    expect(configIdx).toBeGreaterThan(callOrder.indexOf('flush'));
    expect(syncIdx).toBeGreaterThan(configIdx);
    expect(postIdx).toBeGreaterThan(syncIdx);
    expect(callOrder).toContain('resume');
    expect(flushMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('triggerCaptureAfterSave returns detailed ticket-photo error when all captures failed', async () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    upsertCamera(createCameraDraft('site-1', 'entry'));
    apiPostMock.mockImplementation(async (url: string) => {
      if (url === '/api/config') {
        return { success: true };
      }
      if (url === '/api/database') {
        return { success: true };
      }
      return {
        success: true,
        photos: [
          {
            id: 'p1',
            ticket_id: 't1',
            phase: 'gross',
            camera_id: 'c1',
            camera_role: 'entry',
            relative_path: null,
            status: 'failed',
            error_message: 'Таймаут захвата (15 с)',
            camera_mode: 'normal',
            created_at: '2026-08-02T10:00:00',
          },
        ],
        stubs: {
          photo_entry_path: null,
          photo_exit_path: null,
          photo_overview_path: null,
        },
      };
    });
    const result = await triggerCaptureAfterSave('t1', ['gross'], 'site-1');
    expect(result).toEqual({
      ok: false,
      message: 'Фото для талона не сохранены: Таймаут захвата (15 с)',
    });
    expect(resumeMock).toHaveBeenCalled();
  });

  it('triggerCaptureAfterSave returns ticket-photo error when capture API fails', async () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    upsertCamera(createCameraDraft('site-1', 'entry'));
    apiPostMock.mockImplementation(async (url: string) => {
      if (url === '/api/config') {
        return { success: true };
      }
      if (url === '/api/database') {
        return { success: true };
      }
      throw new Error('network');
    });
    const result = await triggerCaptureAfterSave('t1', ['gross'], 'site-1');
    expect(result).toEqual({
      ok: false,
      message: 'Фото для талона не сохранены: backend не вернул результат захвата',
    });
    expect(resumeMock).toHaveBeenCalled();
  });
});
