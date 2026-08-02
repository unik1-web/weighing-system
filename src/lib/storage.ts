// Local storage abstraction for weighing system
import { scheduleConfigSync, scheduleDatabaseSync, flushDatabaseSync, DICTIONARIES_UPDATED_EVENT } from './storage-sync';
import { formatVehiclePlate } from './vehicle-plate';
import { formatPersonName, formatVehicleBrand } from './text-format';
import { ticketImportKey } from './import-keys';
import { normalizeWeighingMode, type WeighingMode } from './weighing-mode';
import { normalizeWeightSource, type WeightSource } from './weight-source';
import {
  normalizeDriverInputMode,
  normalizePlateSource,
  type DriverInputMode,
  type PlateSource,
  type VehicleDriverLink,
} from './vehicle-resolve';
import { applyVehicleLearningOnComplete } from './vehicle-learning';
import {
  SCALE_DEVICES,
  normalizeAdapterId,
  type ScaleDeviceId,
  type ScaleConnectionProfile as ScalesConnectionProfile,
  type ScaleTransportKind,
} from './scales';
import {
  normalizeManualWeightReasonMode,
  type ManualWeightReasonMode,
} from './manual-weight-reason';
import { logger } from './logger';

export type { ManualWeightReasonMode };
export type { ScaleTransportKind };

export type { WeightSource };
export type { DriverInputMode, PlateSource, VehicleDriverLink };
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
  plate_source?: PlateSource | null;
  site_id?: string | null;
  scale_id?: string | null;
  scale_role?: 'primary' | 'spare' | null;
  photo_entry_path?: string | null;
  photo_exit_path?: string | null;
  photo_overview_path?: string | null;
  /** Reason for keyboard weight entry; null when off / not applicable. Soft-read for old tickets. */
  manual_weight_reason?: string | null;
  /** Closed during year rotation. Soft-read: missing → false. */
  auto_closed?: boolean | null;
}

export type TicketAuditAction = 'created' | 'completed' | 'auto_closed' | 'updated';

export interface TicketAuditEvent {
  id: string;
  ticket_id: string;
  action: TicketAuditAction;
  at: string;
  operator_name: string;
  operator_id: string | null;
}

export interface TicketRevision {
  id: string;
  ticket_id: string;
  at: string;
  operator_id: string | null;
  operator_name: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
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
  TICKET_REVISIONS: 'app_ticket_revisions',
  VEHICLE_DRIVERS: 'app_vehicle_drivers',
  SITES: 'app_sites',
  SCALES: 'app_scales',
  SITE_RUNTIME: 'app_site_runtime',
  SITE_SCALE_SWITCHES: 'app_site_scale_switches',
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

/** Exported for site-runtime and sync keys. */
export const APP_STORAGE_KEYS = {
  SITES: STORAGE_KEYS.SITES,
  SCALES: STORAGE_KEYS.SCALES,
  SITE_RUNTIME: STORAGE_KEYS.SITE_RUNTIME,
  SITE_SCALE_SWITCHES: STORAGE_KEYS.SITE_SCALE_SWITCHES,
  CAMERAS: STORAGE_KEYS.CAMERAS,
  TICKET_PHOTOS: STORAGE_KEYS.TICKET_PHOTOS,
} as const;

function normalizeScaleDeviceId(raw: unknown): ScaleDeviceId {
  return normalizeAdapterId(raw);
}

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

function softReadNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Soft-read boolean: missing/null/'' → false; 1/'true' → true. */
export function softReadBool(value: unknown): boolean {
  if (value == null || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return Boolean(value);
}

function normalizeTicket(ticket: WeighingTicket): WeighingTicket {
  const next: WeighingTicket = {
    ...ticket,
    reo_status: ticket.reo_status ?? 'pending',
    reo_sent_at: ticket.reo_sent_at ?? null,
    gross_source: normalizeWeightSource(ticket.gross_source),
    tare_source: normalizeWeightSource(ticket.tare_source),
    plate_source: normalizePlateSource(ticket.plate_source),
    site_id: softReadNullableString(ticket.site_id),
    scale_id: softReadNullableString(ticket.scale_id),
    scale_role:
      ticket.scale_role === 'primary' || ticket.scale_role === 'spare' ? ticket.scale_role : null,
    photo_entry_path: ticket.photo_entry_path ?? null,
    photo_exit_path: ticket.photo_exit_path ?? null,
    photo_overview_path: ticket.photo_overview_path ?? null,
    manual_weight_reason: softReadNullableString(
      (ticket as WeighingTicket & { manual_weight_reason?: unknown }).manual_weight_reason,
    ),
    auto_closed: softReadBool(
      (ticket as WeighingTicket & { auto_closed?: unknown }).auto_closed,
    ),
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

/** Persist normalized mode/version so sync does not re-default open tickets to single. */
function persistNormalizedTicketsIfNeeded(tickets: WeighingTicket[]): WeighingTicket[] {
  let dirty = false;
  const normalized = tickets.map((ticket) => {
    const next = normalizeTicket(ticket);
    if (ticket.weighing_mode !== next.weighing_mode || ticket.version !== next.version) {
      dirty = true;
    }
    return next;
  });
  if (dirty) {
    persist(STORAGE_KEYS.TICKETS, JSON.stringify(normalized));
  }
  return normalized;
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
        applyVehicleLearningOnComplete(ticket);
      }
    }

    return created;
  },

  getAll: (): WeighingTicket[] => {
    return persistNormalizedTicketsIfNeeded(getAllTickets()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
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
    const tickets = persistNormalizedTicketsIfNeeded(getAllTickets());
    const ticket = tickets.find((t) => t.id === id);
    return ticket ?? null;
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
      applyVehicleLearningOnComplete(merged);
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

/** History machine ↔ driver (sync key app_vehicle_drivers). */
export const VehicleDriversStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.VEHICLE_DRIVERS) === null) {
      localStorage.setItem(STORAGE_KEYS.VEHICLE_DRIVERS, '[]');
    }
  },

