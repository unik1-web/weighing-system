import { beforeEach, describe, expect, it } from 'vitest';
import { buildPhotoPreviewSlots } from '@/components/TicketPhotoPreview';
import {
  CamerasStorage,
  SettingsStorage,
  type Camera,
  type TicketPhoto,
  type WeighingTicket,
} from '@/lib/storage';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
  });
}

installLocalStorage();

function baseTicket(): WeighingTicket {
  return {
    id: 't1',
    ticket_number: 1,
    vehicle_number: 'А001АА56',
    vehicle_brand: '',
    trailer_number: '',
    driver_name: '',
    cargo_name: '',
    shipper_name: '',
    receiver_name: '',
    carrier_name: '',
    price: 0,
    vat_rate: 0,
    gross_weight: 1000,
    tare_weight: 500,
    net_weight: 500,
    total_amount: 0,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-08-02T10:00:00',
    tare_datetime: '2026-08-02T10:05:00',
    scale_device: '',
    operator_id: null,
    operator_name: '',
    status: 'completed',
    reo_status: 'pending',
    reo_sent_at: null,
    notes: '',
    created_at: '2026-08-02T10:00:00',
    completed_at: '2026-08-02T10:05:00',
    weighing_mode: 'single',
    version: 1,
    site_id: 'site-1',
    scale_id: null,
    scale_role: null,
    photo_entry_path: null,
    photo_exit_path: null,
    photo_overview_path: null,
    plate_source: null,
    manual_weight_reason: null,
    auto_closed: false,
    anpr_plate_raw: null,
    plate_confidence: null,
    anpr_accepted: null,
    anpr_status: null,
  };
}

function cam(partial: Partial<Camera> & Pick<Camera, 'id' | 'role'>): Camera {
  return {
    site_id: 'site-1',
    name: partial.role,
    capture_url: 'http://127.0.0.1/x.jpg',
    capture_kind: 'http_snapshot',
    enabled: true,
    sort_order: 0,
    roi: null,
    reference_normal_path: null,
    reference_spare_path: null,
    created_at: '2026-08-02T00:00:00',
    ...partial,
  };
}

describe('TicketPhotoPreview slots', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds one slot per enabled camera with failed visible', () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    CamerasStorage.replaceAll([
      cam({ id: 'c-entry', role: 'entry', name: 'Въезд', sort_order: 0 }),
      cam({ id: 'c-ov', role: 'overview', name: 'Обзор', sort_order: 1 }),
    ]);
    const photos: TicketPhoto[] = [
      {
        id: 'p1',
        ticket_id: 't1',
        phase: 'gross',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: null,
        status: 'failed',
        error_message: 'timeout',
        camera_mode: 'normal',
        created_at: '2026-08-02T10:00:00',
      },
      {
        id: 'p2',
        ticket_id: 't1',
        phase: 'gross',
        camera_id: 'c-ov',
        camera_role: 'overview',
        relative_path: 'Photo/ok.jpg',
        status: 'ok',
        error_message: null,
        camera_mode: 'normal',
        created_at: '2026-08-02T10:00:00',
      },
    ];
    const slots = buildPhotoPreviewSlots(baseTicket(), photos);
    expect(slots).toHaveLength(2);
    expect(slots[0].status).toBe('failed');
    expect(slots[0].error_message).toBe('timeout');
    expect(slots[1].status).toBe('ok');
    expect(slots[1].relative_path).toBe('Photo/ok.jpg');
  });

  it('marks missing when video expected and no photo row', () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    CamerasStorage.replaceAll([cam({ id: 'c1', role: 'entry', sort_order: 0 })]);
    const slots = buildPhotoPreviewSlots(baseTicket(), []);
    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe('missing');
  });
});
