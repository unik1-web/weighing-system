import { beforeEach, describe, expect, it } from 'vitest';
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
  upsertCamera,
} from '../cameras';

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

  it('shouldShowCameraSettings respects capabilities and saved cameras', () => {
    expect(shouldShowCameraSettings(null, false)).toBe(false);
    expect(
      shouldShowCameraSettings(
        { success: true, capture_available: true, backends: [], video_enabled: false, photo_root: 'Photo' },
        false,
      ),
    ).toBe(true);
    expect(
      shouldShowCameraSettings(
        { success: true, capture_available: false, backends: [], video_enabled: false, photo_root: 'Photo' },
        true,
      ),
    ).toBe(true);
  });

  it('createCameraDraft labels roles in Russian', () => {
    const cam: Camera = createCameraDraft('s1', 'entry');
    expect(cam.role).toBe('entry');
    expect(cam.name).toBe(CAMERA_ROLE_LABELS.entry);
    expect(cam.roi).toBeNull();
  });
});