  getAll(): VehicleDriverLink[] {
    VehicleDriversStorage.ensureInitialized();
    const stored = localStorage.getItem(STORAGE_KEYS.VEHICLE_DRIVERS);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is VehicleDriverLink =>
          item != null &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.vehicle_number === 'string' &&
          typeof item.driver_name === 'string',
      );
    } catch {
      return [];
    }
  },

  getByVehicle(vehicleNumber: string): VehicleDriverLink[] {
    const plate = formatVehiclePlate(vehicleNumber);
    return VehicleDriversStorage.getAll().filter(
      (link) => formatVehiclePlate(link.vehicle_number) === plate,
    );
  },

  upsert(args: {
    vehicle_number: string;
    driver_name: string;
    last_used_at?: string;
    driver_id?: string | null;
  }): VehicleDriverLink {
    VehicleDriversStorage.ensureInitialized();
    const plate = formatVehiclePlate(args.vehicle_number);
    const driverName = formatPersonName(args.driver_name);
    const at = args.last_used_at ?? new Date().toISOString();
    const links = VehicleDriversStorage.getAll();
    const index = links.findIndex(
      (link) =>
        formatVehiclePlate(link.vehicle_number) === plate &&
        formatPersonName(link.driver_name) === driverName,
    );

    if (index === -1) {
      const created: VehicleDriverLink = {
        id: crypto.randomUUID(),
        vehicle_number: plate,
        driver_name: driverName,
        last_used_at: at,
        use_count: 1,
        driver_id: args.driver_id ?? null,
      };
      links.push(created);
      persist(STORAGE_KEYS.VEHICLE_DRIVERS, JSON.stringify(links));
      return created;
    }

    const current = links[index];
    const updated: VehicleDriverLink = {
      ...current,
      vehicle_number: plate,
      driver_name: driverName,
      last_used_at: at,
      use_count: (current.use_count || 0) + 1,
      driver_id:
        args.driver_id !== undefined ? args.driver_id : (current.driver_id ?? null),
    };
    links[index] = updated;
    persist(STORAGE_KEYS.VEHICLE_DRIVERS, JSON.stringify(links));
    return updated;
  },
};

// ── Sites / scales / runtime (этап 4) ──────────────────────────────────────

