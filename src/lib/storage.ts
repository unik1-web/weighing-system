// Local storage abstraction for weighing system
import { scheduleConfigSync, scheduleDatabaseSync, flushDatabaseSync, DICTIONARIES_UPDATED_EVENT } from './storage-sync';
import { formatVehiclePlate } from './vehicle-plate';
import { formatPersonName, formatVehicleBrand } from './text-format';
import { ticketImportKey } from './import-keys';
import { normalizeWeighingMode, normalizeWeightSource, type WeighingMode } from './weighing-mode';
import { logger } from './logger';

export type WeightSource = 'manual' | 'instrument' | 'dictionary' | 'default';
export type TicketStatus = 'open' | 'completed';
export type ReoStatus = 'pending' | 'sent';
export type { WeighingMode };

export const REO_STATUS_LABELS: Record<ReoStatus, string> = {
  pending: 'Не отправлено',
  sent: 'Отправлено в РЭО',
};

export interface WeighingTicket {
  id: string;
  ticket_number: number | null;
  vehicle_number: string;
  vehicle_brand: string;
  trailer_number: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
  receiver_name: string;
  carrier_name: string;
  price: number;
  vat_rate: number;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
  total_amount: number | null;
  gross_source: WeightSource;
  tare_source: WeightSource;
  gross_raw: string | null;
  tare_raw: string | null;
  gross_datetime: string | null;
  tare_datetime: string | null;
  scale_device: string;
  operator_id: string | null;
  operator_name: string;
  status: TicketStatus;
  reo_status: ReoStatus;
  reo_sent_at: string | null;
  notes: string;
  created_at: string;
  completed_at: string | null;
  weighing_mode?: WeighingMode;
  version?: number;
}

export interface TicketAuditEvent {
  id: string;
  ticket_id: string;
  action: 'created' | 'completed';
  at: string;
  operator_name: string;
  operator_id: string | null;
}

export interface User {
  id: string;
  email: string;
  username: string;
}

export interface Profile {
  username: string;
  display_name: string;
  role: 'user' | 'admin';
}

export interface Session {
  user: User;
  profile: Profile;
}

const STORAGE_KEYS = {
  USERS: 'app_users',
  SESSIONS: 'app_sessions',
  TICKETS: 'app_weighing_tickets',
  TICKET_AUDIT: 'app_ticket_audit',
  VEHICLES: 'app_vehicles',
  DRIVERS: 'app_drivers',
  CARGOS: 'app_cargos',
  SHIPPERS: 'app_shippers',
  RECEIVERS: 'app_receivers',
  CARRIERS: 'app_carriers',
  SETTINGS: 'app_settings',
  CURRENT_USER: 'app_current_user',
};

function persist(key: string, value: string): void {
  localStorage.setItem(key, value);
  if (key === STORAGE_KEYS.SETTINGS) {
    scheduleConfigSync();
  } else {
    scheduleDatabaseSync();
  }
}

function hasStoredData(): boolean {
  return Object.values(STORAGE_KEYS).some((key) => localStorage.getItem(key) !== null);
}

// Users storage
export const UserStorage = {
  createUser: (username: string, password: string, displayName: string): User => {
    const users = getAllUsers();
    const normalizedUsername = username.trim().toLowerCase();
    
    if (users.some(u => u.username === normalizedUsername)) {
      throw new Error('Пользователь уже существует');
    }

    const user: User = {
      id: crypto.randomUUID(),
      email: `${normalizedUsername}@example.com`,
      username: normalizedUsername,
    };

    // Store user with hashed password (simple hash for demo)
    const storedUser = {
      ...user,
      passwordHash: btoa(password), // Simple encoding for demo (not secure!)
    };

    users.push(storedUser);
    persist(STORAGE_KEYS.USERS, JSON.stringify(users));

    // Create default profile
    const profile: Profile = {
      username: normalizedUsername,
      display_name: displayName,
      role: users.length === 1 ? 'admin' : 'user', // First user is admin
    };

    ProfileStorage.setProfile(user.id, profile);
    return user;
  },

  validatePassword: (username: string, password: string): User | null => {
    const users = getAllUsers();
    const normalizedUsername = username.trim().toLowerCase();
    const user = users.find(u => u.username === normalizedUsername);

    if (!user) return null;

    // Simple check for demo
    if (btoa(password) === user.passwordHash) {
      const { passwordHash, ...safeUser } = user;
      return safeUser as User;
    }

    return null;
  },

  getUserById: (id: string): User | null => {
    const users = getAllUsers();
    const user = users.find(u => u.id === id);
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;
    return safeUser as User;
  },

  getAllUsers: (): User[] => {
    const allStoredUsers = getAllUsers();
    return allStoredUsers.map(u => {
      const { passwordHash, ...safeUser } = u;
      return safeUser as User;
    });
  },

  updateProfile: (userId: string, updates: Partial<Profile>): void => {
    const profile = ProfileStorage.getProfile(userId);
    if (profile) {
      ProfileStorage.setProfile(userId, { ...profile, ...updates });
    }
  },

  deleteUser: (userId: string): void => {
    const users = getAllUsers().filter(u => u.id !== userId);
    persist(STORAGE_KEYS.USERS, JSON.stringify(users));
    ProfileStorage.deleteProfile(userId);
  },
};

