import { logger } from './logger';

const APP_PREFIX = 'app_';
const SETTINGS_KEY = 'app_settings';

/** Keys that dictionary import may safely refresh into localStorage. */
const DICTIONARY_STORAGE_KEYS = new Set([
  'app_vehicles',
  'app_drivers',
  'app_cargos',
  'app_shippers',
  'app_receivers',
  'app_carriers',
]);

/** Durable database keys — cleared before backup apply so omitted empty collections stay empty. */
const DATABASE_STORAGE_KEYS = [
  'app_users',
  'app_users_profiles',
  'app_weighing_tickets',
  'app_current_user',
  'app_vehicles',
  'app_drivers',
  'app_cargos',
  'app_shippers',
  'app_receivers',
  'app_carriers',
] as const;

export const DICTIONARIES_UPDATED_EVENT = 'dictionaries-updated';

let configSyncTimer: ReturnType<typeof setTimeout> | null = null;
let databaseSyncTimer: ReturnType<typeof setTimeout> | null = null;
let databaseSyncPaused = false;
let databaseSyncPending = false;
/** Serialize full-document SQLite writes so a stale in-flight sync cannot overwrite newer data. */
let databaseSyncChain: Promise<void> = Promise.resolve();
let databaseWriteInFlight = false;
let databaseWriteAgain = false;
/** True only after a successful server database read in this session. */
let serverDatabaseHydrated = false;

function collectDatabaseStorage(): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(APP_PREFIX) || key === SETTINGS_KEY) continue;
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

function collectConfigStorage(): Record<string, string> {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    );
  } catch {
    return {};
  }
}

export function applyStorageData(data: Record<string, string>): void {
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(APP_PREFIX) && typeof value === 'string') {
      localStorage.setItem(key, value);
    }
  }
}

/** Apply only dictionary keys — never tickets/users/session from an import response. */
export function applyDictionaryStorageData(data: Record<string, string>): void {
  for (const [key, value] of Object.entries(data)) {
    if (DICTIONARY_STORAGE_KEYS.has(key) && typeof value === 'string') {
      localStorage.setItem(key, value);
    }
  }
}

export function isServerDatabaseHydrated(): boolean {
  return serverDatabaseHydrated;
}

export async function loadStorageFromServer(): Promise<boolean> {
  try {
    const [configResponse, databaseResponse] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/database'),
    ]);

    let loaded = false;

    if (configResponse.ok) {
      const configBody = (await configResponse.json()) as { config?: Record<string, string> };
      const config = configBody.config ?? {};
      if (Object.keys(config).length > 0) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
        loaded = true;
      }
    }

    if (databaseResponse.ok) {
      const databaseBody = (await databaseResponse.json()) as { data?: Record<string, string> };
      const database = databaseBody.data ?? {};
      for (const [key, value] of Object.entries(database)) {
        if (key.startsWith(APP_PREFIX) && typeof value === 'string') {
          localStorage.setItem(key, value);
        }
      }
      // Successful read (even if empty) means we may safely sync local changes later.
      serverDatabaseHydrated = true;
      loaded = true;
    }

    if (loaded) {
      logger.info('storage', 'Загружены config.ini и BD/weighing.db');
    }
    return loaded;
  } catch {
    try {
      const response = await fetch('/api/storage');
      if (!response.ok) return false;
      const body = (await response.json()) as { data?: Record<string, string> };
      const data = body.data ?? {};
      applyStorageData(data);
      serverDatabaseHydrated = true;
      if (Object.keys(data).length === 0) return true;
      logger.info('storage', `Загружено из объединённого хранилища: ${Object.keys(data).length} ключей`);
      return true;
    } catch {
      return false;
    }
  }
}

async function syncConfigToServer(): Promise<void> {
  const config = collectConfigStorage();
  if (Object.keys(config).length === 0) return;
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    if (response.ok) {
      logger.debug('storage', 'config.ini сохранён');
    }
  } catch {
    // Backend недоступен
  }
}

async function syncDatabaseToServer(): Promise<void> {
  if (!serverDatabaseHydrated) {
    logger.debug('storage', 'Пропуск синхронизации BD: сервер ещё не загружен');
    return;
  }

  // Capture payload only when this write actually runs (end of the chain),
  // so a queued flush always persists the latest localStorage snapshot.
  const data = collectDatabaseStorage();
  try {
    const response = await fetch('/api/database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (response.ok) {
      logger.debug('storage', 'BD/weighing.db сохранён');
    }
  } catch {
    // Backend недоступен
  }
}

function enqueueDatabaseSync(): Promise<void> {
  if (databaseWriteInFlight) {
    databaseWriteAgain = true;
    return databaseSyncChain;
  }

  databaseWriteInFlight = true;
  databaseSyncChain = (async () => {
    try {
      do {
        databaseWriteAgain = false;
        await syncDatabaseToServer();
      } while (databaseWriteAgain);
    } finally {
      databaseWriteInFlight = false;
    }
  })();

  return databaseSyncChain;
}

