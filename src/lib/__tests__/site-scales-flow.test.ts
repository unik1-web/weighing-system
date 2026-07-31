/**
 * No-mock E2E for site primary/spare: real Site/Scale/Runtime/Journal/Settings/Ticket storage.
 */
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
  SWITCH_REASON_LABELS,
  alignDeviceMirror,
  applyScaleSetSwitch,
  ensureDefaultSiteAndScales,
  getActiveScale,
  ticketScaleFieldsFromRuntime,
  updateActiveScaleDevice,
  updateScaleConnectionDevice,
} from '../site';
import { scaleConnection } from '../scales';

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

function baseTicket(
  overrides: Partial<Parameters<typeof TicketStorage.create>[0]> = {},
): Parameters<typeof TicketStorage.create>[0] {
  return {
    vehicle_number: 'А001АА56',
    vehicle_brand: 'КамАЗ',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'ТКО',
    shipper_name: 'ООО Ромашка',
    receiver_name: 'Полигон',
    carrier_name: 'Перевозчик',
    price: 100,
    vat_rate: 20,
    gross_weight: 20000,
    tare_weight: 8500,
    net_weight: 11500,
    total_amount: 1150,
    gross_source: 'instrument',
    tare_source: 'dictionary',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-07-01T10:00:00.000Z',
    tare_datetime: '2026-07-01T10:00:00.000Z',
    scale_device: 'Микросим М0601',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed',
    completed_at: '2026-07-01T10:01:00.000Z',
    notes: '',
    weighing_mode: 'single',
    ...overrides,
  };
}

/** Form-like create: hard-fail without runtime fields. */
function createTicketFromFormFlow(
  overrides: Partial<Parameters<typeof TicketStorage.create>[0]> = {},
) {
  const fields = ticketScaleFieldsFromRuntime();
  if (!fields) {
    throw new Error('Площадка/комплект весов не инициализированы');
  }
  return TicketStorage.create({
    ...baseTicket(overrides),
    site_id: fields.site_id,
    scale_id: fields.scale_id,
    scale_role: fields.scale_role,
  });
}