function getAllUsers(): any[] {
  const stored = localStorage.getItem(STORAGE_KEYS.USERS);
  return stored ? JSON.parse(stored) : [];
}

// Profile storage
export const ProfileStorage = {
  getProfile: (userId: string): Profile | null => {
    const profiles = getAllProfiles();
    return profiles[userId] || null;
  },

  setProfile: (userId: string, profile: Profile): void => {
    const profiles = getAllProfiles();
    profiles[userId] = profile;
    persist(STORAGE_KEYS.USERS + '_profiles', JSON.stringify(profiles));
  },

  deleteProfile: (userId: string): void => {
    const profiles = getAllProfiles();
    delete profiles[userId];
    persist(STORAGE_KEYS.USERS + '_profiles', JSON.stringify(profiles));
  },

  getAllProfiles: (): Array<{ user_id: string } & Profile> => {
    const profiles = getAllProfiles();
    return Object.entries(profiles).map(([userId, profile]) => ({
      user_id: userId,
      ...profile,
      created_at: new Date().toISOString(),
    }));
  },
};

function getAllProfiles(): Record<string, Profile> {
  const stored = localStorage.getItem(STORAGE_KEYS.USERS + '_profiles');
  return stored ? JSON.parse(stored) : {};
}

// Session storage
export const SessionStorage = {
  setSession: (session: Session): void => {
    persist(STORAGE_KEYS.CURRENT_USER, JSON.stringify(session));
  },

  getSession: (): Session | null => {
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    return stored ? JSON.parse(stored) : null;
  },

  clearSession: (): void => {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  },
};

function normalizeTicket(ticket: WeighingTicket): WeighingTicket {
  const next: WeighingTicket = {
    ...ticket,
    reo_status: ticket.reo_status ?? 'pending',
    reo_sent_at: ticket.reo_sent_at ?? null,
    gross_source: normalizeWeightSource(ticket.gross_source as string),
    tare_source: normalizeWeightSource(ticket.tare_source as string),
  };
  if (ticket.weighing_mode === undefined) {
    next.weighing_mode = normalizeWeighingMode(ticket);
  }
  if (ticket.version === undefined) {
    next.version = 1;
  }
  return next;
}

