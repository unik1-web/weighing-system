import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketStorage,
  TicketAuditStorage,
  SettingsStorage,
  SitesStorage,
  ScalesStorage,
  SiteRuntimeStorage,
  SiteScaleSwitchesStorage,
} from '../storage';
import {
  ensureSiteMigrated,
  getActiveScaleContext,
  getDefaultSite,
  switchScaleSet,
  enableSpareScale,
  listSwitchHistory,
  DEFAULT_SITE_NAME,
  DEFAULT_SPARE_SCALE_NAME,
} from '../site-runtime';

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
});

function baseTicket(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_number: 'А001АА56',
    vehicle_brand: '',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'Грунт',
    shipper_name: 'Отправитель',
    receiver_name: 'Получатель',
    carrier_name: 'Перевозчик',
    price: 100,
    vat_rate: 20,
    gross_weight: 20000,
    tare_weight: 5000,
    net_weight: 15000,
    total_amount: 1500,
    gross_source: 'manual' as const,
    tare_source: 'manual' as const,
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-01-01T10:00:00',
    tare_datetime: '2026-01-01T10:05:00',
    scale_device: '',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed' as const,
    completed_at: '2026-01-01T10:05:00',
    notes: '',
    ...overrides,
  };
}

describe('site-runtime migration', () => {
  it('creates default site, primary enabled, spare disabled, runtime primary', () => {
    SettingsStorage.updateAppSettings({ scale_device_id: 'cas' });
    ensureSiteMigrated();

    const site = getDefaultSite();
    expect(site.name).toBe(DEFAULT_SITE_NAME);
    expect(site.is_default).toBe(true);

    const scales = ScalesStorage.getBySite(site.id);
    expect(scales).toHaveLength(2);
    const primary = scales.find((s) => s.role === 'primary');
    const spare = scales.find((s) => s.role === 'spare');
    expect(primary?.enabled).toBe(true);
    expect(primary?.adapter_id).toBe('cas');
    expect(spare?.enabled).toBe(false);
    expect(spare?.name).toBe(DEFAULT_SPARE_SCALE_NAME);

    const runtime = SiteRuntimeStorage.getBySite(site.id);
    expect(runtime?.active_scale_set).toBe('primary');
    expect(runtime?.anpr_mode).toBe('enabled');
    expect(runtime?.camera_mode).toBe('normal');
  });

  it('is idempotent — no duplicate sites/scales', () => {
    ensureSiteMigrated();
    const sitesBefore = SitesStorage.getAll().length;
    const scalesBefore = ScalesStorage.getAll().length;
    ensureSiteMigrated();
    expect(SitesStorage.getAll()).toHaveLength(sitesBefore);
    expect(ScalesStorage.getAll()).toHaveLength(scalesBefore);
  });
});

describe('site-runtime switch', () => {
  it('throws when switching to spare without enabled spare', () => {
    ensureSiteMigrated();
    expect(() =>
      switchScaleSet({
        to: 'spare',
        reason: 'repair',
        operator_id: null,
        operator_name: 'Оператор',
        camera_ack: 'no_cameras',
      }),
    ).toThrow(/Резервные весы не настроены/);
  });

  it('switches to spare: journal, anpr disabled, scale_device_id synced', () => {
    ensureSiteMigrated();
    enableSpareScale({ adapter_id: 'newton', name: 'Резерв Ньютон' });

    const ctx = switchScaleSet({
      to: 'spare',
      reason: 'cleaning',
      operator_id: 'u1',
      operator_name: 'Иванов',
      camera_ack: 'rotated',
    });

    expect(ctx.scale_role).toBe('spare');
    expect(ctx.runtime.anpr_mode).toBe('disabled_by_configuration');
    expect(ctx.runtime.camera_mode).toBe('rotated_for_spare');
    expect(ctx.runtime.switch_reason).toBe('cleaning');
    expect(ctx.runtime.switch_by_operator_name).toBe('Иванов');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');

    const history = listSwitchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].from_set).toBe('primary');
    expect(history[0].to_set).toBe('spare');
    expect(history[0].reason).toBe('cleaning');
    expect(history[0].camera_ack).toBe('rotated');
  });

  it('switches back to primary restoring anpr/camera', () => {
    ensureSiteMigrated();
    enableSpareScale({ adapter_id: 'cas' });
    switchScaleSet({
      to: 'spare',
      reason: 'repair',
      operator_id: null,
      operator_name: 'Оп',
      camera_ack: 'no_cameras',
    });
    const ctx = switchScaleSet({
      to: 'primary',
      reason: 'other',
      operator_id: null,
      operator_name: 'Оп',
    });
    expect(ctx.runtime.active_scale_set).toBe('primary');
    expect(ctx.runtime.anpr_mode).toBe('enabled');
    expect(ctx.runtime.camera_mode).toBe('normal');
    expect(listSwitchHistory()).toHaveLength(2);
  });
});