export function scheduleConfigSync(): void {
  if (configSyncTimer) clearTimeout(configSyncTimer);
  configSyncTimer = setTimeout(() => {
    void syncConfigToServer();
  }, 400);
}

export function pauseDatabaseSync(): void {
  databaseSyncPaused = true;
  if (databaseSyncTimer) {
    clearTimeout(databaseSyncTimer);
    databaseSyncTimer = null;
  }
}

export function resumeDatabaseSync(): void {
  databaseSyncPaused = false;
  if (databaseSyncPending) {
    databaseSyncPending = false;
    scheduleDatabaseSync();
  }
}

export function scheduleDatabaseSync(): void {
  if (databaseSyncPaused) {
    databaseSyncPending = true;
    return;
  }
  if (databaseSyncTimer) clearTimeout(databaseSyncTimer);
  databaseSyncTimer = setTimeout(() => {
    void enqueueDatabaseSync();
  }, 400);
}

export function scheduleStorageSync(): void {
  scheduleConfigSync();
  scheduleDatabaseSync();
}

export function flushStorageSync(): void {
  if (databaseSyncTimer) {
    clearTimeout(databaseSyncTimer);
    databaseSyncTimer = null;
  }
  const config = collectConfigStorage();
  const data = collectDatabaseStorage();
  try {
    void fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
      keepalive: true,
    });
    if (serverDatabaseHydrated) {
      void fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
        keepalive: true,
      });
    }
  } catch {
    // ignore
  }
}

export async function flushDatabaseSync(): Promise<void> {
  if (databaseSyncTimer) {
    clearTimeout(databaseSyncTimer);
    databaseSyncTimer = null;
  }
  await enqueueDatabaseSync();
}

export interface StoragePaths {
  app_root: string;
  config_file: string;
  database_dir: string;
  database_file: string;
}

export async function fetchStoragePaths(): Promise<StoragePaths | null> {
  try {
    const response = await fetch('/api/storage/paths');
    if (!response.ok) return null;
    const body = (await response.json()) as StoragePaths & { success?: boolean };
    return {
      app_root: body.app_root,
      config_file: body.config_file,
      database_dir: body.database_dir,
      database_file: body.database_file,
    };
  } catch {
    return null;
  }
}

export async function exportStorageBackup(): Promise<void> {
  const response = await fetch('/api/storage/export');
  const body = (await response.json()) as {
    success?: boolean;
    format?: string;
    content?: string;
    message?: string;
  };
  if (!response.ok || !body.content) {
    throw new Error(body.message ?? 'Не удалось выполнить экспорт');
  }

  const blob = new Blob([body.content], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `weighing-backup_${new Date().toISOString().slice(0, 10)}.ini`;
  anchor.click();
  URL.revokeObjectURL(url);
  logger.info('storage', 'Экспорт резервной копии INI выполнен');
}

export async function importStorageBackup(file: File): Promise<void> {
  const text = await file.text();

  const response = await fetch('/api/storage/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, filename: file.name }),
  });

  const body = (await response.json()) as {
    success?: boolean;
    data?: Record<string, string>;
    message?: string;
  };

  if (!response.ok || !body.data) {
    throw new Error(body.message ?? 'Не удалось выполнить импорт');
  }

  // Server omits empty collections from read_database(). Clear durable keys first so
  // a backup with an empty journal/dictionaries actually replaces local data.
  for (const key of DATABASE_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  applyStorageData(body.data);
  scheduleStorageSync();
  logger.info('storage', 'Импорт резервной копии INI выполнен');
}

export async function importExternalDictionaries(
  source: 'vescom' | 'metra',
  payload: Record<string, string>,
): Promise<{ message: string; added: Record<string, number> }> {
  const response = await fetch(`/api/${source}/import_dictionaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as {
    success?: boolean;
    message?: string;
    added?: Record<string, number>;
    data?: Record<string, string>;
  };

  if (!response.ok || !body.data) {
    throw new Error(body.message ?? 'Не удалось импортировать справочники');
  }

  pauseDatabaseSync();
  try {
    // Only refresh dictionaries. Applying the full read_database() snapshot would
    // overwrite unsynced weighing tickets / users still only in localStorage.
    applyDictionaryStorageData(body.data);
  } finally {
    resumeDatabaseSync();
  }
  await flushDatabaseSync();

  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      window.dispatchEvent(new Event(DICTIONARIES_UPDATED_EVENT));
    }, 0);
  }
  logger.info('storage', `Импорт справочников из ${source} выполнен`);
  return {
    message: body.message ?? 'Справочники импортированы',
    added: body.added ?? {},
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushStorageSync);
}