// Weighing tickets storage
export const TicketStorage = {
  create: (
    ticket: Omit<WeighingTicket, 'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'> &
      Partial<Pick<WeighingTicket, 'reo_status' | 'reo_sent_at' | 'weighing_mode' | 'version'>>,
  ): WeighingTicket => {
    return TicketStorage.createMany([ticket])[0];
  },

  createMany: (
    tickets: Array<
      Omit<WeighingTicket, 'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'> &
        Partial<Pick<WeighingTicket, 'reo_status' | 'reo_sent_at' | 'weighing_mode' | 'version'>>
    >,
  ): WeighingTicket[] => {
    if (tickets.length === 0) return [];

    const stored = getAllTickets();
    let maxNumber = Math.max(0, ...stored.map((ticket) => ticket.ticket_number || 0));
    const createdAt = new Date().toISOString();
    const created: WeighingTicket[] = tickets.map((ticket) => {
      maxNumber += 1;
      const weighingMode =
        ticket.weighing_mode ??
        normalizeWeighingMode({ status: ticket.status, weighing_mode: ticket.weighing_mode });
      return normalizeTicket({
        id: crypto.randomUUID(),
        ticket_number: maxNumber,
        created_at: createdAt,
        reo_status: ticket.reo_status ?? 'pending',
        reo_sent_at: ticket.reo_sent_at ?? null,
        ...ticket,
        weighing_mode: weighingMode,
        version: 1,
      });
    });

    stored.push(...created);
    persist(STORAGE_KEYS.TICKETS, JSON.stringify(stored));

    for (const ticket of created) {
      TicketAuditStorage.append({
        ticket_id: ticket.id,
        action: 'created',
        at: createdAt,
        operator_name: ticket.operator_name,
        operator_id: ticket.operator_id,
      });
      if (ticket.status === 'completed') {
        TicketAuditStorage.append({
          ticket_id: ticket.id,
          action: 'completed',
          at: ticket.completed_at ?? createdAt,
          operator_name: ticket.operator_name,
          operator_id: ticket.operator_id,
        });
      }
    }

    return created;
  },

  getAll: (): WeighingTicket[] => {
    return getAllTickets()
      .map(normalizeTicket)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  getImportKeys: (): Set<string> => {
    return new Set(
      getAllTickets().map((ticket) =>
        ticketImportKey({
          gross_datetime: ticket.gross_datetime,
          tare_datetime: ticket.tare_datetime,
          vehicle_number: ticket.vehicle_number,
        }),
      ),
    );
  },

  getById: (id: string): WeighingTicket | null => {
    const ticket = getAllTickets().find(t => t.id === id);
    return ticket ? normalizeTicket(ticket) : null;
  },

  delete: (id: string): void => {
    const tickets = getAllTickets().filter(t => t.id !== id);
    persist(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
  },

  update: (
    id: string,
    updates: Partial<WeighingTicket>,
    options?: { expectedVersion?: number },
  ): WeighingTicket | null => {
    const tickets = getAllTickets();
    const index = tickets.findIndex((t) => t.id === id);
    if (index === -1) return null;

    const current = normalizeTicket(tickets[index]);
    if (
      options?.expectedVersion !== undefined &&
      options.expectedVersion !== current.version
    ) {
      logger.warn('tickets', 'Конфликт version', {
        id,
        expected: options.expectedVersion,
        actual: current.version,
      });
      return null;
    }

    const safeUpdates = { ...updates };
    delete safeUpdates.version;
    const wasCompleted = current.status === 'completed';
    const merged = normalizeTicket({
      ...current,
      ...safeUpdates,
      version: (current.version ?? 1) + 1,
    });

    tickets[index] = merged;
    persist(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));

    if (!wasCompleted && merged.status === 'completed') {
      TicketAuditStorage.append({
        ticket_id: merged.id,
        action: 'completed',
        at: merged.completed_at ?? new Date().toISOString(),
        operator_name: merged.operator_name,
        operator_id: merged.operator_id,
      });
    }

    return merged;
  },

  markReoSent: (id: string): WeighingTicket | null => {
    return TicketStorage.update(id, {
      reo_status: 'sent',
      reo_sent_at: new Date().toISOString(),
    });
  },

  markReoPending: (id: string): WeighingTicket | null => {
    return TicketStorage.update(id, {
      reo_status: 'pending',
      reo_sent_at: null,
    });
  },
};

function getAllTickets(): WeighingTicket[] {
  const stored = localStorage.getItem(STORAGE_KEYS.TICKETS);
  return stored ? JSON.parse(stored) : [];
}

/** Minimal create/complete audit events (sync key app_ticket_audit). */
export const TicketAuditStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.TICKET_AUDIT) === null) {
      localStorage.setItem(STORAGE_KEYS.TICKET_AUDIT, '[]');
    }
  },

  append(event: Omit<TicketAuditEvent, 'id'>): void {
    TicketAuditStorage.ensureInitialized();
    const events = TicketAuditStorage.getAll();
    events.push({
      id: crypto.randomUUID(),
      ...event,
    });
    persist(STORAGE_KEYS.TICKET_AUDIT, JSON.stringify(events));
  },

  getAll(): TicketAuditEvent[] {
    TicketAuditStorage.ensureInitialized();
    const stored = localStorage.getItem(STORAGE_KEYS.TICKET_AUDIT);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  getByTicketId(ticketId: string): TicketAuditEvent[] {
    return TicketAuditStorage.getAll().filter((e) => e.ticket_id === ticketId);
  },
};

