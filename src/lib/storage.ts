// Local storage abstraction for weighing system
import { scheduleConfigSync, scheduleDatabaseSync, flushDatabaseSync, DICTIONARIES_UPDATED_EVENT } from './storage-sync';
import { formatVehiclePlate, normalizeVehicleKey } from './vehicle-plate';
import { formatPersonName, formatVehicleBrand } from './text-format';
import { ticketImportKey } from './import-keys';
import { normalizeWeighingMode, normalizeWeightSource, type WeighingMode } from './weighing-mode';
import { normalizeScaleDeviceId, type ScaleDeviceId } from './scales';
import { logger } from './logger';
import type { ParserDraft, ScaleTransport, SerialDraft, TcpDraft } from './scale-adapters/contract';
import type { Camera, CameraRole, CaptureEvent, TicketPhoto } from './cameras';

export type { Camera, CameraRole, CaptureEvent, TicketPhoto } from './cameras';

export type WeightSource = 'manual' | 'instrument' | 'dictionary' | 'default';
export type TicketStatus = 'open' | 'completed';
export type ReoStatus = 'pending' | 'sent';
export type DriverInputMode = 'vehicle' | 'all' | 'free';
export type PlateSource = 'anpr' | 'operator' | 'directory';
export type ScaleRole = 'primary' | 'spare';
export type ScaleSet = 'primary' | 'spare';
export type CameraMode = 'primary' | 'spare';
export type AnprMode = 'enabled' | 'disabled_by_configuration' | 'failed';
export type SwitchReason = 'repair' | 'cleaning' | 'verification' | 'other';
export type { WeighingMode, ScaleDeviceId };

export interface ScaleConnectionJson {
  transport: ScaleTransport;
  device_id: ScaleDeviceId | null;
  serial?: SerialDraft;
  tcp?: TcpDraft;
  parser?: ParserDraft;
}

export interface Site {
  id: string;
  name: string;
  created_at: string;
}

export interface Scale {
  id: string;
  site_id: string;
  role: ScaleSet;
  adapter_id: string;
  connection: ScaleConnectionJson;
  name?: string;
  created_at: string;
}

export interface SiteRuntime {
  site_id: string;
  active_scale_set: ScaleSet;
  camera_mode: CameraMode;
  anpr_mode: AnprMode;
  last_switch_reason: SwitchReason | null;
  last_switch_comment: string | null;
  last_switch_operator_name: string | null;
  last_switch_operator_id: string | null;
  last_switch_at: string | null;
  updated_at: string;
}

export interface ScaleSwitchJournalEntry {
  id: string;
  site_id: string;
  from_set: ScaleSet;
  to_set: ScaleSet;
  reason: SwitchReason;
  comment: string | null;
  operator_name: string;
  operator_id: string | null;
  switched_at: string;
}

export function normalizeDriverInputMode(raw: string | null | undefined): DriverInputMode {
  if (raw === 'vehicle' || raw === 'all' || raw === 'free') return raw;
  return 'vehicle';
}

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
  manual_weight_reason?: string | null;
  operator_id: string | null;
  operator_name: string;
  status: TicketStatus;
  reo_status: ReoStatus;
  reo_sent_at: string | null;
  auto_closed?: boolean;
  notes: string;
  created_at: string;
  completed_at: string | null;
  weighing_mode?: WeighingMode;
  version?: number;
  plate_source?: PlateSource | null;
  site_id?: string | null;
  scale_id?: string | null;
  scale_role?: ScaleRole | null;
  photo_entry_path?: string | null;
  photo_exit_path?: string | null;
  /** Transient capture-merge marker for post-capture flush (not a DB column). */
  capture_token?: string | null;
  readonly year?: number;
}

export interface VehicleDriverRecord {
  id: string;
  vehicle_key: string;
  driver_name: string;
  last_used_at: string;
  use_count: number;
}

export interface TicketAuditEvent {
  id: string;
  ticket_id: string;
  action: 'created' | 'completed' | 'auto_close' | 'archive_edit';
  event_type?: 'created' | 'completed' | 'auto_close' | 'archive_edit';
  source_year?: number;
  changed_fields?: string[];
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  reo_divergence_warning?: boolean;
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
  VEHICLE_DRIVERS: 'app_vehicle_drivers',
  SITES: 'app_sites',
  SCALES: 'app_scales',
  SITE_RUNTIME: 'app_site_runtime',
  SCALE_SWITCH_JOURNAL: 'app_scale_switch_journal',
  CAMERAS: 'app_cameras',
  TICKET_PHOTOS: 'app_ticket_photos',
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

function normalizePlateSource(raw: unknown): PlateSource | null {
  if (raw === 'anpr' || raw === 'operator' || raw === 'directory') return raw;
  return null;
}

function normalizeScaleRole(raw: unknown): ScaleRole | null {
  if (raw === 'primary' || raw === 'spare') return raw;
  return null;
}

function normalizeNullableString(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw);
}

