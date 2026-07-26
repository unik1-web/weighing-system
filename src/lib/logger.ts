export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  details?: unknown;
}

const STORAGE_KEY = 'app_logs';
const MAX_ENTRIES = 500;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function readEntries(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: LogEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

function shouldLog(level: LogLevel): boolean {
  const minLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'info';
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}

function appendEntry(entry: LogEntry): void {
  writeEntries([...readEntries(), entry]);
}

function log(level: LogLevel, category: string, message: string, details?: unknown): void {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details,
  };

  if (shouldLog(level)) {
    const prefix = `[${category}] ${message}`;
    if (level === 'error') console.error(prefix, details ?? '');
    else if (level === 'warn') console.warn(prefix, details ?? '');
    else if (level === 'debug') console.debug(prefix, details ?? '');
    else console.info(prefix, details ?? '');
  }

  if (level !== 'debug' || import.meta.env.DEV) {
    appendEntry(entry);
  }
}

export const logger = {
  debug: (category: string, message: string, details?: unknown) => log('debug', category, message, details),
  info: (category: string, message: string, details?: unknown) => log('info', category, message, details),
  warn: (category: string, message: string, details?: unknown) => log('warn', category, message, details),
  error: (category: string, message: string, details?: unknown) => log('error', category, message, details),
  getEntries: (): LogEntry[] => readEntries(),
  clear: (): void => {
    localStorage.removeItem(STORAGE_KEY);
  },
};
