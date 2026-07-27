import { logger } from './logger';

const APP_PREFIX = 'app_';
const SETTINGS_KEY = 'app_settings';

let configSyncTimer: ReturnType<typeof setTimeout> | null = null;
let databaseSyncTimer: ReturnType<typeof setTimeout> | null = null;
let databaseSyncPaused = false;
let databaseSyncPending = false;

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
      if (Object.keys(database).length > 0) loaded = true;
    }

    if (loaded) {
      logger.info('storage', 'Загружены config.json и BD/weighing.db');
    }
    return loaded;
  } catch {
    try {
      const response = await fetch('/api/storage');
      if (!response.ok) return false;
      const body = (await response.json()) as { data?: Record<string, string> };
      const data = body.data ?? {};
      if (Object.keys(data).length === 0) return false;
      applyStorageData(data);
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
      logger.debug('storage', 'config.json сохранён');
    }
  } catch {
    // Backend недоступен
  }
}

async function syncDatabaseToServer(): Promise<void> {
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
    void syncDatabaseToServer();
  }, 400);
}

export function scheduleStorageSync(): void {
  scheduleConfigSync();
  scheduleDatabaseSync();
}

export function flushStorageSync(): void {
  const config = collectConfigStorage();
  const data = collectDatabaseStorage();
  try {
    void fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
      keepalive: true,
    });
    void fetch('/api/database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
      keepalive: true,
    });
  } catch {
    // ignore
  }
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
    backup?: Record<string, unknown>;
    message?: string;
  };
  if (!response.ok || !body.backup) {
    throw new Error(body.message ?? 'Не удалось выполнить экспорт');
  }

  const blob = new Blob([JSON.stringify(body.backup, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `weighing-backup_${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  logger.info('storage', 'Экспорт резервной копии выполнен');
}

export async function importStorageBackup(file: File): Promise<void> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }

  const payload =
    parsed && typeof parsed === 'object' && 'backup' in (parsed as object)
      ? (parsed as { backup: Record<string, unknown> }).backup
      : (parsed as Record<string, unknown>);

  const response = await fetch('/api/storage/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: payload }),
  });

  const body = (await response.json()) as {
    success?: boolean;
    data?: Record<string, string>;
    message?: string;
  };

  if (!response.ok || !body.data) {
    throw new Error(body.message ?? 'Не удалось выполнить импорт');
  }

  applyStorageData(body.data);
  logger.info('storage', 'Импорт резервной копии выполнен');
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushStorageSync);
}