function normalizeTicket(ticket: WeighingTicket): WeighingTicket {
  const inferredYear =
    typeof ticket.created_at === 'string' && ticket.created_at.length >= 4
      ? Number.parseInt(ticket.created_at.slice(0, 4), 10)
      : NaN;
  const next: WeighingTicket = {
    ...ticket,
    reo_status: ticket.reo_status ?? 'pending',
    reo_sent_at: ticket.reo_sent_at ?? null,
    auto_closed: ticket.auto_closed ?? false,
    gross_source: normalizeWeightSource(ticket.gross_source as string),
    tare_source: normalizeWeightSource(ticket.tare_source as string),
    plate_source: normalizePlateSource(ticket.plate_source),
    site_id: normalizeNullableString(ticket.site_id),
    scale_id: normalizeNullableString(ticket.scale_id),
    scale_role: normalizeScaleRole(ticket.scale_role),
    manual_weight_reason: normalizeNullableString(ticket.manual_weight_reason),
    photo_entry_path:
      ticket.photo_entry_path === undefined || ticket.photo_entry_path === null
        ? null
        : String(ticket.photo_entry_path),
    photo_exit_path:
      ticket.photo_exit_path === undefined || ticket.photo_exit_path === null
        ? null
        : String(ticket.photo_exit_path),
    year:
      typeof ticket.year === 'number'
        ? ticket.year
        : Number.isFinite(inferredYear)
          ? inferredYear
          : undefined,
  };
  const mode = normalizeWeighingMode(ticket);
  if (ticket.weighing_mode !== mode) {
    next.weighing_mode = mode;
  }
  if (ticket.version === undefined) {
    next.version = 1;
  }
  return next;
}

function resolveActiveYear(): number | null {
  const { active_year } = SettingsStorage.getAppSettings();
  return typeof active_year === 'number' ? active_year : null;
}

function ticketMatchesActiveYear(ticket: WeighingTicket, activeYear: number | null): boolean {
  if (activeYear === null) return true;
  if (typeof ticket.year === 'number') return ticket.year === activeYear;
  if (typeof ticket.created_at === 'string' && ticket.created_at.length >= 4) {
    const parsedYear = Number.parseInt(ticket.created_at.slice(0, 4), 10);
    return Number.isFinite(parsedYear) && parsedYear === activeYear;
  }
  return false;
}