describe('ticket site/scale fields', () => {
  it('create after migrate fills site_id/scale_id/scale_role from context', () => {
    ensureSiteMigrated();
    const ctx = getActiveScaleContext();
    const ticket = TicketStorage.create(
      baseTicket({
        site_id: ctx.site_id,
        scale_id: ctx.scale_id,
        scale_role: ctx.scale_role,
      }),
    );
    expect(ticket.site_id).toBe(ctx.site_id);
    expect(ticket.scale_id).toBe(ctx.scale_id);
    expect(ticket.scale_role).toBe('primary');
  });

  it('soft-reads missing site_id/scale_id as null', () => {
    const raw = {
      ...baseTicket(),
      id: 'legacy-no-site',
      ticket_number: 3,
      created_at: '2026-01-01T00:00:00',
      reo_status: 'pending' as const,
      reo_sent_at: null,
    };
    localStorage.setItem('app_weighing_tickets', JSON.stringify([raw]));
    const ticket = TicketStorage.getById('legacy-no-site');
    expect(ticket?.site_id).toBeNull();
    expect(ticket?.scale_id).toBeNull();
  });

  it('does not rewrite existing tickets on switch', () => {
    ensureSiteMigrated();
    const ctx = getActiveScaleContext();
    const ticket = TicketStorage.create(
      baseTicket({
        site_id: ctx.site_id,
        scale_id: ctx.scale_id,
        scale_role: ctx.scale_role,
        status: 'open',
        weighing_mode: 'dual',
        tare_weight: null,
        net_weight: null,
        total_amount: null,
        completed_at: null,
      }),
    );
    enableSpareScale({ adapter_id: 'cas' });
    switchScaleSet({
      to: 'spare',
      reason: 'verification',
      operator_id: null,
      operator_name: 'Оп',
      camera_ack: 'no_cameras',
    });
    const reloaded = TicketStorage.getById(ticket.id);
    expect(reloaded?.scale_id).toBe(ticket.scale_id);
    expect(reloaded?.scale_role).toBe('primary');
  });
});

describe('wizard cancel semantics', () => {
  it('runtime unchanged when switchScaleSet is not called', () => {
    ensureSiteMigrated();
    const before = getActiveScaleContext();
    // Cancel wizard = no switchScaleSet call
    const after = getActiveScaleContext();
    expect(after.runtime.active_scale_set).toBe(before.runtime.active_scale_set);
    expect(SiteScaleSwitchesStorage.getAll()).toHaveLength(0);
  });

  it('dispatches site-runtime-updated on switch', () => {
    ensureSiteMigrated();
    enableSpareScale({ adapter_id: 'newton' });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    switchScaleSet({
      to: 'spare',
      reason: 'other',
      operator_id: null,
      operator_name: 'Оп',
      camera_ack: 'no_cameras',
    });
    expect(dispatchEvent).toHaveBeenCalled();
    const lastCall = dispatchEvent.mock.calls[dispatchEvent.mock.calls.length - 1];
    const event = lastCall?.[0] as Event;
    expect(event?.type).toBe('site-runtime-updated');
    vi.unstubAllGlobals();
  });
});
