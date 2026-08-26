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
  photoUrl,
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

  it('triggerCaptureAfterSave fails closed when pre-capture flush/sync throws', async () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    upsertCamera(createCameraDraft('site-1', 'entry'));
    flushMock.mockRejectedValueOnce(new Error('sqlite locked'));
    const result = await triggerCaptureAfterSave('t1', ['gross'], 'site-1');
    expect(result).toEqual({
      ok: false,
      message: 'Фото для талона не сохранены: sqlite locked',
    });
    expect(pauseMock).toHaveBeenCalled();
    expect(resumeMock).toHaveBeenCalled();
    expect(apiPostMock).not.toHaveBeenCalledWith('/api/cameras/capture', expect.anything());
  });

  it('TicketPhotosStorage.merge upserts by id without wiping other tickets', () => {
    TicketPhotosStorage.merge([
      {
        id: 'p-a',
        ticket_id: 't1',
        phase: 'gross',
        camera_id: 'c1',
        camera_role: 'entry',
        relative_path: 'Photo/a.jpg',
        status: 'ok',
        error_message: null,
        camera_mode: 'normal',
        created_at: '2026-08-02T10:00:00',
      },
      {
        id: 'p-b',
        ticket_id: 't2',
        phase: 'tare',
        camera_id: 'c1',
        camera_role: 'exit',
        relative_path: 'Photo/b.jpg',
        status: 'ok',
        error_message: null,
        camera_mode: 'normal',
        created_at: '2026-08-02T11:00:00',
      },
    ]);
    TicketPhotosStorage.merge([
      {
        id: 'p-a',
        ticket_id: 't1',
        phase: 'gross',
        camera_id: 'c1',
        camera_role: 'entry',
        relative_path: 'Photo/a-retry.jpg',
        status: 'ok',
        error_message: null,
        camera_mode: 'spare',
        created_at: '2026-08-02T10:05:00',
      },
    ]);
    const t1 = TicketPhotosStorage.forTicket('t1');
    const t2 = TicketPhotosStorage.forTicket('t2');
    expect(t1).toHaveLength(1);
    expect(t1[0].relative_path).toBe('Photo/a-retry.jpg');
    expect(t1[0].camera_mode).toBe('spare');
    expect(t2).toHaveLength(1);
    expect(t2[0].id).toBe('p-b');
  });
});
