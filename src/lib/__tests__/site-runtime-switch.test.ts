import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  ScaleStorage,
  ScaleSwitchJournalStorage,
  SettingsStorage,
  SiteRuntimeStorage,
  TicketAuditStorage,
} from '../storage';
import {
  DEFAULT_SITE_ID,
  SITE_RUNTIME_CHANGED_EVENT,
  alignDeviceMirror,
  applyScaleSetSwitch,
  ensureDefaultSiteAndScales,
  getActiveScale,
  updateScaleConfiguration,
} from '../site';
import { ScaleRuntimeClient } from '../scale-runtime-client';

vi.mock('../api', () => {
  return {
    scaleConnect: vi.fn(),
    scaleRead: vi.fn(),
    scaleDisconnect: vi.fn(),
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

installLocalStorage();
installWindowEvents();

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
  vi.restoreAllMocks();
});

describe('site runtime switch flow', () => {
  it('TC-UNIT-01: applyScaleSetSwitch updates runtime and journal once', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'cas' });
    const beforeUpdatedAt = SiteRuntimeStorage.get(DEFAULT_SITE_ID)?.updated_at;
    const eventSpy = vi.fn();
    window.addEventListener(SITE_RUNTIME_CHANGED_EVENT, eventSpy);

    const result = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'repair',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });

    const runtime = SiteRuntimeStorage.get(DEFAULT_SITE_ID);
    const journal = ScaleSwitchJournalStorage.getAll(DEFAULT_SITE_ID);
    expect(result.applied).toBe(true);
    expect(runtime?.active_scale_set).toBe('spare');
    expect(runtime?.camera_mode).toBe('spare');
    expect(runtime?.anpr_mode).toBe('disabled_by_configuration');
    expect(runtime?.last_switch_reason).toBe('repair');
    expect(runtime?.updated_at).not.toBe(beforeUpdatedAt);
    expect(journal).toHaveLength(1);
    expect(journal[0].from_set).toBe('primary');
    expect(journal[0].to_set).toBe('spare');
    expect(eventSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener(SITE_RUNTIME_CHANGED_EVENT, eventSpy);
  });

  it('TC-E2E-04: no-op switch does not append journal', () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    const beforeJournalCount = ScaleSwitchJournalStorage.getAll(DEFAULT_SITE_ID).length;
    const result = applyScaleSetSwitch({
      to_set: 'primary',
      reason: 'verification',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });
    const afterJournalCount = ScaleSwitchJournalStorage.getAll(DEFAULT_SITE_ID).length;
    expect(result.applied).toBe(false);
    expect(beforeJournalCount).toBe(afterJournalCount);
  });

  it('TC-UNIT-03: alignDeviceMirror keeps previous valid mirror when device_id absent', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'newton' });
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    if (!primary) throw new Error('primary scale not found');

    updateScaleConfiguration(
      primary.id,
      {
        adapter_id: 'web_serial',
        connection: { transport: 'web_serial', device_id: null },
      },
      false,
    );

    const beforeMirror = SettingsStorage.getAppSettings().scale_device_id;
    alignDeviceMirror(getActiveScale()?.connection);
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe(beforeMirror);
  });

  it('TC-E2E-01: runtime client disconnects stale backend session on switch event', async () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare');
    if (!spare) throw new Error('spare scale not found');
    updateScaleConfiguration(
      spare.id,
      {
        adapter_id: 'newton',
        connection: {
          transport: 'serial_backend',
          device_id: 'newton',
          serial: { port: 'COM-STUB' },
        },
      },
      false,
    );
    applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'repair',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });

    const { scaleConnect, scaleDisconnect } = await import('../api');
    vi.mocked(scaleConnect).mockResolvedValue({
      success: true,
      session_id: 'session-old',
      status: 'connected',
      scale: {
        site_id: DEFAULT_SITE_ID,
        scale_id: spare.id,
        scale_role: 'spare',
        adapter_id: 'newton',
        transport: 'serial_backend',
      },
      reading: null,
    });
    vi.mocked(scaleDisconnect).mockResolvedValue({
      success: true,
      session_id: 'session-old',
      status: 'disconnected',
    });

    const client = new ScaleRuntimeClient();
    const connectResult = await client.connect(getActiveScale()!);
    expect(connectResult.mode).toBe('backend_api');
    window.dispatchEvent(new Event(SITE_RUNTIME_CHANGED_EVENT));
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(scaleDisconnect)).toHaveBeenCalledWith('session-old');
    expect(client.getStatus().status).toBe('disconnected');
  });
});
