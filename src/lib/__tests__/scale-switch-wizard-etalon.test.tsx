/**
 * Frontend E2E/unit tests for spare scale-switch wizard etalon vs live (UC-06).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ScaleSetSwitchWizard,
  SpareEtalonComparisonPanel,
  allSpareLiveFramesOk,
  fetchSpareLiveSnapshots,
  selectEnabledSpareEtalonCameras,
  shouldShowSpareEtalonComparison,
  type SpareLiveFrame,
} from '@/components/ScaleSetSwitchWizard';
import type { Camera } from '@/lib/cameras';
import { photoApiUrl } from '@/lib/ticket-photos-preview';
import {
  DEFAULT_SITE_ID,
  applyScaleSetSwitch,
  ensureDefaultSiteAndScales,
} from '@/lib/site';
import {
  CameraStorage,
  DEFAULT_APP_SETTINGS,
  SettingsStorage,
  SiteRuntimeStorage,
  TicketAuditStorage,
} from '@/lib/storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function installWindowEvents(): void {
  const eventTarget = new EventTarget();
  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    },
    configurable: true,
  });
}

function makeCamera(
  overrides: Partial<Camera> & Pick<Camera, 'id' | 'name' | 'role'>,
): Camera {
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
installWindowEvents();

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scale switch wizard etalon comparison', () => {
  it('TC-E2E-01: spare wizard with etalon shows comparison block; apply sets spare + anpr disabled', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'cas' });
    SettingsStorage.updateAppSettings({ video_enabled: true });
    const camera = makeCamera({
      id: 'cam-entry',
      name: 'Въезд',
      role: 'entry',
      etalon_spare_path: 'Photo/etalons/cam-entry/spare.jpg',
    });
    CameraStorage.replaceAll([camera]);

    const etalonCameras = selectEnabledSpareEtalonCameras(CameraStorage.getBySite(DEFAULT_SITE_ID));
    expect(
      shouldShowSpareEtalonComparison({
        videoEnabled: true,
        capabilityAvailable: true,
        etalonCameras,
      }),
    ).toBe(true);

    const liveFrames: SpareLiveFrame[] = [
      {
        cameraId: 'cam-entry',
        status: 'ok',
        dataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
        error: null,
      },
    ];

    const comparisonHtml = renderToStaticMarkup(
      React.createElement(SpareEtalonComparisonPanel, {
        etalonCameras,
        liveFrames,
        liveLoading: false,
        stepCompared: true,
        onStepComparedChange: () => undefined,
        acceptedWithoutLive: false,
        onAcceptedWithoutLiveChange: () => undefined,
      }),
    );
    expect(comparisonHtml).toContain('data-testid="spare-etalon-comparison"');
    expect(comparisonHtml).toContain(photoApiUrl('Photo/etalons/cam-entry/spare.jpg'));
    expect(comparisonHtml).toContain('Сверил текущий ракурс с эталоном spare');
    expect(comparisonHtml).toContain('data-live-ok="true"');

    const result = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'repair',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });
    expect(result.applied).toBe(true);
    const runtime = SiteRuntimeStorage.get(DEFAULT_SITE_ID);
    expect(runtime?.active_scale_set).toBe('spare');
    expect(runtime?.camera_mode).toBe('spare');
    expect(runtime?.anpr_mode).toBe('disabled_by_configuration');
  });

  it('TC-E2E-02: without etalon — text checklist; switch not blocked', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'cas' });
    SettingsStorage.updateAppSettings({ video_enabled: true });
    CameraStorage.replaceAll([
      makeCamera({
        id: 'cam-no-etalon',
        name: 'Обзор',
        role: 'overview',
        etalon_spare_path: null,
      }),
    ]);

    const etalonCameras = selectEnabledSpareEtalonCameras(CameraStorage.getBySite(DEFAULT_SITE_ID));
    expect(etalonCameras).toHaveLength(0);
    expect(
      shouldShowSpareEtalonComparison({
        videoEnabled: true,
        capabilityAvailable: true,
        etalonCameras,
      }),
    ).toBe(false);

    const wizardHtml = renderToStaticMarkup(
      React.createElement(ScaleSetSwitchWizard, {
        open: true,
        targetSet: 'spare',
        operatorName: 'Оператор',
        operatorId: null,
        onClose: () => undefined,
        onApplied: () => undefined,
      }),
    );
    expect(wizardHtml).toContain('Эталоны недоступны — сверил визуально на месте / принимаю');
    expect(wizardHtml).toContain('data-testid="spare-text-visual-check"');
    expect(wizardHtml).not.toContain('data-testid="spare-etalon-comparison"');

    const result = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'cleaning',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });
    expect(result.applied).toBe(true);
    expect(SiteRuntimeStorage.get(DEFAULT_SITE_ID)?.camera_mode).toBe('spare');
  });

  it('TC-E2E-03: live fail — accept without live and apply', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'cas' });
    const camera = makeCamera({
      id: 'cam-fail',
      name: 'Выезд',
      role: 'exit',
      etalon_spare_path: 'Photo/etalons/cam-fail/spare.jpg',
    });
    const liveFrames: SpareLiveFrame[] = [
      {
        cameraId: 'cam-fail',
        status: 'failed',
        dataUrl: null,
        error: 'timeout',
      },
    ];
    expect(allSpareLiveFramesOk(liveFrames)).toBe(false);

    const html = renderToStaticMarkup(
      React.createElement(SpareEtalonComparisonPanel, {
        etalonCameras: [camera],
        liveFrames,
        liveLoading: false,
        stepCompared: false,
        onStepComparedChange: () => undefined,
        acceptedWithoutLive: true,
        onAcceptedWithoutLiveChange: () => undefined,
      }),
    );
    expect(html).toContain('Текущий кадр недоступен');
    expect(html).toContain('Принял без live-сверки');
    expect(html).toContain('data-testid="spare-accepted-without-live"');
    expect(html).toContain(photoApiUrl('Photo/etalons/cam-fail/spare.jpg'));
    expect(html).not.toContain('Сверил текущий ракурс с эталоном spare');

    const result = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'other',
      comment: 'live offline',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });
    expect(result.applied).toBe(true);
    expect(SiteRuntimeStorage.get(DEFAULT_SITE_ID)?.anpr_mode).toBe('disabled_by_configuration');
  });

  it('TC-UNIT-01: wizard live path uses snapshot endpoint, not test', async () => {
    const snapshotFn = vi.fn(async ({ camera_id }: { camera_id?: string }) => ({
      success: true as const,
      preview_jpeg_base64: 'YWJj',
      content_type: 'image/jpeg',
    }));
    const frames = await fetchSpareLiveSnapshots([{ id: 'cam-1' }, { id: 'cam-2' }], snapshotFn);
    expect(snapshotFn).toHaveBeenCalledTimes(2);
    expect(snapshotFn).toHaveBeenNthCalledWith(1, { camera_id: 'cam-1' });
    expect(snapshotFn).toHaveBeenNthCalledWith(2, { camera_id: 'cam-2' });
    expect(frames.every((f) => f.status === 'ok')).toBe(true);

    const source = fs.readFileSync(
      path.resolve(__dirname, '../../components/ScaleSetSwitchWizard.tsx'),
      'utf8',
    );
    expect(source).toContain('postCameraSnapshot');
    expect(source).toContain('fetchSpareLiveSnapshots');
    expect(source).not.toMatch(/postCameraTest/);
  });

  it('TC-UNIT-02: primary path does not require etalon checklist', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScaleSetSwitchWizard, {
        open: true,
        targetSet: 'primary',
        operatorName: 'Оператор',
        operatorId: null,
        onClose: () => undefined,
        onApplied: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="primary-switch-hint"');
    expect(html).toContain('Возврат на основные весы');
    expect(html).not.toContain('Эталоны недоступны');
    expect(html).not.toContain('data-testid="spare-etalon-comparison"');
    expect(html).not.toContain('Сверил текущий ракурс с эталоном spare');
    expect(html).not.toContain('Подтверждаю переход на резервные весы');
  });

  it('TC-UNIT: video_enabled false or capability false keeps text fallback', () => {
    const cameras = [
      makeCamera({
        id: 'cam-a',
        name: 'A',
        role: 'entry',
        etalon_spare_path: 'Photo/etalons/cam-a/spare.jpg',
      }),
    ];
    expect(
      shouldShowSpareEtalonComparison({
        videoEnabled: false,
        capabilityAvailable: true,
        etalonCameras: cameras,
      }),
    ).toBe(false);
    expect(
      shouldShowSpareEtalonComparison({
        videoEnabled: true,
        capabilityAvailable: false,
        etalonCameras: cameras,
      }),
    ).toBe(false);
  });

  it('TC-UNIT: disabled camera or empty etalon path excluded', () => {
    const rows = [
      makeCamera({
        id: 'on',
        name: 'On',
        role: 'entry',
        enabled: true,
        etalon_spare_path: 'Photo/etalons/on/spare.jpg',
      }),
      makeCamera({
        id: 'off',
        name: 'Off',
        role: 'exit',
        enabled: false,
        etalon_spare_path: 'Photo/etalons/off/spare.jpg',
      }),
      makeCamera({
        id: 'empty',
        name: 'Empty',
        role: 'overview',
        enabled: true,
        etalon_spare_path: '  ',
      }),
    ];
    const selected = selectEnabledSpareEtalonCameras(rows);
    expect(selected.map((c) => c.id)).toEqual(['on']);
  });
});