function normalizeAuditEvent(raw: unknown): TicketAuditEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const eventType = source.event_type;
  const actionRaw = source.action;
  const action =
    actionRaw === 'created' || actionRaw === 'completed' || actionRaw === 'auto_close' || actionRaw === 'archive_edit'
      ? actionRaw
      : eventType === 'created' || eventType === 'completed' || eventType === 'auto_close' || eventType === 'archive_edit'
        ? eventType
        : null;
  if (!action || typeof source.ticket_id !== 'string' || typeof source.at !== 'string') {
    return null;
  }
  return {
    id: typeof source.id === 'string' ? source.id : crypto.randomUUID(),
    ticket_id: source.ticket_id,
    action,
    event_type:
      eventType === 'created' || eventType === 'completed' || eventType === 'auto_close' || eventType === 'archive_edit'
        ? eventType
        : undefined,
    source_year: typeof source.source_year === 'number' ? source.source_year : undefined,
    changed_fields: Array.isArray(source.changed_fields)
      ? source.changed_fields.filter((item): item is string => typeof item === 'string')
      : undefined,
    old_values:
      source.old_values && typeof source.old_values === 'object'
        ? (source.old_values as Record<string, unknown>)
        : null,
    new_values:
      source.new_values && typeof source.new_values === 'object'
        ? (source.new_values as Record<string, unknown>)
        : null,
    reo_divergence_warning: source.reo_divergence_warning === true,
    at: source.at,
    operator_name: typeof source.operator_name === 'string' ? source.operator_name : '',
    operator_id:
      source.operator_id === null || source.operator_id === undefined || source.operator_id === ''
        ? null
        : String(source.operator_id),
  };
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

    const activeYear = resolveActiveYear();
    const stored = getAllTickets().filter((ticket) => ticketMatchesActiveYear(ticket, activeYear));
    let maxNumber = Math.max(0, ...stored.map((ticket) => ticket.ticket_number || 0));
    const createdAt = new Date().toISOString();
    const parsedCreatedYear = Number.parseInt(createdAt.slice(0, 4), 10);
    const currentYear =
      activeYear
      ?? (Number.isFinite(parsedCreatedYear) ? parsedCreatedYear : new Date().getFullYear());
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
        year: currentYear,
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
    const activeYear = resolveActiveYear();
    return getAllTickets()
      .map(normalizeTicket)
      .filter((ticket) => ticketMatchesActiveYear(ticket, activeYear))
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
    const activeYear = resolveActiveYear();
    const ticket = getAllTickets().find(
      (item) => item.id === id && ticketMatchesActiveYear(item, activeYear),
    );
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
    // Do not force photo_* to null when the patch omits them.
    if (!Object.prototype.hasOwnProperty.call(updates, 'photo_entry_path')) {
      delete safeUpdates.photo_entry_path;
    }
    if (!Object.prototype.hasOwnProperty.call(updates, 'photo_exit_path')) {
      delete safeUpdates.photo_exit_path;
    }
    const wasCompleted = current.status === 'completed';
    const merged = normalizeTicket({
      ...current,
      ...safeUpdates,
      version: (current.version ?? 1) + 1,
    });
    if (!Object.prototype.hasOwnProperty.call(updates, 'photo_entry_path')) {
      merged.photo_entry_path = current.photo_entry_path ?? null;
    }
    if (!Object.prototype.hasOwnProperty.call(updates, 'photo_exit_path')) {
      merged.photo_exit_path = current.photo_exit_path ?? null;
    }

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
      event_type: event.event_type ?? event.action,
    });
    persist(STORAGE_KEYS.TICKET_AUDIT, JSON.stringify(events));
  },

  getAll(): TicketAuditEvent[] {
    TicketAuditStorage.ensureInitialized();
    const stored = localStorage.getItem(STORAGE_KEYS.TICKET_AUDIT);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(normalizeAuditEvent)
        .filter((event): event is TicketAuditEvent => event !== null);
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
  preferred_driver_name?: string;
  preferred_cargo_name?: string;
  preferred_shipper_name?: string;
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
  driver_input_mode: DriverInputMode;
  scale_device_id: ScaleDeviceId;
  manual_weight_reason_policy: 'optional' | 'required';
  active_year?: number | null;
  /** Video capture master switch (SoT: config.ini via SettingsStorage). */
  video_enabled: boolean;
  /** Hard timeout for camera capture, seconds (SoT: config.ini). */
  camera_capture_timeout_sec: number;
  /** JPEG quality 1–100 (SoT: config.ini). */
  camera_jpeg_quality: number;
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
  driver_input_mode: 'vehicle',
  scale_device_id: 'microsim-m0601',
  manual_weight_reason_policy: 'optional',
  active_year: null,
  video_enabled: false,
  camera_capture_timeout_sec: 3,
  camera_jpeg_quality: 80,
};

