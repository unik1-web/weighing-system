// Local storage abstraction for weighing system
export type WeightSource = 'manual' | 'instrument';
export type TicketStatus = 'open' | 'completed';

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
  notes: string;
  created_at: string;
  completed_at: string | null;
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
  VEHICLES: 'app_vehicles',
  DRIVERS: 'app_drivers',
  CARGOS: 'app_cargos',
  SHIPPERS: 'app_shippers',
  RECEIVERS: 'app_receivers',
  CARRIERS: 'app_carriers',
  SETTINGS: 'app_settings',
  CURRENT_USER: 'app_current_user',
};

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
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

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
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
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
    localStorage.setItem(STORAGE_KEYS.USERS + '_profiles', JSON.stringify(profiles));
  },

  deleteProfile: (userId: string): void => {
    const profiles = getAllProfiles();
    delete profiles[userId];
    localStorage.setItem(STORAGE_KEYS.USERS + '_profiles', JSON.stringify(profiles));
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
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(session));
  },

  getSession: (): Session | null => {
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    return stored ? JSON.parse(stored) : null;
  },

  clearSession: (): void => {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  },
};

// Weighing tickets storage
export const TicketStorage = {
  create: (ticket: Omit<WeighingTicket, 'id' | 'ticket_number' | 'created_at'>): WeighingTicket => {
    const tickets = getAllTickets();
    const maxNumber = Math.max(0, ...tickets.map(t => t.ticket_number || 0));

    const newTicket: WeighingTicket = {
      id: crypto.randomUUID(),
      ticket_number: maxNumber + 1,
      created_at: new Date().toISOString(),
      ...ticket,
    };

    tickets.push(newTicket);
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
    return newTicket;
  },

  getAll: (): WeighingTicket[] => {
    return getAllTickets().sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  getById: (id: string): WeighingTicket | null => {
    return getAllTickets().find(t => t.id === id) || null;
  },

  delete: (id: string): void => {
    const tickets = getAllTickets().filter(t => t.id !== id);
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
  },

  update: (id: string, updates: Partial<WeighingTicket>): WeighingTicket | null => {
    const tickets = getAllTickets();
    const index = tickets.findIndex(t => t.id === id);
    if (index === -1) return null;

    tickets[index] = { ...tickets[index], ...updates };
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
    return tickets[index];
  },
};

function getAllTickets(): WeighingTicket[] {
  const stored = localStorage.getItem(STORAGE_KEYS.TICKETS);
  return stored ? JSON.parse(stored) : [];
}

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

    const newEntry: DictionaryEntry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...entry,
    };

    items.push(newEntry);
    localStorage.setItem(key, JSON.stringify(items));
    return newEntry;
  },

  update: (table: DictionaryTable, id: string, updates: Partial<DictionaryEntry>): DictionaryEntry | null => {
    const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
    const items = DictionaryStorage.getTable(table);
    const index = items.findIndex(i => i.id === id);
    if (index === -1) return null;

    items[index] = { ...items[index], ...updates };
    localStorage.setItem(key, JSON.stringify(items));
    return items[index];
  },

  delete: (table: DictionaryTable, id: string): void => {
    const key = STORAGE_KEYS[table.toUpperCase() as keyof typeof STORAGE_KEYS];
    const items = DictionaryStorage.getTable(table).filter(i => i.id !== id);
    localStorage.setItem(key, JSON.stringify(items));
  },
};

// Settings storage
export const SettingsStorage = {
  get: (key: string): string | null => {
    const settings = getAllSettings();
    return settings[key] ?? null;
  },

  set: (key: string, value: string): void => {
    const settings = getAllSettings();
    settings[key] = value;
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },
};

function getAllSettings(): Record<string, string> {
  const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  return stored ? JSON.parse(stored) : {};
}

// Initialize default data
export const initializeStorage = () => {
  if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
    try {
      UserStorage.createUser('admin', 'admin123', 'Администратор');
    } catch {
      // Default admin user already exists
    }

    // Create demo vehicles
    DictionaryStorage.add('vehicles', {
      name: 'А001АА',
      vehicle_number: 'А001АА',
      notes: 'Тестовый грузовик',
      default_tare_weight: 2500,
    });

    // Set org name
    SettingsStorage.set('org_name', 'Полигон отходов');
  }
};