// Dictionary storage
export type DictionaryTable = 'vehicles' | 'drivers' | 'cargos' | 'shippers' | 'receivers' | 'carriers';

export interface DictionaryEntry {
  id: string;
  name: string;
  notes: string;
  created_at: string;
  default_tare_weight?: number | null;
  default_price?: number | null;
  vehicle_brand?: string;
  vehicle_number?: string;
  inn?: string;
}

export const DICTIONARY_LABELS: Record<DictionaryTable, string> = {
  vehicles: 'Автомобили',
  drivers: 'Водители',
  cargos: 'Грузы',
  shippers: 'Грузоотправители',
  receivers: 'Грузополучатели',
  carriers: 'Грузоперевозчики',
};

export const DICTIONARY_TABLES: DictionaryTable[] = [
  'vehicles',
  'drivers',
  'cargos',
  'shippers',
  'receivers',
  'carriers',
];

export const DictionaryStorage = {
  getTable: (table: DictionaryTable): DictionaryEntry[] => {
    const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
    if (!key) return [];
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  },

  add: (table: DictionaryTable, entry: Omit<DictionaryEntry, 'id' | 'created_at'>): DictionaryEntry => {
    const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
    const items = DictionaryStorage.getTable(table);

    const normalizedEntry = { ...entry };
    if (table === 'vehicles') {
      const plate = formatVehiclePlate(entry.vehicle_number ?? entry.name);
      normalizedEntry.name = plate;
      normalizedEntry.vehicle_number = plate;
      if (normalizedEntry.vehicle_brand) {
        normalizedEntry.vehicle_brand = formatVehicleBrand(normalizedEntry.vehicle_brand);
      }
    } else if (table === 'drivers') {
      normalizedEntry.name = formatPersonName(entry.name);
    }

    const newEntry: DictionaryEntry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...normalizedEntry,
    };

    items.push(newEntry);
    persist(key, JSON.stringify(items));
    return newEntry;
  },

  update: (table: DictionaryTable, id: string, updates: Partial<DictionaryEntry>): DictionaryEntry | null => {
    const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
    const items = DictionaryStorage.getTable(table);
    const index = items.findIndex(i => i.id === id);
    if (index === -1) return null;

    const normalizedUpdates = { ...updates };
    if (table === 'vehicles') {
      const rawNumber = updates.vehicle_number ?? updates.name ?? items[index].vehicle_number ?? items[index].name;
      if (rawNumber) {
        const plate = formatVehiclePlate(String(rawNumber));
        normalizedUpdates.name = plate;
        normalizedUpdates.vehicle_number = plate;
      }
      if (normalizedUpdates.vehicle_brand) {
        normalizedUpdates.vehicle_brand = formatVehicleBrand(String(normalizedUpdates.vehicle_brand));
      }
    } else if (table === 'drivers') {
      const rawName = updates.name ?? items[index].name;
      if (rawName) {
        normalizedUpdates.name = formatPersonName(String(rawName));
      }
    }

    items[index] = { ...items[index], ...normalizedUpdates };
    persist(key, JSON.stringify(items));
    return items[index];
  },

  delete: (table: DictionaryTable, id: string): void => {
    const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
    const items = DictionaryStorage.getTable(table).filter(i => i.id !== id);
    persist(key, JSON.stringify(items));
  },

  clearAll: (): void => {
    for (const table of DICTIONARY_TABLES) {
      const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
      persist(key, JSON.stringify([]));
    }
  },
};

export function normalizeVehicleDictionaryPlates(): boolean {
  const items = DictionaryStorage.getTable('vehicles');
  if (items.length === 0) return false;

  let changed = false;
  const normalized = items.map((item) => {
    const raw = item.vehicle_number ?? item.name;
    const plate = formatVehiclePlate(raw);
    if (plate !== raw || plate !== item.name || plate !== item.vehicle_number) {
      changed = true;
      return { ...item, name: plate, vehicle_number: plate };
    }
    return item;
  });

  if (changed) {
    persist(STORAGE_KEYS.VEHICLES, JSON.stringify(normalized));
  }

  return changed;
}

