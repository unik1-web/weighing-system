import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SettingsStorage,
  SiteRuntimeStorage,
  SiteStorage,
  ScaleStorage,
  ScaleSwitchJournalStorage,
  TicketAuditStorage,
  TicketStorage,
  DEFAULT_APP_SETTINGS,
} from '../storage';
import {
  DEFAULT_SITE_ID,
  WEB_SERIAL_ADAPTER_ID,
  SWITCH_REASON_LABELS,
  alignDeviceMirror,
  applyScaleSetSwitch,
  buildScaleConnection,
  ensureDefaultSiteAndScales,
  getActiveScale,
  normalizeSwitchReason,
  parseScaleConnection,
  ticketScaleFieldsFromRuntime,
  updateActiveScaleDevice,
  updateScaleConnectionDevice,
} from '../site';
import { logger } from '../logger';

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

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
  vi.restoreAllMocks();
});

describe('site domain unit', () => {
  it('TC-E2E-01: legacy scale_device_id migrates to primary canonical adapter', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'cas' });
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    expect(primary?.adapter_id).toBe('cas');
    expect(primary?.connection.transport).toBe('web_serial');
    expect(primary?.connection.device_id).toBe('cas');
  });

  it('TC-E2E-02: valid primary is source of truth over legacy mirror', () => {
    const now = new Date().toISOString();
    SiteStorage.upsert({
      id: DEFAULT_SITE_ID,
      name: 'Площадка по умолчанию',
      created_at: now,
    });
    ScaleStorage.upsert({
      id: 'primary-1',
      site_id: DEFAULT_SITE_ID,
      role: 'primary',
      adapter_id: 'newton',
      connection: { transport: 'web_serial', device_id: 'newton' },
      name: 'Основные',
      created_at: now,
    });
    ScaleStorage.upsert({
      id: 'spare-1',
      site_id: DEFAULT_SITE_ID,
      role: 'spare',
      adapter_id: 'web_serial',
      connection: { transport: 'web_serial', device_id: null },
      name: 'Резервные',
      created_at: now,
    });
    SiteRuntimeStorage.upsert({
      site_id: DEFAULT_SITE_ID,
      active_scale_set: 'primary',
      camera_mode: 'primary',
      anpr_mode: 'enabled',
      last_switch_reason: null,
      last_switch_comment: null,
      last_switch_operator_name: null,
      last_switch_operator_id: null,
      last_switch_at: null,
      updated_at: now,
    });

    const result = ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'cas' });
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    expect(result.status).toBe('skipped');
    expect(primary?.adapter_id).toBe('newton');
    expect(primary?.connection.device_id).toBe('newton');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');
  });

  it('TC-UNIT: constants and normalizeSwitchReason', () => {
    expect(DEFAULT_SITE_ID).toBe('default-site');
    expect(WEB_SERIAL_ADAPTER_ID).toBe('web_serial');
    expect(normalizeSwitchReason('repair')).toBe('repair');
    expect(normalizeSwitchReason('unknown')).toBeNull();
    expect(SWITCH_REASON_LABELS.repair).toBe('ремонт');
  });

  it('TC-UNIT: parseScaleConnection / buildScaleConnection', () => {
    expect(parseScaleConnection({ device_id: 'newton' })).toEqual({
      transport: 'web_serial',
      device_id: 'newton',
    });
    expect(parseScaleConnection({ device_id: null })).toEqual({
      transport: 'web_serial',
      device_id: null,
    });
    expect(parseScaleConnection({ device_id: 'bad' })).toEqual({
      transport: 'web_serial',
      device_id: 'microsim-m0601',
    });
    expect(buildScaleConnection(null)).toEqual({ transport: 'web_serial', device_id: null });
  });

  it('TC-UNIT: normalizeTicket site_id/scale_id missing → null', () => {
    const ticket = TicketStorage.create({
      vehicle_number: 'А001АА56',
      vehicle_brand: '',
      trailer_number: '',
      driver_name: 'Иванов',
      cargo_name: 'ТКО',
      shipper_name: 'А',
      receiver_name: 'Б',
      carrier_name: 'В',
      price: 0,
      vat_rate: 0,
      gross_weight: 10000,
      tare_weight: 5000,
      net_weight: 5000,
      total_amount: 0,
      gross_source: 'manual',
      tare_source: 'manual',
      gross_raw: null,
      tare_raw: null,
      gross_datetime: null,
      tare_datetime: null,
      scale_device: '',
      operator_id: null,
      operator_name: 'Оп',
      status: 'completed',
      completed_at: new Date().toISOString(),
      notes: '',
    });
    expect(ticket.site_id).toBeNull();
    expect(ticket.scale_id).toBeNull();
    expect(ticket.scale_role).toBeNull();
  });

  it('TC-UNIT: migration created / skipped / fallback device + logger', () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const created = ensureDefaultSiteAndScales({
      ...DEFAULT_APP_SETTINGS,
      scale_device_id: 'newton',
    });
    expect(created.status).toBe('created');
    expect(SiteStorage.getById(DEFAULT_SITE_ID)?.name).toBe('Площадка по умолчанию');
    expect(ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary')?.connection.device_id).toBe('newton');
    expect(ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare')?.connection.device_id).toBeNull();
    expect(SiteRuntimeStorage.get(DEFAULT_SITE_ID)?.active_scale_set).toBe('primary');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');
    expect(infoSpy).toHaveBeenCalled();

    const skipped = ensureDefaultSiteAndScales(SettingsStorage.getAppSettings());
    expect(skipped.status).toBe('skipped');
    expect(ScaleStorage.getBySite(DEFAULT_SITE_ID)).toHaveLength(2);

    localStorage.clear();
    TicketAuditStorage.ensureInitialized();
    ensureDefaultSiteAndScales({
      ...DEFAULT_APP_SETTINGS,
      scale_device_id: 'totally-invalid' as typeof DEFAULT_APP_SETTINGS.scale_device_id,
    });
    expect(ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary')?.connection.device_id).toBe(
      'microsim-m0601',
    );
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('microsim-m0601');
  });

  it('TC-UNIT: getActiveScale / ticketScaleFieldsFromRuntime after seed', () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    const active = getActiveScale();
    expect(active?.role).toBe('primary');
    const fields = ticketScaleFieldsFromRuntime();
    expect(fields).toEqual({
      site_id: DEFAULT_SITE_ID,
      scale_id: active!.id,
      scale_role: 'primary',
    });
  });

  it('TC-UNIT: invalid reason does not apply; camera_mode equals active', () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    const before = ScaleSwitchJournalStorage.getAll().length;
    const bad = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'неизвестно',
      operator_name: 'Оп',
      checklist_confirmed: true,
    });
    expect(bad.applied).toBe(false);
    expect(ScaleSwitchJournalStorage.getAll()).toHaveLength(before);

    const ok = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'repair',
      operator_name: 'Оп',
      checklist_confirmed: true,
    });
    expect(ok.applied).toBe(true);
    const runtime = SiteRuntimeStorage.get(DEFAULT_SITE_ID)!;
    expect(runtime.camera_mode).toBe(runtime.active_scale_set);
    expect(runtime.anpr_mode).toBe('disabled_by_configuration');
  });

  it('TC-UNIT: switch logs from/to/reason', () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    const infoSpy = vi.spyOn(logger, 'info');
    applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'cleaning',
      operator_name: 'Иванов',
      checklist_confirmed: true,
    });
    expect(
      infoSpy.mock.calls.some(
        (call) =>
          call[0] === 'site' &&
          String(call[1]).includes('spare') &&
          (call[2] as { reason?: string } | undefined)?.reason === 'cleaning',
      ),
    ).toBe(true);
  });

  it('TC-UNIT: alignDeviceMirror SoT; updateActiveScaleDevice', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'microsim-m0601' });
    SettingsStorage.updateAppSettings({ scale_device_id: 'cas' });
    const active = getActiveScale()!;
    alignDeviceMirror(active.connection);
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('microsim-m0601');

    updateActiveScaleDevice('newton');
    expect(getActiveScale()?.connection.device_id).toBe('newton');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');
  });

  it('TC-UNIT: inactive device update does not touch mirror', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'microsim-m0601' });
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare')!;
    updateScaleConnectionDevice(spare.id, 'cas', false);
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('microsim-m0601');
    expect(ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare')?.connection.device_id).toBe('cas');
  });
});