export type ScaleRole = 'primary' | 'spare';
export type ActiveScaleSet = 'primary' | 'spare';
export type CameraMode = 'normal' | 'rotated_for_spare';
export type AnprMode = 'enabled' | 'disabled_by_configuration' | 'failed';
export type SwitchReason = 'repair' | 'cleaning' | 'verification' | 'other';
export type CameraAck = 'rotated' | 'no_cameras';

export interface Site {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

export type ScaleConnectionProfile = ScalesConnectionProfile;

export interface Scale {
  id: string;
  site_id: string;
  role: ScaleRole;
  name: string;
  adapter_id: ScaleDeviceId;
  connection: ScaleConnectionProfile;
  enabled: boolean;
  created_at: string;
}

export interface SiteRuntime {
  site_id: string;
  active_scale_set: ActiveScaleSet;
  camera_mode: CameraMode;
  anpr_mode: AnprMode;
  switch_reason: SwitchReason | null;
  switch_by_operator_id: string | null;
  switch_by_operator_name: string | null;
  switch_at: string | null;
}

export interface SiteScaleSwitchEvent {
  id: string;
  site_id: string;
  from_set: ActiveScaleSet;
  to_set: ActiveScaleSet;
  reason: SwitchReason;
  operator_id: string | null;
  operator_name: string;
  at: string;
  camera_ack: CameraAck | null;
}

function persistJsonArray(key: string, items: unknown[]): void {
  persist(key, JSON.stringify(items));
}

function readJsonArray<T>(key: string, guard: (item: unknown) => item is T): T[] {
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(guard);
  } catch {
    return [];
  }
}

function isSite(item: unknown): item is Site {
  return (
    item != null &&
    typeof item === 'object' &&
    typeof (item as Site).id === 'string' &&
    typeof (item as Site).name === 'string' &&
    typeof (item as Site).is_default === 'boolean' &&
    typeof (item as Site).created_at === 'string'
  );
}

function isScale(item: unknown): item is Scale {
  if (item == null || typeof item !== 'object') return false;
  const s = item as Scale;
  return (
    typeof s.id === 'string' &&
    typeof s.site_id === 'string' &&
    (s.role === 'primary' || s.role === 'spare') &&
    typeof s.name === 'string' &&
    typeof s.adapter_id === 'string' &&
    s.connection != null &&
    typeof s.connection === 'object' &&
    typeof s.enabled === 'boolean' &&
    typeof s.created_at === 'string'
  );
}

function isSiteRuntime(item: unknown): item is SiteRuntime {
  if (item == null || typeof item !== 'object') return false;
  const r = item as SiteRuntime;
  return (
    typeof r.site_id === 'string' &&
    (r.active_scale_set === 'primary' || r.active_scale_set === 'spare') &&
    typeof r.camera_mode === 'string' &&
    typeof r.anpr_mode === 'string'
  );
}

function isSiteScaleSwitchEvent(item: unknown): item is SiteScaleSwitchEvent {
  if (item == null || typeof item !== 'object') return false;
  const e = item as SiteScaleSwitchEvent;
  return (
    typeof e.id === 'string' &&
    typeof e.site_id === 'string' &&
    (e.from_set === 'primary' || e.from_set === 'spare') &&
    (e.to_set === 'primary' || e.to_set === 'spare') &&
    typeof e.reason === 'string' &&
    typeof e.operator_name === 'string' &&
    typeof e.at === 'string'
  );
}

// ── Cameras / ticket photos (этап 7) ───────────────────────────────────────

export type CameraRole = 'entry' | 'exit' | 'overview';
export type CaptureKind = 'http_snapshot' | 'rtsp' | 'auto';
export type PhotoPhase = 'gross' | 'tare';
export type PhotoStatus = 'ok' | 'failed' | 'skipped';

export interface CameraRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Camera {
  id: string;
  site_id: string;
  role: CameraRole;
  name: string;
  capture_url: string;
  capture_kind: CaptureKind;
  enabled: boolean;
  sort_order: number;
  roi: CameraRoi | null;
  reference_normal_path: string | null;
  reference_spare_path: string | null;
  created_at: string;
}

export interface TicketPhoto {
  id: string;
  ticket_id: string;
  phase: PhotoPhase;
  camera_id: string | null;
  camera_role: CameraRole;
  relative_path: string | null;
  status: PhotoStatus;
  error_message: string | null;
  camera_mode: CameraMode;
  created_at: string;
}

