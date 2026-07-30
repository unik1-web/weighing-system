import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProfileStorage,
  SessionStorage,
  SettingsStorage,
  TicketStorage,
  UserStorage,
  type WeighingTicket,
} from '../storage';

function createMemoryLocalStorage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryLocalStorage());
  vi.stubGlobal('crypto', {
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
  });
});

function baseTicket(
  overrides: Partial<WeighingTicket> = {},
): Omit<WeighingTicket, 'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'> {
  return {
    vehicle_number: 'А123ВС56',
    vehicle_brand: 'Камаз',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'ТКО',
    shipper_name: 'Отправитель',
    receiver_name: 'Получатель',
    carrier_name: 'Перевозчик',
    price: 0,
    vat_rate: 0,
    gross_weight: 12000,
    tare_weight: 8000,
    net_weight: 4000,
    total_amount: 0,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-07-28 10:00:00',
    tare_datetime: '2026-07-28 11:00:00',
    scale_device: '',
    operator_id: null,
    operator_name: 'admin',
    status: 'completed',
    notes: '',
    completed_at: '2026-07-28T11:00:00.000Z',
    ...overrides,
  };
}

describe('UserStorage auth', () => {
  it('creates first user as admin and validates password case-insensitively', () => {
    const admin = UserStorage.createUser('Admin', 'secret', 'Админ');
    expect(admin.username).toBe('admin');
    expect(ProfileStorage.getProfile(admin.id)?.role).toBe('admin');

    const validated = UserStorage.validatePassword('  ADMIN  ', 'secret');
    expect(validated?.id).toBe(admin.id);
    expect(validated).not.toHaveProperty('passwordHash');
    expect(UserStorage.validatePassword('admin', 'wrong')).toBeNull();
  });

  it('rejects duplicate usernames and makes subsequent users non-admin', () => {
    UserStorage.createUser('admin', 'secret', 'Админ');
    expect(() => UserStorage.createUser('ADMIN', 'other', 'Дубль')).toThrow('Пользователь уже существует');

    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-000000000002',
    });
    const operator = UserStorage.createUser('operator', 'pass', 'Оператор');
    expect(ProfileStorage.getProfile(operator.id)?.role).toBe('user');
  });
});

describe('SessionStorage', () => {
  it('persists and clears the current session', () => {
    const user = UserStorage.createUser('admin', 'secret', 'Админ');
    const profile = ProfileStorage.getProfile(user.id)!;
    SessionStorage.setSession({ user, profile });

    expect(SessionStorage.getSession()?.user.username).toBe('admin');
    SessionStorage.clearSession();
    expect(SessionStorage.getSession()).toBeNull();
  });
});

describe('TicketStorage', () => {
  it('assigns sequential ticket numbers and tracks import keys', () => {
    const created = TicketStorage.createMany([
      baseTicket(),
      baseTicket({
        vehicle_number: 'В456ОР77',
        gross_datetime: '2026-07-28 12:00:00',
        tare_datetime: '2026-07-28 13:00:00',
      }),
    ]);

    expect(created.map((ticket) => ticket.ticket_number)).toEqual([1, 2]);
    expect(created[0].reo_status).toBe('pending');

    const keys = TicketStorage.getImportKeys();
    expect(keys.has('2026-07-28 10:00:00_2026-07-28 11:00:00_А123ВС56')).toBe(true);
    expect(keys.has('2026-07-28 12:00:00_2026-07-28 13:00:00_В456ОР77')).toBe(true);
  });

  it('marks REO sent and pending', () => {
    const ticket = TicketStorage.create(baseTicket());
    const sent = TicketStorage.markReoSent(ticket.id);
    expect(sent?.reo_status).toBe('sent');
    expect(sent?.reo_sent_at).toBeTruthy();

    const pending = TicketStorage.markReoPending(ticket.id);
    expect(pending?.reo_status).toBe('pending');
    expect(pending?.reo_sent_at).toBeNull();
  });
});

describe('SettingsStorage REO cargo parsing', () => {
  it('round-trips cargo names and ignores invalid JSON', () => {
    SettingsStorage.updateAppSettings({
      reo_enabled: true,
      reo_cargo_names: ['ТКО', 'Песок'],
    });
    expect(SettingsStorage.getAppSettings().reo_cargo_names).toEqual(['ТКО', 'Песок']);

    localStorage.setItem(
      'app_settings',
      JSON.stringify({
        reo_cargo_names: '{not-json',
        nav_tab_mode: 'compact',
      }),
    );
    const settings = SettingsStorage.getAppSettings();
    expect(settings.reo_cargo_names).toEqual([]);
    expect(settings.nav_tab_mode).toBe('compact');
  });
});