export const DRIVER_INPUT_MODE_LABELS: Record<DriverInputMode, string> = {
  vehicle: 'По машине',
  all: 'Весь справочник',
  free: 'Свободный ввод',
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
      driver_input_mode: normalizeDriverInputMode(stored.driver_input_mode),
      scale_device_id: normalizeScaleDeviceId(stored.scale_device_id),
      manual_weight_reason_policy:
        stored.manual_weight_reason_policy === 'required' ? 'required' : 'optional',
      active_year:
        stored.active_year === undefined || stored.active_year === ''
          ? null
          : Number.isFinite(Number(stored.active_year))
            ? Number(stored.active_year)
            : null,
      video_enabled: stored.video_enabled === 'true',
      camera_capture_timeout_sec: parseNumber(
        stored.camera_capture_timeout_sec,
        DEFAULT_APP_SETTINGS.camera_capture_timeout_sec,
      ),
      camera_jpeg_quality: parseNumber(
        stored.camera_jpeg_quality,
        DEFAULT_APP_SETTINGS.camera_jpeg_quality,
      ),
    };
  },

  updateAppSettings: (updates: Partial<AppSettings>): AppSettings => {
    const current = SettingsStorage.getAppSettings();
    const next = {
      ...current,
      ...updates,
      driver_input_mode: normalizeDriverInputMode(
        updates.driver_input_mode ?? current.driver_input_mode,
      ),
      scale_device_id: normalizeScaleDeviceId(
        updates.scale_device_id ?? current.scale_device_id,
      ),
      manual_weight_reason_policy:
        updates.manual_weight_reason_policy === 'required' ? 'required' : 'optional',
      video_enabled:
        updates.video_enabled !== undefined ? Boolean(updates.video_enabled) : current.video_enabled,
      camera_capture_timeout_sec:
        updates.camera_capture_timeout_sec !== undefined &&
        Number.isFinite(Number(updates.camera_capture_timeout_sec))
          ? Number(updates.camera_capture_timeout_sec)
          : current.camera_capture_timeout_sec,
      camera_jpeg_quality:
        updates.camera_jpeg_quality !== undefined &&
        Number.isFinite(Number(updates.camera_jpeg_quality))
          ? Number(updates.camera_jpeg_quality)
          : current.camera_jpeg_quality,
    };
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
      driver_input_mode: next.driver_input_mode,
      scale_device_id: next.scale_device_id,
      manual_weight_reason_policy: next.manual_weight_reason_policy,
      video_enabled: String(next.video_enabled),
      camera_capture_timeout_sec: String(next.camera_capture_timeout_sec),
      camera_jpeg_quality: String(next.camera_jpeg_quality),
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

function sortVehicleDriverRecords(records: VehicleDriverRecord[]): VehicleDriverRecord[] {
  return [...records].sort((a, b) => {
    const ta = Date.parse(a.last_used_at) || 0;
    const tb = Date.parse(b.last_used_at) || 0;
    if (tb !== ta) return tb - ta;
    return (b.use_count ?? 0) - (a.use_count ?? 0);
  });
}

function getAllVehicleDrivers(): VehicleDriverRecord[] {
  const stored = localStorage.getItem(STORAGE_KEYS.VEHICLE_DRIVERS);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is VehicleDriverRecord =>
        !!row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        typeof row.vehicle_key === 'string' &&
        typeof row.driver_name === 'string',
    );
  } catch {
    return [];
  }
}

/** History of drivers per vehicle plate key (sync: app_vehicle_drivers). */
export const VehicleDriversStorage = {
  getAll(): VehicleDriverRecord[] {
    return sortVehicleDriverRecords(getAllVehicleDrivers());
  },

  getByVehicleKey(key: string): VehicleDriverRecord[] {
    if (!key) return [];
    return sortVehicleDriverRecords(
      getAllVehicleDrivers().filter((row) => row.vehicle_key === key),
    );
  },

  /**
   * Upsert usage for (vehicle_key, driver_name). Empty key/name → no-op.
   * Best-effort: logs errors and does not throw.
   */
  recordUsage(vehicleKey: string, driverName: string, at: string): VehicleDriverRecord | null {
    try {
      const key = (vehicleKey ?? '').trim();
      const name = formatPersonName(driverName ?? '');
      if (!key || !name) return null;

      const rows = getAllVehicleDrivers();
      const index = rows.findIndex(
        (row) => row.vehicle_key === key && row.driver_name.toLowerCase() === name.toLowerCase(),
      );

      let record: VehicleDriverRecord;
      if (index === -1) {
        record = {
          id: crypto.randomUUID(),
          vehicle_key: key,
          driver_name: name,
          last_used_at: at,
          use_count: 1,
        };
        rows.push(record);
      } else {
        record = {
          ...rows[index],
          driver_name: name,
          last_used_at: at,
          use_count: (rows[index].use_count ?? 0) + 1,
        };
        rows[index] = record;
      }

      persist(STORAGE_KEYS.VEHICLE_DRIVERS, JSON.stringify(rows));
      return record;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('vehicle_drivers', `Ошибка записи истории водителей: ${message}`);
      return null;
    }
  },
};

/**
 * Update preferred_* on an existing vehicle card. Does not create a card.
 * Does not touch vehicle_brand / default_tare_weight.
 */
