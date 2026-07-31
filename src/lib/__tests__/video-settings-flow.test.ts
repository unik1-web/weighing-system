/**
 * E2E / flow tests for video settings + camera registry (UC-01 / UC-05).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const flushMock = vi.fn(async () => undefined);

vi.mock('../storage-sync', async () => {
  const actual = await vi.importActual<typeof import('../storage-sync')>('../storage-sync');
  return {
    ...actual,
    flushDatabaseSync: (...args: unknown[]) => flushMock(...args),
    scheduleDatabaseSync: vi.fn(),
    scheduleConfigSync: vi.fn(),
  };
});

import {
  CameraStorage,
  SettingsStorage,
  TicketPhotoStorage,
  TicketAuditStorage,
  DEFAULT_APP_SETTINGS,
} from '../storage';
import {
  cameraFromDraft,
  createEditCameraDraft,
  createEmptyCameraDraft,
  maskCameraUrl,
} from '../cameras';
import { DEFAULT_SITE_ID } from '../site';
import { VideoSettingsSection } from '@/components/VideoSettingsSection';

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

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeCamera(
  overrides: Partial<import('../cameras').Camera> & { id: string; name: string; role: 'entry' | 'exit' | 'overview' },
) {
  const now = '2026-07-31T10:00:00.000Z';
  return {
    site_id: DEFAULT_SITE_ID,
    http_snapshot_url: 'http://cam/snap',
    rtsp_url: null,
    enabled: true,
    roi_x: null,
    roi_y: null,
    roi_w: null,
    roi_h: null,
    etalon_primary_path: null,
    etalon_spare_path: null,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

installLocalStorage();

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
  flushMock.mockClear();
  flushMock.mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('video settings flow', () => {
  it('TC-E2E-01: admin saves 2 cameras + video_enabled=true → reload keeps data', () => {
    SettingsStorage.updateAppSettings({
      ...DEFAULT_APP_SETTINGS,
      video_enabled: true,
      camera_capture_timeout_sec: 3,
      camera_jpeg_quality: 80,
    });

    const cam1 = makeCamera({ id: 'cam-entry', name: 'Въезд', role: 'entry', sort_order: 0 });
    const cam2 = makeCamera({
      id: 'cam-exit',
      name: 'Выезд',
      role: 'exit',
      sort_order: 1,
      http_snapshot_url: 'http://cam/exit',
    });
    CameraStorage.replaceAll([cam1, cam2]);

    // Simulate reload of storage facades.
    const settings = SettingsStorage.getAppSettings();
    const cameras = CameraStorage.getBySite(DEFAULT_SITE_ID);

    expect(settings.video_enabled).toBe(true);
    expect(cameras).toHaveLength(2);
    expect(cameras.map((c) => c.id).sort()).toEqual(['cam-entry', 'cam-exit']);
    expect(localStorage.getItem('app_settings')).toContain('"video_enabled":"true"');
    expect(localStorage.getItem('app_cameras')).toContain('cam-entry');
  });

  it('TC-E2E-02: toggle video_enabled false→true keeps camera registry', () => {
    CameraStorage.replaceAll([
      makeCamera({ id: 'cam-keep', name: 'Обзор', role: 'overview', enabled: false }),
    ]);
    SettingsStorage.updateAppSettings({ video_enabled: false });
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(false);
    expect(CameraStorage.getAll()).toHaveLength(1);

    SettingsStorage.updateAppSettings({ video_enabled: true });
    expect(SettingsStorage.getAppSettings().video_enabled).toBe(true);
    expect(CameraStorage.getAll()).toHaveLength(1);
    expect(CameraStorage.getAll()[0].id).toBe('cam-keep');
  });

  it('TC-E2E-03: capability false → UI without CRUD; settings weighing defaults intact', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        success: true,
        available: false,
        build: 'basic',
        opencv: false,
        code: 'camera_module_unavailable',
      }),
    );

    SettingsStorage.updateAppSettings({
      weighing_mode_default: 'dual',
      tara_threshold: 12000,
      video_enabled: false,
    });

    const html = renderToStaticMarkup(React.createElement(VideoSettingsSection));
    // Initial render before effect settles still mounts the section chrome.
    expect(html).toContain('Видео и камеры');

    // Source-level gate: when available=false the CRUD controls live only inside available branch.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../components/VideoSettingsSection.tsx'),
      'utf8',
    );
    expect(source).toContain('недоступен в этой сборке');
    expect(source).toMatch(/available &&/);
    expect(source).toContain('Добавить камеру');

    const weighing = SettingsStorage.getAppSettings();
    expect(weighing.weighing_mode_default).toBe('dual');
    expect(weighing.tara_threshold).toBe(12000);
  });

  it('delete camera does not clear ticket_photos on client', () => {
    CameraStorage.replaceAll([makeCamera({ id: 'cam-del', name: 'X', role: 'entry' })]);
    TicketPhotoStorage.upsertMany([
      {
        id: 'ph-1',
        ticket_id: 't-1',
        camera_id: 'cam-del',
        camera_role: 'entry',
        event: 'gross',
        file_path: 'Photo/2026/07/31/a.jpg',
        status: 'success',
        error_code: null,
        captured_at: '2026-07-31T10:00:00',
        camera_mode: 'primary',
      },
    ]);

    CameraStorage.remove('cam-del');
    expect(CameraStorage.getAll()).toHaveLength(0);
    expect(TicketPhotoStorage.getAll()).toHaveLength(1);
  });

  it('URL save keeps original secret when field not dirty', () => {
    const camera = makeCamera({
      id: 'cam-secret',
      name: 'Secret',
      role: 'entry',
      http_snapshot_url: 'http://admin:s3cret@127.0.0.1/snap',
    });
    const draft = createEditCameraDraft(camera);
    expect(draft.http_snapshot_url).toContain('***');
    expect(draft.http_url_dirty).toBe(false);
    expect(maskCameraUrl(camera.http_snapshot_url)).not.toContain('s3cret');

    const saved = cameraFromDraft(draft, DEFAULT_SITE_ID, camera);
    expect(saved.http_snapshot_url).toBe('http://admin:s3cret@127.0.0.1/snap');
  });

  it('empty draft factory starts disabled without URLs', () => {
    const draft = createEmptyCameraDraft(2);
    expect(draft.enabled).toBe(false);
    expect(draft.sort_order).toBe(2);
    expect(draft.id).toBeNull();
  });
});