// Settings storage
export type PrintLayout = 'act' | 'receipt';
export type NavTabMode = 'full' | 'compact';

export interface AppSettings {
  org_name: string;
  org_address: string;
  org_phone: string;
  org_inn: string;
  org_kpp: string;
  org_ogrn: string;
  org_bik: string;
  print_layout: PrintLayout;
  nav_tab_mode: NavTabMode;
  reo_enabled: boolean;
  reo_access_key: string;
  reo_object_id: string;
  reo_object_url: string;
  reo_cargo_names: string[];
  vescom_enabled: boolean;
  vescom_db_path: string;
  vescom_db_user: string;
  vescom_db_password: string;
  metra_enabled: boolean;
  metra_db_path: string;
  wa_enabled: boolean;
  wa_db_path: string;
  wa_db_user: string;
  wa_db_password: string;
  weighing_mode_default: WeighingMode;
  stable_mode: boolean;
  tara_threshold: number;
  max_time_between: number;
  tara_default: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  org_name: 'Полигон отходов',
  org_address: '',
  org_phone: '',
  org_inn: '',
  org_kpp: '',
  org_ogrn: '',
  org_bik: '',
  print_layout: 'act',
  nav_tab_mode: 'full',
  reo_enabled: false,
  reo_access_key: '',
  reo_object_id: '',
  reo_object_url: '',
  reo_cargo_names: [],
  vescom_enabled: false,
  vescom_db_path: '',
  vescom_db_user: 'SYSDBA',
  vescom_db_password: 'masterkey',
  metra_enabled: false,
  metra_db_path: '',
  wa_enabled: false,
  wa_db_path: 'C:\\Program Files (x86)\\WA',
  wa_db_user: 'SYSDBA',
  wa_db_password: 'masterkey',
  weighing_mode_default: 'single',
  stable_mode: false,
  tara_threshold: 15000,
  max_time_between: 24,
  tara_default: 0,
};

export const PRINT_LAYOUT_LABELS: Record<PrintLayout, string> = {
  act: 'Акт взвешивания',
  receipt: 'Талон (квитанция)',
};

export const NAV_TAB_MODE_LABELS: Record<NavTabMode, string> = {
  full: 'Полное — иконки с названиями',
  compact: 'Сжатое — только иконки',
};