export function updateVehiclePreferencesFromTrip(
  vehicleKey: string,
  prefs: {
    preferred_driver_name?: string;
    preferred_cargo_name?: string;
    preferred_shipper_name?: string;
  },
): DictionaryEntry | null {
  const key = (vehicleKey ?? '').trim();
  if (!key) return null;

  const vehicles = DictionaryStorage.getTable('vehicles');
  const vehicle = vehicles.find((entry) => {
    const raw = entry.vehicle_number ?? entry.name ?? '';
    return normalizeVehicleKey(raw) === key;
  });
  if (!vehicle) return null;

  const updates: Partial<DictionaryEntry> = {};
  const driver = (prefs.preferred_driver_name ?? '').trim();
  const cargo = (prefs.preferred_cargo_name ?? '').trim();
  const shipper = (prefs.preferred_shipper_name ?? '').trim();
  if (driver) updates.preferred_driver_name = formatPersonName(driver);
  if (cargo) updates.preferred_cargo_name = cargo;
  if (shipper) updates.preferred_shipper_name = shipper;
  if (Object.keys(updates).length === 0) return vehicle;

  return DictionaryStorage.update('vehicles', vehicle.id, updates);
}

function normalizeScaleSetValue(raw: unknown): ScaleSet | null {
  if (raw === 'primary' || raw === 'spare') return raw;
  return null;
}
const BUILTIN_ADAPTER_IDS = new Set<ScaleDeviceId>([
  'microsim-m0601',
  'newton',
  'cas',
  'midl-mi-vda',
]);

function normalizeAnprModeValue(raw: unknown): AnprMode | null {
  if (raw === 'enabled' || raw === 'disabled_by_configuration' || raw === 'failed') {
    return raw;
  }
  return null;
}

function normalizeSwitchReasonValue(raw: unknown): SwitchReason | null {
  if (raw === 'repair' || raw === 'cleaning' || raw === 'verification' || raw === 'other') {
    return raw;
  }
  return null;
}

function normalizeScaleConnectionValue(raw: unknown): ScaleConnectionJson {
  if (!raw || typeof raw !== 'object') {
    return { transport: 'web_serial', device_id: null };
  }
  const source = raw as {
    transport?: unknown;
    device_id?: unknown;
    serial?: unknown;
    tcp?: unknown;
    parser?: unknown;
  };
  const transport: ScaleTransport =
    source.transport === 'serial_backend' || source.transport === 'tcp_client'
      ? source.transport
      : 'web_serial';
  const deviceRaw = source.device_id;
  const deviceId =
    deviceRaw === null || deviceRaw === undefined || deviceRaw === ''
      ? null
      : normalizeScaleDeviceId(String(deviceRaw));
  const connection: ScaleConnectionJson = {
    transport,
    device_id: deviceId,
  };
  if (source.serial && typeof source.serial === 'object') {
    connection.serial = source.serial as SerialDraft;
  }
  if (source.tcp && typeof source.tcp === 'object') {
    connection.tcp = source.tcp as TcpDraft;
  }
  if (source.parser && typeof source.parser === 'object') {
    connection.parser = source.parser as ParserDraft;
  }
  return connection;
}

function normalizeStoredAdapterId(
  raw: unknown,
  connection: ScaleConnectionJson,
): string {
  if (typeof raw === 'string' && BUILTIN_ADAPTER_IDS.has(raw as ScaleDeviceId)) {
    return raw;
  }
  if (raw === 'generic-regex') {
    return 'generic-regex';
  }
  if (raw === 'web_serial' && connection.device_id) {
    return connection.device_id;
  }
  if (typeof raw === 'string' && raw) {
    return raw;
  }
  return 'web_serial';
}

function normalizeSite(row: unknown): Site | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
  };
}

function normalizeScale(row: unknown): Scale | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const role = normalizeScaleSetValue(r.role);
  if (typeof r.id !== 'string' || !r.id || typeof r.site_id !== 'string' || !role) return null;
  const connection = normalizeScaleConnectionValue(r.connection);
  const adapterId = normalizeStoredAdapterId(r.adapter_id, connection);
  if (BUILTIN_ADAPTER_IDS.has(adapterId as ScaleDeviceId)) {
    connection.device_id = adapterId as ScaleDeviceId;
  }
  return {
    id: r.id,
    site_id: r.site_id,
    role,
    adapter_id: adapterId,
    connection,
    name: typeof r.name === 'string' ? r.name : '',
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
  };
}

