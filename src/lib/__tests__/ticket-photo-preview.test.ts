import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPhotoPreviewGroups,
  buildPhotoPreviewSlots,
} from '@/components/TicketPhotoPreview';
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

function baseTicket(overrides?: Partial<WeighingTicket>): WeighingTicket {
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
    ...overrides,
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

function photo(partial: Partial<TicketPhoto> & Pick<TicketPhoto, 'id' | 'phase' | 'camera_role'>): TicketPhoto {
  return {
    ticket_id: 't1',
    camera_id: null,
    relative_path: null,
    status: 'ok',
    error_message: null,
    camera_mode: 'normal',
    created_at: '2026-08-02T10:00:00',
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

  it('dual tare+gross same camera_id → two groups, paths not collapsed', () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    CamerasStorage.replaceAll([
      cam({ id: 'c-entry', role: 'entry', name: 'Въезд', sort_order: 0 }),
    ]);
    const photos: TicketPhoto[] = [
      photo({
        id: 'p-tare',
        phase: 'tare',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: 'Photo/tare_entry.jpg',
        created_at: '2026-08-02T09:00:00',
      }),
      photo({
        id: 'p-gross',
        phase: 'gross',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: 'Photo/gross_entry.jpg',
        created_at: '2026-08-02T10:00:00',
      }),
    ];
    const groups = buildPhotoPreviewGroups(
      baseTicket({
        weighing_mode: 'dual',
        tare_datetime: '2026-08-02T09:00:00',
        gross_datetime: '2026-08-02T10:00:00',
      }),
      photos,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toBe('Тара');
    expect(groups[1].title).toBe('Брутто');
    expect(groups[0].slots[0].relative_path).toBe('Photo/tare_entry.jpg');
    expect(groups[1].slots[0].relative_path).toBe('Photo/gross_entry.jpg');
    expect(groups[0].slots[0].key).toBe('c-entry|tare');
    expect(groups[1].slots[0].key).toBe('c-entry|gross');
  });

  it('dual with only tare rows → one Тара group, no empty Брутто', () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    CamerasStorage.replaceAll([
      cam({ id: 'c-entry', role: 'entry', name: 'Въезд', sort_order: 0 }),
    ]);
    const photos: TicketPhoto[] = [
      photo({
        id: 'p-tare',
        phase: 'tare',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: 'Photo/tare_only.jpg',
      }),
    ];
    const groups = buildPhotoPreviewGroups(
      baseTicket({ weighing_mode: 'dual' }),
      photos,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBeNull();
    expect(groups[0].phase).toBe('tare');
    expect(groups[0].slots[0].relative_path).toBe('Photo/tare_only.jpg');
  });

  it('single phase → flat list with title=null', () => {
    SettingsStorage.updateAppSettings({ video_enabled: true });
    CamerasStorage.replaceAll([
      cam({ id: 'c-entry', role: 'entry', name: 'Въезд', sort_order: 0 }),
    ]);
    const photos: TicketPhoto[] = [
      photo({
        id: 'p1',
        phase: 'gross',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: 'Photo/single.jpg',
      }),
    ];
    const groups = buildPhotoPreviewGroups(baseTicket({ weighing_mode: 'single' }), photos);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBeNull();
    expect(groups[0].slots).toHaveLength(1);
  });

  it('buildSlotsFromPhotos path: two phases one camera_id → two slots', () => {
    SettingsStorage.updateAppSettings({ video_enabled: false });
    // no cameras → photos-only builder
    const photos: TicketPhoto[] = [
      photo({
        id: 'p-tare',
        phase: 'tare',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: 'Photo/tare.jpg',
        created_at: '2026-08-02T09:00:00',
      }),
      photo({
        id: 'p-gross',
        phase: 'gross',
        camera_id: 'c-entry',
        camera_role: 'entry',
        relative_path: 'Photo/gross.jpg',
        created_at: '2026-08-02T10:00:00',
      }),
    ];
    const groups = buildPhotoPreviewGroups(
      baseTicket({
        weighing_mode: 'dual',
        tare_datetime: null,
        gross_datetime: null,
      }),
      photos,
    );
    expect(groups).toHaveLength(2);
    const keys = groups.flatMap((g) => g.slots.map((s) => s.key));
    expect(keys).toEqual(['c-entry|tare', 'c-entry|gross']);
  });

  it('stubs without photos → one flat group with stub keys', () => {
    SettingsStorage.updateAppSettings({ video_enabled: false });
    const ticket = baseTicket({
      photo_entry_path: 'Photo/stub_entry.jpg',
      photo_overview_path: 'Photo/stub_ov.jpg',
    });
    const groups = buildPhotoPreviewGroups(ticket, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBeNull();
    expect(groups[0].slots.map((s) => s.key)).toEqual(['stub-entry', 'stub-overview']);
  });

  it('group order: tare_datetime earlier → Тара first; both null → Тара then Брутто', () => {
    SettingsStorage.updateAppSettings({ video_enabled: false });
    const photos: TicketPhoto[] = [
      photo({
        id: 'p-gross',
        phase: 'gross',
        camera_id: 'c1',
        camera_role: 'entry',
        relative_path: 'Photo/g.jpg',
        created_at: '2026-08-02T08:00:00',
      }),
      photo({
        id: 'p-tare',
        phase: 'tare',
        camera_id: 'c1',
        camera_role: 'entry',
        relative_path: 'Photo/t.jpg',
        created_at: '2026-08-02T12:00:00',
      }),
    ];

    const byDatetime = buildPhotoPreviewGroups(
      baseTicket({
        weighing_mode: 'dual',
        tare_datetime: '2026-08-02T09:00:00',
        gross_datetime: '2026-08-02T10:00:00',
      }),
      photos,
    );
    expect(byDatetime.map((g) => g.title)).toEqual(['Тара', 'Брутто']);

    const bothNull = buildPhotoPreviewGroups(
      baseTicket({
        weighing_mode: 'dual',
        tare_datetime: null,
        gross_datetime: null,
      }),
      photos,
    );
    // primary datetime both null → secondary created_at: gross earlier, so gross first
    expect(bothNull.map((g) => g.title)).toEqual(['Брутто', 'Тара']);

    const equalCreated = buildPhotoPreviewGroups(
      baseTicket({
        weighing_mode: 'dual',
        tare_datetime: null,
        gross_datetime: null,
      }),
      [
        photo({
          id: 'p-g',
          phase: 'gross',
          camera_id: 'c1',
          camera_role: 'entry',
          relative_path: 'Photo/g2.jpg',
          created_at: '2026-08-02T10:00:00',
        }),
        photo({
          id: 'p-t',
          phase: 'tare',
          camera_id: 'c1',
          camera_role: 'entry',
          relative_path: 'Photo/t2.jpg',
          created_at: '2026-08-02T10:00:00',
        }),
      ],
    );
    expect(equalCreated.map((g) => g.title)).toEqual(['Тара', 'Брутто']);
  });
});