function isCameraRole(value: unknown): value is CameraRole {
  return value === 'entry' || value === 'exit' || value === 'overview';
}

function isCamera(item: unknown): item is Camera {
  if (item == null || typeof item !== 'object') return false;
  const c = item as Camera;
  return (
    typeof c.id === 'string' &&
    typeof c.site_id === 'string' &&
    isCameraRole(c.role) &&
    typeof c.name === 'string' &&
    typeof c.capture_url === 'string' &&
    typeof c.enabled === 'boolean' &&
    typeof c.created_at === 'string'
  );
}

function isTicketPhoto(item: unknown): item is TicketPhoto {
  if (item == null || typeof item !== 'object') return false;
  const p = item as TicketPhoto;
  return (
    typeof p.id === 'string' &&
    typeof p.ticket_id === 'string' &&
    (p.phase === 'gross' || p.phase === 'tare') &&
    isCameraRole(p.camera_role) &&
    (p.status === 'ok' || p.status === 'failed' || p.status === 'skipped') &&
    typeof p.created_at === 'string'
  );
}

function normalizeCamera(raw: Camera): Camera {
  const kind =
    raw.capture_kind === 'http_snapshot' || raw.capture_kind === 'rtsp' || raw.capture_kind === 'auto'
      ? raw.capture_kind
      : 'auto';
  let roi: CameraRoi | null = null;
  if (raw.roi && typeof raw.roi === 'object') {
    const r = raw.roi;
    if (
      typeof r.x === 'number' &&
      typeof r.y === 'number' &&
      typeof r.w === 'number' &&
      typeof r.h === 'number'
    ) {
      roi = { x: r.x, y: r.y, w: r.w, h: r.h };
    }
  }
  return {
    ...raw,
    capture_kind: kind,
    enabled: Boolean(raw.enabled),
    sort_order: typeof raw.sort_order === 'number' && Number.isFinite(raw.sort_order) ? raw.sort_order : 0,
    roi,
    reference_normal_path: raw.reference_normal_path ?? null,
    reference_spare_path: raw.reference_spare_path ?? null,
  };
}

export const CamerasStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.CAMERAS) === null) {
      localStorage.setItem(STORAGE_KEYS.CAMERAS, '[]');
    }
  },

  getAll(): Camera[] {
    CamerasStorage.ensureInitialized();
    return readJsonArray(STORAGE_KEYS.CAMERAS, isCamera).map(normalizeCamera);
  },

  replaceAll(cameras: Camera[]): void {
    CamerasStorage.ensureInitialized();
    persistJsonArray(STORAGE_KEYS.CAMERAS, cameras.map(normalizeCamera));
  },

  upsert(camera: Camera): Camera {
    const normalized = normalizeCamera(camera);
    const list = CamerasStorage.getAll();
    const index = list.findIndex((c) => c.id === normalized.id);
    if (index === -1) list.push(normalized);
    else list[index] = normalized;
    CamerasStorage.replaceAll(list);
    return normalized;
  },

  remove(id: string): void {
    CamerasStorage.replaceAll(CamerasStorage.getAll().filter((c) => c.id !== id));
  },

  forSite(siteId: string): Camera[] {
    return CamerasStorage.getAll()
      .filter((c) => c.site_id === siteId)
      .sort((a, b) => a.sort_order - b.sort_order);
  },
};

export const TicketPhotosStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.TICKET_PHOTOS) === null) {
      localStorage.setItem(STORAGE_KEYS.TICKET_PHOTOS, '[]');
    }
  },

  getAll(): TicketPhoto[] {
    TicketPhotosStorage.ensureInitialized();
    return readJsonArray(STORAGE_KEYS.TICKET_PHOTOS, isTicketPhoto);
  },

  replaceAll(photos: TicketPhoto[]): void {
    TicketPhotosStorage.ensureInitialized();
    persistJsonArray(STORAGE_KEYS.TICKET_PHOTOS, photos);
  },

  merge(photos: TicketPhoto[]): void {
    const byId = new Map(TicketPhotosStorage.getAll().map((p) => [p.id, p]));
    for (const photo of photos) {
      byId.set(photo.id, photo);
    }
    TicketPhotosStorage.replaceAll([...byId.values()]);
  },

  forTicket(ticketId: string): TicketPhoto[] {
    return TicketPhotosStorage.getAll().filter((p) => p.ticket_id === ticketId);
  },
};