function normalizeSiteRuntime(row: unknown): SiteRuntime | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const active = normalizeScaleSetValue(r.active_scale_set);
  const camera = normalizeScaleSetValue(r.camera_mode);
  const anpr = normalizeAnprModeValue(r.anpr_mode);
  if (typeof r.site_id !== 'string' || !r.site_id || !active || !camera || !anpr) return null;
  return {
    site_id: r.site_id,
    active_scale_set: active,
    camera_mode: camera,
    anpr_mode: anpr,
    last_switch_reason: normalizeSwitchReasonValue(r.last_switch_reason),
    last_switch_comment:
      r.last_switch_comment === undefined || r.last_switch_comment === null || r.last_switch_comment === ''
        ? null
        : String(r.last_switch_comment),
    last_switch_operator_name:
      r.last_switch_operator_name === undefined || r.last_switch_operator_name === null
        ? null
        : String(r.last_switch_operator_name),
    last_switch_operator_id:
      r.last_switch_operator_id === undefined || r.last_switch_operator_id === null || r.last_switch_operator_id === ''
        ? null
        : String(r.last_switch_operator_id),
    last_switch_at:
      r.last_switch_at === undefined || r.last_switch_at === null || r.last_switch_at === ''
        ? null
        : String(r.last_switch_at),
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : new Date().toISOString(),
  };
}

function normalizeJournalEntry(row: unknown): ScaleSwitchJournalEntry | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const fromSet = normalizeScaleSetValue(r.from_set);
  const toSet = normalizeScaleSetValue(r.to_set);
  const reason = normalizeSwitchReasonValue(r.reason);
  if (typeof r.id !== 'string' || !r.id || typeof r.site_id !== 'string' || !fromSet || !toSet || !reason) {
    return null;
  }
  return {
    id: r.id,
    site_id: r.site_id,
    from_set: fromSet,
    to_set: toSet,
    reason,
    comment:
      r.comment === undefined || r.comment === null || r.comment === ''
        ? null
        : String(r.comment),
    operator_name: typeof r.operator_name === 'string' ? r.operator_name : '',
    operator_id:
      r.operator_id === undefined || r.operator_id === null || r.operator_id === ''
        ? null
        : String(r.operator_id),
    switched_at: typeof r.switched_at === 'string' ? r.switched_at : new Date().toISOString(),
  };
}

/** Sites (sync: app_sites). */
export const SiteStorage = {
  getAll(): Site[] {
    const stored = localStorage.getItem(STORAGE_KEYS.SITES);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeSite).filter((row): row is Site => row !== null);
    } catch {
      return [];
    }
  },

  getById(id: string): Site | null {
    return SiteStorage.getAll().find((row) => row.id === id) ?? null;
  },

  upsert(site: Site): Site {
    const rows = SiteStorage.getAll();
    const index = rows.findIndex((row) => row.id === site.id);
    if (index === -1) rows.push(site);
    else rows[index] = site;
    persist(STORAGE_KEYS.SITES, JSON.stringify(rows));
    return site;
  },
};

/** Scale sets on a site (sync: app_scales). One primary and one spare per site. */
export const ScaleStorage = {
  getAll(): Scale[] {
    const stored = localStorage.getItem(STORAGE_KEYS.SCALES);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeScale).filter((row): row is Scale => row !== null);
    } catch {
      return [];
    }
  },

  getBySite(siteId: string): Scale[] {
    return ScaleStorage.getAll().filter((row) => row.site_id === siteId);
  },

  getByRole(siteId: string, role: ScaleSet): Scale | null {
    return ScaleStorage.getBySite(siteId).find((row) => row.role === role) ?? null;
  },

  upsert(scale: Scale): Scale {
    const rows = ScaleStorage.getAll();
    const byId = rows.findIndex((row) => row.id === scale.id);
    if (byId !== -1) {
      rows[byId] = scale;
    } else {
      const byRole = rows.findIndex(
        (row) => row.site_id === scale.site_id && row.role === scale.role,
      );
      if (byRole !== -1) rows[byRole] = scale;
      else rows.push(scale);
    }
    persist(STORAGE_KEYS.SCALES, JSON.stringify(rows));
    return scale;
  },
};