describe('site-scales flow (no-mock storage)', () => {
  it('TC-E2E: seed → create primary → switch spare → create spare → switch primary → dual → hard-fail → mirror', () => {
    // 1. seed
    const seed = ensureDefaultSiteAndScales({
      ...DEFAULT_APP_SETTINGS,
      scale_device_id: 'newton',
    });
    expect(seed.status).toBe('created');
    expect(SiteRuntimeStorage.get(DEFAULT_SITE_ID)?.active_scale_set).toBe('primary');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');

    // 2. create ticket → primary fields
    const t1 = createTicketFromFormFlow();
    expect(t1.site_id).toBe(DEFAULT_SITE_ID);
    expect(t1.scale_id).toBe(getActiveScale()!.id);
    expect(t1.scale_role).toBe('primary');

    // 3. switch spare with comment
    const disconnectSpy = vi
      .spyOn(scaleConnection, 'disconnect')
      .mockResolvedValue(undefined);
    vi.spyOn(scaleConnection, 'isConnected').mockReturnValue(true);

    const toSpare = applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'other',
      comment: 'плановый перевод',
      operator_name: 'Иванов',
      operator_id: 'u1',
      checklist_confirmed: true,
    });
    expect(toSpare.applied).toBe(true);
    expect(disconnectSpy).toHaveBeenCalled();
    const runtimeSpare = SiteRuntimeStorage.get(DEFAULT_SITE_ID)!;
    expect(runtimeSpare.active_scale_set).toBe('spare');
    expect(runtimeSpare.camera_mode).toBe('spare');
    expect(runtimeSpare.anpr_mode).toBe('disabled_by_configuration');
    expect(runtimeSpare.last_switch_comment).toBe('плановый перевод');
    const journal = ScaleSwitchJournalStorage.getAll(DEFAULT_SITE_ID);
    expect(journal).toHaveLength(1);
    expect(journal[0].from_set).toBe('primary');
    expect(journal[0].to_set).toBe('spare');
    expect(journal[0].reason).toBe('other');
    expect(journal[0].comment).toBe('плановый перевод');
    // spare without device → mirror stays valid (last-known / not invalid)
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');

    // 4. create on spare
    const t2 = createTicketFromFormFlow({ vehicle_number: 'В002ВВ56' });
    expect(t2.scale_role).toBe('spare');
    expect(t2.scale_id).toBe(ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare')!.id);

    // 5. switch primary → mirror = primary device
    const toPrimary = applyScaleSetSwitch({
      to_set: 'primary',
      reason: 'verification',
      operator_name: 'Иванов',
      checklist_confirmed: true,
    });
    expect(toPrimary.applied).toBe(true);
    const runtimePrimary = SiteRuntimeStorage.get(DEFAULT_SITE_ID)!;
    expect(runtimePrimary.active_scale_set).toBe('primary');
    expect(runtimePrimary.camera_mode).toBe('primary');
    expect(runtimePrimary.anpr_mode).toBe('enabled');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('newton');
    expect(ScaleSwitchJournalStorage.getAll()).toHaveLength(2);

    // 6. dual: open fixes set; complete does not overwrite
    const open = createTicketFromFormFlow({
      status: 'open',
      completed_at: null,
      weighing_mode: 'dual',
      tare_weight: null,
      net_weight: null,
      total_amount: null,
      tare_datetime: null,
    });
    expect(open.scale_role).toBe('primary');
    const openScaleId = open.scale_id;
    applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'repair',
      operator_name: 'Иванов',
      checklist_confirmed: true,
    });
    // Form-like dual complete: omit non-empty scale fields
    const completed = TicketStorage.update(open.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      tare_weight: 8500,
      net_weight: 11500,
      total_amount: 1150,
      // intentionally NOT passing site_id/scale_id/scale_role
    });
    expect(completed?.site_id).toBe(DEFAULT_SITE_ID);
    expect(completed?.scale_id).toBe(openScaleId);
    expect(completed?.scale_role).toBe('primary');

    // 7. hard-fail path
    SiteRuntimeStorage.clear();
    expect(ticketScaleFieldsFromRuntime()).toBeNull();
    expect(() => createTicketFromFormFlow()).toThrow(
      'Площадка/комплект весов не инициализированы',
    );

    // restore for remaining checks
    ensureDefaultSiteAndScales(SettingsStorage.getAppSettings());
    // after clear+ensure may recreate — ensure again from empty runtime only left sites
    if (!SiteRuntimeStorage.get(DEFAULT_SITE_ID)) {
      // sites/scales may still exist
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
        updated_at: new Date().toISOString(),
      });
    }

    // 8. active device ↔ mirror; inactive does not touch mirror
    updateActiveScaleDevice('cas');
    expect(getActiveScale()?.connection.device_id).toBe('cas');
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('cas');
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare')!;
    updateScaleConnectionDevice(spare.id, 'midl-mi-vda', false);
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('cas');

    // SoT: mirror diverges → align wins with connection
    SettingsStorage.updateAppSettings({ scale_device_id: 'newton' });
    alignDeviceMirror(getActiveScale()!.connection);
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('cas');

    // 9. already-active no-op
    const len = ScaleSwitchJournalStorage.getAll().length;
    const noop = applyScaleSetSwitch({
      to_set: 'primary',
      reason: 'repair',
      operator_name: 'Иванов',
      checklist_confirmed: true,
    });
    expect(noop.applied).toBe(false);
    expect(ScaleSwitchJournalStorage.getAll()).toHaveLength(len);
  });

  it('TC-E2E: empty comment on other → null; spare without device switch ok', () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'other',
      comment: '   ',
      operator_name: 'Оп',
      checklist_confirmed: true,
    });
    const entry = ScaleSwitchJournalStorage.getAll()[0];
    expect(entry.comment).toBeNull();
    expect(SiteRuntimeStorage.get(DEFAULT_SITE_ID)?.last_switch_comment).toBeNull();
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('microsim-m0601');
  });

  it('TC-E2E: old ticket stays null after seed; UI reason labels map to canon', () => {
    const legacy = TicketStorage.create(baseTicket());
    expect(legacy.site_id).toBeNull();
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    const reloaded = TicketStorage.getById(legacy.id);
    expect(reloaded?.site_id).toBeNull();
    expect(reloaded?.scale_role).toBeNull();
    expect(SWITCH_REASON_LABELS.verification).toBe('поверка');
  });

  it('TC-E2E: storage facades persist sites/scales/runtime/journal', () => {
    ensureDefaultSiteAndScales(DEFAULT_APP_SETTINGS);
    expect(SiteStorage.getAll()).toHaveLength(1);
    expect(ScaleStorage.getAll()).toHaveLength(2);
    expect(SiteRuntimeStorage.getAll()).toHaveLength(1);
    applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'cleaning',
      operator_name: 'Оп',
      checklist_confirmed: true,
    });
    expect(JSON.parse(localStorage.getItem('app_scale_switch_journal') || '[]')).toHaveLength(1);
  });

  it('TC-E2E: switch with spare device updates mirror', () => {
    ensureDefaultSiteAndScales({ ...DEFAULT_APP_SETTINGS, scale_device_id: 'microsim-m0601' });
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare')!;
    updateScaleConnectionDevice(spare.id, 'cas', false);
    applyScaleSetSwitch({
      to_set: 'spare',
      reason: 'repair',
      operator_name: 'Оп',
      checklist_confirmed: true,
    });
    expect(SettingsStorage.getAppSettings().scale_device_id).toBe('cas');
  });
});
