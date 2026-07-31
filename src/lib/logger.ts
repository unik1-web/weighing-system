export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ScaleRuntimeContext {
  site_id?: string | null;
  scale_id?: string | null;
  scale_role?: string | null;
  adapter_id?: string | null;
  transport?: string | null;
  session_id?: string | null;
  code?: string | null;
  phase?: string | null;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  details?: unknown;
  runtime_context?: ScaleRuntimeContext;
}

const STORAGE_KEY = 'app_logs';
const MAX_ENTRIES = 500;
const RUNTIME_ERROR_DEBOUNCE_MS = 800;
const REDACTED_IP = '***.***.***.***';
const REDACTED_COM = 'COM***';
const REDACTED_TTY = '/dev/tty***';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let memoryEntries: LogEntry[] = [];

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readEntries(): LogEntry[] {
  if (!hasLocalStorage()) {
    return [...memoryEntries];
  }
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
  const trimmed = entries.slice(-MAX_ENTRIES);
  if (!hasLocalStorage()) {
    memoryEntries = [...trimmed];
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

function shouldLog(level: LogLevel): boolean {
  const minLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'info';
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}

function appendEntry(entry: LogEntry): void {
  writeEntries([...readEntries(), entry]);
}

type RuntimeDebounceState = {
  last_logged_at: number;
  suppressed_count: number;
};

const runtimeErrorDebounceState = new Map<string, RuntimeDebounceState>();

function redactSensitiveString(value: string): string {
  return value
    .replace(/\bCOM\d+\b/gi, REDACTED_COM)
    .replace(/\/dev\/tty[^\s"'`]+/gi, REDACTED_TTY)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, REDACTED_IP);
}

function redactSensitiveDetails(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveDetails(item));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactSensitiveDetails(nested);
    }
    return output;
  }
  return value;
}

function buildRuntimeErrorSignature(message: string, runtimeContext?: ScaleRuntimeContext): string {
  const signatureContext = {
    site_id: runtimeContext?.site_id ?? '',
    scale_id: runtimeContext?.scale_id ?? '',
    scale_role: runtimeContext?.scale_role ?? '',
    adapter_id: runtimeContext?.adapter_id ?? '',
    transport: runtimeContext?.transport ?? '',
    session_id: runtimeContext?.session_id ?? '',
    code: runtimeContext?.code ?? '',
    phase: runtimeContext?.phase ?? '',
  };
  return `${message}|${JSON.stringify(signatureContext)}`;
}

function emitConsole(level: LogLevel, category: string, message: string, details?: unknown): void {
  if (!shouldLog(level)) return;
  const prefix = `[${category}] ${message}`;
  if (level === 'error') console.error(prefix, details ?? '');
  else if (level === 'warn') console.warn(prefix, details ?? '');
  else if (level === 'debug') console.debug(prefix, details ?? '');
  else console.info(prefix, details ?? '');
}

function persistLogEntry(entry: LogEntry): void {
  if (entry.level !== 'debug' || import.meta.env.DEV) {
    appendEntry(entry);
  }
}

function writeLogEntry(level: LogLevel, category: string, message: string, details?: unknown, runtimeContext?: ScaleRuntimeContext): void {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    details: redactSensitiveDetails(details),
    runtime_context: runtimeContext ? redactSensitiveDetails(runtimeContext) as ScaleRuntimeContext : undefined,
  };
  emitConsole(level, category, message, entry.details);
  persistLogEntry(entry);
}

function log(level: LogLevel, category: string, message: string, details?: unknown, runtimeContext?: ScaleRuntimeContext): void {
  if (category === 'scale_runtime' && level === 'error') {
    const now = Date.now();
    const signature = buildRuntimeErrorSignature(message, runtimeContext);
    const state = runtimeErrorDebounceState.get(signature);
    if (state && now - state.last_logged_at < RUNTIME_ERROR_DEBOUNCE_MS) {
      state.suppressed_count += 1;
      runtimeErrorDebounceState.set(signature, state);
      return;
    }
    if (state && state.suppressed_count > 0) {
      writeLogEntry(
        'warn',
        'scale_runtime',
        'Повтор runtime-ошибки подавлены debounce',
        { suppressed_count: state.suppressed_count },
        runtimeContext,
      );
    }
    runtimeErrorDebounceState.set(signature, {
      last_logged_at: now,
      suppressed_count: 0,
    });
  }

  writeLogEntry(level, category, message, details, runtimeContext);
}

export const logger = {
  debug: (category: string, message: string, details?: unknown) => log('debug', category, message, details),
  info: (category: string, message: string, details?: unknown) => log('info', category, message, details),
  warn: (category: string, message: string, details?: unknown) => log('warn', category, message, details),
  error: (category: string, message: string, details?: unknown) => log('error', category, message, details),
  scaleRuntime: {
    debug: (message: string, runtimeContext: ScaleRuntimeContext, details?: unknown) =>
      log('debug', 'scale_runtime', message, details, runtimeContext),
    info: (message: string, runtimeContext: ScaleRuntimeContext, details?: unknown) =>
      log('info', 'scale_runtime', message, details, runtimeContext),
    warn: (message: string, runtimeContext: ScaleRuntimeContext, details?: unknown) =>
      log('warn', 'scale_runtime', message, details, runtimeContext),
    error: (message: string, runtimeContext: ScaleRuntimeContext, details?: unknown) =>
      log('error', 'scale_runtime', message, details, runtimeContext),
  },
  getEntries: (): LogEntry[] => readEntries(),
  clear: (): void => {
    if (hasLocalStorage()) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      memoryEntries = [];
    }
    runtimeErrorDebounceState.clear();
  },
};