export const SitesStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.SITES) === null) {
      localStorage.setItem(STORAGE_KEYS.SITES, '[]');
    }
  },

  getAll(): Site[] {
    SitesStorage.ensureInitialized();
    return readJsonArray(STORAGE_KEYS.SITES, isSite);
  },

  replaceAll(sites: Site[]): void {
    SitesStorage.ensureInitialized();
    persistJsonArray(STORAGE_KEYS.SITES, sites);
  },

  upsert(site: Site): Site {
    const sites = SitesStorage.getAll();
    const index = sites.findIndex((s) => s.id === site.id);
    if (index === -1) sites.push(site);
    else sites[index] = site;
    SitesStorage.replaceAll(sites);
    return site;
  },
};

export const ScalesStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.SCALES) === null) {
      localStorage.setItem(STORAGE_KEYS.SCALES, '[]');
    }
  },

  getAll(): Scale[] {
    ScalesStorage.ensureInitialized();
    return readJsonArray(STORAGE_KEYS.SCALES, isScale).map((scale) => {
      const adapter_id = normalizeScaleDeviceId(scale.adapter_id);
      const defaults = SCALE_DEVICES[adapter_id];
      const conn = (scale.connection ?? {}) as ScaleConnectionProfile;
      const transport =
        conn.transport === 'web_serial' || conn.transport === 'serial' || conn.transport === 'tcp'
          ? conn.transport
          : 'web_serial';
      const connection: ScaleConnectionProfile = {
        transport,
        baudRate:
          typeof conn.baudRate === 'number' && Number.isFinite(conn.baudRate)
            ? conn.baudRate
            : defaults.baudRate,
        parity:
          conn.parity === 'none' || conn.parity === 'even' || conn.parity === 'odd'
            ? conn.parity
            : defaults.parity,
        dataBits: conn.dataBits === 7 || conn.dataBits === 8 ? conn.dataBits : defaults.dataBits,
        stopBits: conn.stopBits === 1 || conn.stopBits === 2 ? conn.stopBits : defaults.stopBits,
        lineTerminator:
          typeof conn.lineTerminator === 'string'
            ? conn.lineTerminator
            : defaults.lineTerminator,
        parseRegex: conn.parseRegex,
        parseStableGroup: conn.parseStableGroup,
        parseUnitGroup: conn.parseUnitGroup,
        parseSignGroup: conn.parseSignGroup,
        parseMask: conn.parseMask,
        host: conn.host,
        tcpPort: conn.tcpPort,
        serialPath: conn.serialPath,
      };
      return {
        ...scale,
        adapter_id,
        connection,
        enabled: Boolean(scale.enabled),
      };
    });
  },

  replaceAll(scales: Scale[]): void {
    ScalesStorage.ensureInitialized();
    persistJsonArray(STORAGE_KEYS.SCALES, scales);
  },

  upsert(scale: Scale): Scale {
    const scales = ScalesStorage.getAll();
    // Application-level: ≤1 enabled scale per (site_id, role)
    if (scale.enabled) {
      for (let i = 0; i < scales.length; i++) {
        const existing = scales[i];
        if (
          existing.id !== scale.id &&
          existing.site_id === scale.site_id &&
          existing.role === scale.role &&
          existing.enabled
        ) {
          scales[i] = { ...existing, enabled: false };
        }
      }
    }
    const index = scales.findIndex((s) => s.id === scale.id);
    if (index === -1) scales.push(scale);
    else scales[index] = scale;
    ScalesStorage.replaceAll(scales);
    return scale;
  },

  getBySite(siteId: string): Scale[] {
    return ScalesStorage.getAll().filter((s) => s.site_id === siteId);
  },
};