/** Active scale runtime (sync: app_site_runtime). */
export const SiteRuntimeStorage = {
  getAll(): SiteRuntime[] {
    const stored = localStorage.getItem(STORAGE_KEYS.SITE_RUNTIME);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeSiteRuntime).filter((row): row is SiteRuntime => row !== null);
    } catch {
      return [];
    }
  },

  get(siteId?: string): SiteRuntime | null {
    const rows = SiteRuntimeStorage.getAll();
    if (siteId) return rows.find((row) => row.site_id === siteId) ?? null;
    return rows[0] ?? null;
  },

  upsert(runtime: SiteRuntime): SiteRuntime {
    const rows = SiteRuntimeStorage.getAll();
    const index = rows.findIndex((row) => row.site_id === runtime.site_id);
    if (index === -1) rows.push(runtime);
    else rows[index] = runtime;
    persist(STORAGE_KEYS.SITE_RUNTIME, JSON.stringify(rows));
    return runtime;
  },

  /** Test/helper: clear all runtime rows (does not remove sites/scales). */
  clear(): void {
    persist(STORAGE_KEYS.SITE_RUNTIME, JSON.stringify([]));
  },
};

/** Append-only scale switch journal (sync: app_scale_switch_journal). */
export const ScaleSwitchJournalStorage = {
  getAll(siteId?: string): ScaleSwitchJournalEntry[] {
    const stored = localStorage.getItem(STORAGE_KEYS.SCALE_SWITCH_JOURNAL);
    let rows: ScaleSwitchJournalEntry[] = [];
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          rows = parsed
            .map(normalizeJournalEntry)
            .filter((row): row is ScaleSwitchJournalEntry => row !== null);
        }
      } catch {
        rows = [];
      }
    }
    if (siteId) rows = rows.filter((row) => row.site_id === siteId);
    return rows.sort(
      (a, b) => new Date(b.switched_at).getTime() - new Date(a.switched_at).getTime(),
    );
  },

  append(entry: ScaleSwitchJournalEntry): ScaleSwitchJournalEntry {
    const stored = localStorage.getItem(STORAGE_KEYS.SCALE_SWITCH_JOURNAL);
    let rows: ScaleSwitchJournalEntry[] = [];
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          rows = parsed
            .map(normalizeJournalEntry)
            .filter((row): row is ScaleSwitchJournalEntry => row !== null);
        }
      } catch {
        rows = [];
      }
    }
    rows.push(entry);
    persist(STORAGE_KEYS.SCALE_SWITCH_JOURNAL, JSON.stringify(rows));
    return entry;
  },
};

function normalizeCameraRole(raw: unknown): CameraRole | null {
  if (raw === 'entry' || raw === 'exit' || raw === 'overview') return raw;
  return null;
}

function normalizeCaptureEvent(raw: unknown): CaptureEvent | null {
  if (raw === 'gross' || raw === 'tare') return raw;
  return null;
}

function normalizeCamera(row: unknown): Camera | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const role = normalizeCameraRole(r.role);
  if (typeof r.id !== 'string' || !r.id || typeof r.site_id !== 'string' || !role) {
    return null;
  }
  const asNumOrNull = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: r.id,
    site_id: r.site_id,
    name: typeof r.name === 'string' ? r.name : '',
    role,
    http_snapshot_url: normalizeNullableString(r.http_snapshot_url),
    rtsp_url: normalizeNullableString(r.rtsp_url),
    enabled: r.enabled === true || r.enabled === 1 || r.enabled === '1' || r.enabled === 'true',
    roi_x: asNumOrNull(r.roi_x),
    roi_y: asNumOrNull(r.roi_y),
    roi_w: asNumOrNull(r.roi_w),
    roi_h: asNumOrNull(r.roi_h),
    etalon_primary_path: normalizeNullableString(r.etalon_primary_path),
    etalon_spare_path: normalizeNullableString(r.etalon_spare_path),
    sort_order: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 0,
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : new Date().toISOString(),
  };
}

function normalizeTicketPhoto(row: unknown): TicketPhoto | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const cameraRole = normalizeCameraRole(r.camera_role);
  const event = normalizeCaptureEvent(r.event);
  if (
    typeof r.id !== 'string' ||
    !r.id ||
    typeof r.ticket_id !== 'string' ||
    typeof r.camera_id !== 'string' ||
    !cameraRole ||
    !event
  ) {
    return null;
  }
  const status = r.status === 'failed' ? 'failed' : r.status === 'success' ? 'success' : null;
  if (!status) return null;
  const cameraMode =
    r.camera_mode === 'primary' || r.camera_mode === 'spare' ? r.camera_mode : null;
  return {
    id: r.id,
    ticket_id: r.ticket_id,
    camera_id: r.camera_id,
    camera_role: cameraRole,
    event,
    file_path: normalizeNullableString(r.file_path),
    status,
    error_code: normalizeNullableString(r.error_code),
    captured_at: typeof r.captured_at === 'string' ? r.captured_at : new Date().toISOString(),
    camera_mode: cameraMode,
  };
}