export const SettingsStorage = {
  get: (key: string): string | null => {
    const settings = getAllSettings();
    return settings[key] ?? null;
  },

  set: (key: string, value: string): void => {
    const settings = getAllSettings();
    settings[key] = value;
    persist(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  getAppSettings: (): AppSettings => {
    const stored = getAllSettings();
    const parseNumber = (raw: string | undefined, fallback: number): number => {
      if (raw === undefined || raw === '') return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    const weighingMode =
      stored.weighing_mode_default === 'dual' || stored.weighing_mode_default === 'single'
        ? stored.weighing_mode_default
        : DEFAULT_APP_SETTINGS.weighing_mode_default;
    return {
      org_name: stored.org_name ?? DEFAULT_APP_SETTINGS.org_name,
      org_address: stored.org_address ?? DEFAULT_APP_SETTINGS.org_address,
      org_phone: stored.org_phone ?? DEFAULT_APP_SETTINGS.org_phone,
      org_inn: stored.org_inn ?? DEFAULT_APP_SETTINGS.org_inn,
      org_kpp: stored.org_kpp ?? DEFAULT_APP_SETTINGS.org_kpp,
      org_ogrn: stored.org_ogrn ?? DEFAULT_APP_SETTINGS.org_ogrn,
      org_bik: stored.org_bik ?? DEFAULT_APP_SETTINGS.org_bik,
      print_layout: (stored.print_layout as PrintLayout) ?? DEFAULT_APP_SETTINGS.print_layout,
      nav_tab_mode: stored.nav_tab_mode === 'compact' ? 'compact' : 'full',
      reo_enabled: stored.reo_enabled === 'true',
      reo_access_key: stored.reo_access_key ?? DEFAULT_APP_SETTINGS.reo_access_key,
      reo_object_id: stored.reo_object_id ?? DEFAULT_APP_SETTINGS.reo_object_id,
      reo_object_url: stored.reo_object_url ?? DEFAULT_APP_SETTINGS.reo_object_url,
      reo_cargo_names: parseReoCargoNames(stored.reo_cargo_names),
      vescom_enabled: stored.vescom_enabled === 'true',
      vescom_db_path: stored.vescom_db_path ?? DEFAULT_APP_SETTINGS.vescom_db_path,
      vescom_db_user: stored.vescom_db_user ?? DEFAULT_APP_SETTINGS.vescom_db_user,
      vescom_db_password: stored.vescom_db_password ?? DEFAULT_APP_SETTINGS.vescom_db_password,
      metra_enabled: stored.metra_enabled === 'true',
      metra_db_path: stored.metra_db_path ?? DEFAULT_APP_SETTINGS.metra_db_path,
      wa_enabled: stored.wa_enabled === 'true',
      wa_db_path: stored.wa_db_path ?? DEFAULT_APP_SETTINGS.wa_db_path,
      wa_db_user: stored.wa_db_user ?? DEFAULT_APP_SETTINGS.wa_db_user,
      wa_db_password: stored.wa_db_password ?? DEFAULT_APP_SETTINGS.wa_db_password,
      weighing_mode_default: weighingMode,
      stable_mode: stored.stable_mode === 'true',
      tara_threshold: parseNumber(stored.tara_threshold, DEFAULT_APP_SETTINGS.tara_threshold),
      max_time_between: parseNumber(stored.max_time_between, DEFAULT_APP_SETTINGS.max_time_between),
      tara_default: parseNumber(stored.tara_default, DEFAULT_APP_SETTINGS.tara_default),
    };
  },

  updateAppSettings: (updates: Partial<AppSettings>): AppSettings => {
    const current = SettingsStorage.getAppSettings();
    const next = { ...current, ...updates };
    const flat: Record<string, string> = {
      org_name: next.org_name,
      org_address: next.org_address,
      org_phone: next.org_phone,
      org_inn: next.org_inn,
      org_kpp: next.org_kpp,
      org_ogrn: next.org_ogrn,
      org_bik: next.org_bik,
      print_layout: next.print_layout,
      nav_tab_mode: next.nav_tab_mode,
      reo_enabled: String(next.reo_enabled),
      reo_access_key: next.reo_access_key,
      reo_object_id: next.reo_object_id,
      reo_object_url: next.reo_object_url,
      reo_cargo_names: JSON.stringify(next.reo_cargo_names),
      vescom_enabled: String(next.vescom_enabled),
      vescom_db_path: next.vescom_db_path,
      vescom_db_user: next.vescom_db_user,
      vescom_db_password: next.vescom_db_password,
      metra_enabled: String(next.metra_enabled),
      metra_db_path: next.metra_db_path,
      wa_enabled: String(next.wa_enabled),
      wa_db_path: next.wa_db_path,
      wa_db_user: next.wa_db_user,
      wa_db_password: next.wa_db_password,
      weighing_mode_default: next.weighing_mode_default,
      stable_mode: String(next.stable_mode),
      tara_threshold: String(next.tara_threshold),
      max_time_between: String(next.max_time_between),
      tara_default: String(next.tara_default),
    };
    persist(STORAGE_KEYS.SETTINGS, JSON.stringify(flat));
    return next;
  },
};

function getAllSettings(): Record<string, string> {
  const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  return stored ? JSON.parse(stored) : {};
}

function parseReoCargoNames(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function clearAllDictionaries(): Promise<void> {
  DictionaryStorage.clearAll();
  await flushDatabaseSync();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DICTIONARIES_UPDATED_EVENT));
  }
}

// Initialize default data (only on first run)
export const initializeStorage = () => {
  if (hasStoredData()) {
    TicketAuditStorage.ensureInitialized();
    return;
  }

  try {
    UserStorage.createUser('admin', 'admin123', 'Администратор');
  } catch {
    // Default admin user already exists
  }

  DictionaryStorage.add('vehicles', {
    name: 'А001АА',
    vehicle_number: 'А001АА',
    notes: 'Тестовый грузовик',
    default_tare_weight: 2500,
  });

  SettingsStorage.set('org_name', 'Полигон отходов');
  TicketAuditStorage.ensureInitialized();
};
