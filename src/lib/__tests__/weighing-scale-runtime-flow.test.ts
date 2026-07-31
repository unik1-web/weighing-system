/**
 * No-mock E2E flow for weighing + scale runtime stubs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, ScaleStorage, SettingsStorage, TicketAuditStorage, TicketStorage } from '../storage';
import {
  DEFAULT_SITE_ID,
  applyScaleSetSwitch,
  ensureDefaultSiteAndScales,
  getActiveScale,
  ticketScaleFieldsFromRuntime,
  updateScaleConfiguration,
} from '../site';
import { ScaleRuntimeClient } from '../scale-runtime-client';
import { SCALE_DEVICES, scaleConnection } from '../scales';

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

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

installLocalStorage();

beforeEach(() => {
  localStorage.clear();
  TicketAuditStorage.ensureInitialized();
  vi.restoreAllMocks();
  vi.spyOn(scaleConnection, 'connect').mockResolvedValue(undefined);
  vi.spyOn(scaleConnection, 'isConnected').mockReturnValue(true);
  vi.spyOn(scaleConnection, 'disconnect').mockResolvedValue(undefined);
  vi.spyOn(scaleConnection, 'onReading').mockImplementation((listener) => {
    listener({
      weight: 12345,
      unit: 'kg',
      stable: true,
      negative: false,
      raw: 'ST 12345 kg',
    });
    return () => undefined;
  });
});

describe('weighing scale runtime flow', () => {
  it('TC-E2E-01/02/03: primary+spare runtime and manual_only fallback', async () => {
    ensureDefaultSiteAndScales({
      ...DEFAULT_APP_SETTINGS,
      scale_device_id: 'cas',
    });

    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare');
    expect(primary).not.toBeNull();
    expect(spare).not.toBeNull();
    if (!primary || !spare) throw new Error('scale fixtures not initialized');

    updateScaleConfiguration(
      primary.id,
      {
        adapter_id: 'cas',
        connection: {
          transport: 'web_serial',
          device_id: 'cas',
        },
      },
      true,
    );

    const runtimeClient = new ScaleRuntimeClient();
    const connectPrimary = await runtimeClient.connect(getActiveScale()!);
    expect(connectPrimary).toEqual({ mode: 'web_serial', status: 'connected' });
    const readingPrimary = await runtimeClient.read(1000);
    expect(readingPrimary?.value).toBe(12345);

    const primaryFields = ticketScaleFieldsFromRuntime();
    expect(primaryFields?.scale_role).toBe('primary');
    const primaryTicket = TicketStorage.create({
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
      gross_weight: readingPrimary!.value,
      tare_weight: readingPrimary!.value,
      net_weight: 0,
      total_amount: 0,
      gross_source: 'instrument',
      tare_source: 'instrument',
      gross_raw: readingPrimary!.raw,
      tare_raw: readingPrimary!.raw,
      gross_datetime: readingPrimary!.captured_at,
      tare_datetime: readingPrimary!.captured_at,
      scale_device: SCALE_DEVICES.cas.name,
      manual_weight_reason: null,
      operator_id: null,
      operator_name: 'Оператор',
      status: 'completed',
      reo_status: 'pending',
      reo_sent_at: null,
      notes: '',
      completed_at: readingPrimary!.captured_at,
      weighing_mode: 'single',
      version: 1,
      site_id: primaryFields!.site_id,
      scale_id: primaryFields!.scale_id,
      scale_role: primaryFields!.scale_role,
      photo_entry_path: null,
      photo_exit_path: null,
    });
    expect(primaryTicket.gross_source).toBe('instrument');
    expect(primaryTicket.site_id).toBe(DEFAULT_SITE_ID);
    expect(primaryTicket.scale_role).toBe('primary');
    expect(primaryTicket.scale_device).toBe(SCALE_DEVICES.cas.name);

    updateScaleConfiguration(
      spare.id,
      {
        adapter_id: 'newton',
        connection: {
          transport: 'serial_backend',
          device_id: 'newton',
          serial: {
            port: 'COM-STUB',
            baud_rate: 9600,
            data_bits: 8,
            stop_bits: 1,
            parity: 'none',
            line_terminator: '\r\n',
            read_timeout_ms: 1000,
          },
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

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response({
          success: true,
          session_id: 's-1',
          status: 'connected',
          scale: {
            site_id: DEFAULT_SITE_ID,
            scale_id: spare.id,
            scale_role: 'spare',
            adapter_id: 'newton',
            transport: 'serial_backend',
          },
          reading: null,
        }),
      )
      .mockResolvedValueOnce(
        response({
          success: true,
          session_id: 's-1',
          status: 'reading',
          reading: {
            value: 12345,
            stable: true,
            raw: 'STUB 12345 kg',
            captured_at: '2026-07-31T00:00:01Z',
          },
        }),
      );

    const connectSpare = await runtimeClient.connect(getActiveScale()!);
    expect(connectSpare).toEqual({ mode: 'backend_api', status: 'connected' });
    const readingSpare = await runtimeClient.read(1000);
    expect(readingSpare?.value).toBe(12345);

    const spareFields = ticketScaleFieldsFromRuntime();
    const spareTicket = TicketStorage.create({
      vehicle_number: 'В002ВВ56',
      vehicle_brand: 'КамАЗ',
      trailer_number: '',
      driver_name: 'Петров П.П.',
      cargo_name: 'ТКО',
      shipper_name: 'ООО Ромашка',
      receiver_name: 'Полигон',
      carrier_name: 'Перевозчик',
      price: 100,
      vat_rate: 20,
      gross_weight: readingSpare!.value,
      tare_weight: readingSpare!.value,
      net_weight: 0,
      total_amount: 0,
      gross_source: 'instrument',
      tare_source: 'instrument',
      gross_raw: readingSpare!.raw,
      tare_raw: readingSpare!.raw,
      gross_datetime: readingSpare!.captured_at,
      tare_datetime: readingSpare!.captured_at,
      scale_device: SCALE_DEVICES.newton.name,
      manual_weight_reason: null,
      operator_id: null,
      operator_name: 'Оператор',
      status: 'completed',
      reo_status: 'pending',
      reo_sent_at: null,
      notes: '',
      completed_at: readingSpare!.captured_at,
      weighing_mode: 'single',
      version: 1,
      site_id: spareFields!.site_id,
      scale_id: spareFields!.scale_id,
      scale_role: spareFields!.scale_role,
      photo_entry_path: null,
      photo_exit_path: null,
    });
    expect(spareTicket.scale_role).toBe('spare');

    updateScaleConfiguration(
      primary.id,
      {
        adapter_id: 'web_serial',
        connection: {
          transport: 'web_serial',
          device_id: null,
        },
      },
      false,
    );
    applyScaleSetSwitch({
      to_set: 'primary',
      reason: 'verification',
      operator_name: 'Оператор',
      checklist_confirmed: true,
    });
    const manualOnlyResult = await runtimeClient.connect(getActiveScale()!);
    expect(manualOnlyResult.status).toBe('manual_only');
    await expect(runtimeClient.read(1000)).resolves.toBeNull();
  });
});