function ticketPhotoMatchKey(row: TicketPhoto): string {
  return `${row.ticket_id}|${row.camera_id}|${row.event}`;
}

/**
 * Merge capture response photos into the full local list.
 * Upserts by id or UNIQUE (ticket_id, camera_id, event).
 * Must not replace the whole collection with a single-ticket capture payload.
 */
export function upsertTicketPhotosFromCapture(
  fullList: TicketPhoto[],
  captureTicketPhotos: TicketPhoto[],
): TicketPhoto[] {
  const result = fullList.map((row) => ({ ...row }));
  for (const incoming of captureTicketPhotos) {
    const byId = result.findIndex((row) => row.id === incoming.id);
    if (byId !== -1) {
      result[byId] = incoming;
      continue;
    }
    const key = ticketPhotoMatchKey(incoming);
    const byKey = result.findIndex((row) => ticketPhotoMatchKey(row) === key);
    if (byKey !== -1) {
      result[byKey] = incoming;
    } else {
      result.push(incoming);
    }
  }
  return result;
}

/** Cameras registry (sync: app_cameras). */
export const CameraStorage = {
  getAll(): Camera[] {
    const stored = localStorage.getItem(STORAGE_KEYS.CAMERAS);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(normalizeCamera)
        .filter((row): row is Camera => row !== null)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru'));
    } catch {
      return [];
    }
  },

  getBySite(siteId: string): Camera[] {
    return CameraStorage.getAll().filter((row) => row.site_id === siteId);
  },

  replaceAll(rows: Camera[]): Camera[] {
    const normalized = rows
      .map(normalizeCamera)
      .filter((row): row is Camera => row !== null);
    persist(STORAGE_KEYS.CAMERAS, JSON.stringify(normalized));
    return normalized;
  },

  upsert(row: Camera): Camera {
    const normalized = normalizeCamera(row);
    if (!normalized) {
      throw new Error('Invalid camera row');
    }
    const rows = CameraStorage.getAll();
    const index = rows.findIndex((item) => item.id === normalized.id);
    if (index === -1) rows.push(normalized);
    else rows[index] = normalized;
    persist(STORAGE_KEYS.CAMERAS, JSON.stringify(rows));
    return normalized;
  },

  remove(id: string): void {
    const rows = CameraStorage.getAll().filter((row) => row.id !== id);
    persist(STORAGE_KEYS.CAMERAS, JSON.stringify(rows));
  },
};

/** Ticket photos metadata (sync: app_ticket_photos). No replaceAll of full collection from capture. */
export const TicketPhotoStorage = {
  getAll(): TicketPhoto[] {
    const stored = localStorage.getItem(STORAGE_KEYS.TICKET_PHOTOS);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeTicketPhoto).filter((row): row is TicketPhoto => row !== null);
    } catch {
      return [];
    }
  },

  getByTicket(ticketId: string): TicketPhoto[] {
    return TicketPhotoStorage.getAll().filter((row) => row.ticket_id === ticketId);
  },

  upsertMany(rows: TicketPhoto[]): TicketPhoto[] {
    const merged = upsertTicketPhotosFromCapture(TicketPhotoStorage.getAll(), rows);
    persist(STORAGE_KEYS.TICKET_PHOTOS, JSON.stringify(merged));
    return merged;
  },
};

/**
 * Learning after ticket reaches completed: upsert vehicle_drivers + preferred_*.
 * Caller must not invoke for open dual first pass.
 */
export function onTicketCompletedLearning(ticket: {
  vehicle_number?: string | null;
  driver_name?: string | null;
  cargo_name?: string | null;
  shipper_name?: string | null;
  completed_at?: string | null;
}): void {
  const key = normalizeVehicleKey(ticket.vehicle_number ?? '');
  const driver = formatPersonName(ticket.driver_name ?? '');
  if (!key || !driver) return;

  const at = ticket.completed_at || new Date().toISOString();
  VehicleDriversStorage.recordUsage(key, driver, at);
  updateVehiclePreferencesFromTrip(key, {
    preferred_driver_name: driver,
    preferred_cargo_name: ticket.cargo_name ?? '',
    preferred_shipper_name: ticket.shipper_name ?? '',
  });
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