export const SiteRuntimeStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.SITE_RUNTIME) === null) {
      localStorage.setItem(STORAGE_KEYS.SITE_RUNTIME, '[]');
    }
  },

  getAll(): SiteRuntime[] {
    SiteRuntimeStorage.ensureInitialized();
    return readJsonArray(STORAGE_KEYS.SITE_RUNTIME, isSiteRuntime);
  },

  replaceAll(rows: SiteRuntime[]): void {
    SiteRuntimeStorage.ensureInitialized();
    persistJsonArray(STORAGE_KEYS.SITE_RUNTIME, rows);
  },

  upsert(runtime: SiteRuntime): SiteRuntime {
    const rows = SiteRuntimeStorage.getAll();
    const index = rows.findIndex((r) => r.site_id === runtime.site_id);
    if (index === -1) rows.push(runtime);
    else rows[index] = runtime;
    SiteRuntimeStorage.replaceAll(rows);
    return runtime;
  },

  getBySite(siteId: string): SiteRuntime | null {
    return SiteRuntimeStorage.getAll().find((r) => r.site_id === siteId) ?? null;
  },
};

export const SiteScaleSwitchesStorage = {
  ensureInitialized(): void {
    if (localStorage.getItem(STORAGE_KEYS.SITE_SCALE_SWITCHES) === null) {
      localStorage.setItem(STORAGE_KEYS.SITE_SCALE_SWITCHES, '[]');
    }
  },

  getAll(): SiteScaleSwitchEvent[] {
    SiteScaleSwitchesStorage.ensureInitialized();
    return readJsonArray(STORAGE_KEYS.SITE_SCALE_SWITCHES, isSiteScaleSwitchEvent);
  },

  replaceAll(events: SiteScaleSwitchEvent[]): void {
    SiteScaleSwitchesStorage.ensureInitialized();
    persistJsonArray(STORAGE_KEYS.SITE_SCALE_SWITCHES, events);
  },

  append(event: SiteScaleSwitchEvent): SiteScaleSwitchEvent {
    const events = SiteScaleSwitchesStorage.getAll();
    events.push(event);
    SiteScaleSwitchesStorage.replaceAll(events);
    return event;
  },

  getBySite(siteId: string): SiteScaleSwitchEvent[] {
    return SiteScaleSwitchesStorage.getAll()
      .filter((e) => e.site_id === siteId)
      .sort((a, b) => a.at.localeCompare(b.at));
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
  preferred_driver_name?: string | null;
  preferred_cargo_name?: string | null;
  preferred_shipper_name?: string | null;
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
      if (normalizedEntry.preferred_driver_name) {
        normalizedEntry.preferred_driver_name = formatPersonName(
          String(normalizedEntry.preferred_driver_name),
        );
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
      if (normalizedUpdates.preferred_driver_name) {
        normalizedUpdates.preferred_driver_name = formatPersonName(
          String(normalizedUpdates.preferred_driver_name),
        );
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
  /** When to require/show manual_weight_reason on tickets. Default: optional. */
  manual_weight_reason_mode: ManualWeightReasonMode;
  /** Enable photo capture on gross/tare fix (full build). Default: false. */
  video_enabled: boolean;
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
  driver_input_mode: 'all',
  scale_device_id: 'microsim-m0601',
  manual_weight_reason_mode: 'optional',
  video_enabled: false,
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
      manual_weight_reason_mode: normalizeManualWeightReasonMode(
        stored.manual_weight_reason_mode,
      ),
      video_enabled: stored.video_enabled === 'true',
    };
  },

  updateAppSettings: (updates: Partial<AppSettings>): AppSettings => {
    const current = SettingsStorage.getAppSettings();
    const next = { ...current, ...updates };
    next.driver_input_mode = normalizeDriverInputMode(next.driver_input_mode);
    next.scale_device_id = normalizeScaleDeviceId(next.scale_device_id);
    next.manual_weight_reason_mode = normalizeManualWeightReasonMode(
      next.manual_weight_reason_mode,
    );
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
      manual_weight_reason_mode: next.manual_weight_reason_mode,
      video_enabled: String(next.video_enabled),
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
    SitesStorage.ensureInitialized();
    ScalesStorage.ensureInitialized();
    SiteRuntimeStorage.ensureInitialized();
    SiteScaleSwitchesStorage.ensureInitialized();
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
  SitesStorage.ensureInitialized();
  ScalesStorage.ensureInitialized();
  SiteRuntimeStorage.ensureInitialized();
  SiteScaleSwitchesStorage.ensureInitialized();
};
