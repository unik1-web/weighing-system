/**
 * Domain helpers for site / primary-spare scale sets.
 * No React; orchestrates storage + mirror + Web Serial disconnect.
 */
import {
  SettingsStorage,
  SiteRuntimeStorage,
  SiteStorage,
  ScaleStorage,
  ScaleSwitchJournalStorage,
  type AppSettings,
  type AnprMode,
  type CameraMode,
  type Scale,
  type ScaleConnectionJson,
  type ScaleSet,
  type ScaleSwitchJournalEntry,
  type SiteRuntime,
  type SwitchReason,
} from './storage';
import { normalizeScaleDeviceId, scaleConnection, type ScaleDeviceId } from './scales';
import { logger } from './logger';

export const DEFAULT_SITE_ID = 'default-site';
export const WEB_SERIAL_ADAPTER_ID = 'web_serial';
export const SITE_RUNTIME_CHANGED_EVENT = 'site-runtime-changed';
const BUILTIN_ADAPTER_IDS = new Set<ScaleDeviceId>([
  'microsim-m0601',
  'newton',
  'cas',
  'midl-mi-vda',
]);

export const SWITCH_REASONS: readonly SwitchReason[] = [
  'repair',
  'cleaning',
  'verification',
  'other',
] as const;

export const SWITCH_REASON_LABELS: Record<SwitchReason, string> = {
  repair: 'ремонт',
  cleaning: 'очистка',
  verification: 'поверка',
  other: 'другое',
};

export const SCALE_SET_LABELS: Record<ScaleSet, string> = {
  primary: 'основные',
  spare: 'резервные',
};

export const ANPR_MODE_LABELS: Record<AnprMode, string> = {
  enabled: 'включён (stub)',
  disabled_by_configuration: 'выключен конфигурацией',
  failed: 'сбой',
};

export function normalizeSwitchReason(raw: unknown): SwitchReason | null {
  if (raw === 'repair' || raw === 'cleaning' || raw === 'verification' || raw === 'other') {
    return raw;
  }
  return null;
}

export function normalizeAnprMode(raw: unknown): AnprMode | null {
  if (raw === 'enabled' || raw === 'disabled_by_configuration' || raw === 'failed') {
    return raw;
  }
  return null;
}

export function normalizeCameraMode(raw: unknown): CameraMode | null {
  if (raw === 'primary' || raw === 'spare') return raw;
  return null;
}

export function normalizeScaleSet(raw: unknown): ScaleSet | null {
  if (raw === 'primary' || raw === 'spare') return raw;
  return null;
}

export function parseScaleConnection(raw: unknown): ScaleConnectionJson {
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
  const transport =
    source.transport === 'serial_backend' || source.transport === 'tcp_client'
      ? source.transport
      : 'web_serial';
  const deviceRaw = source.device_id;
  const result: ScaleConnectionJson = {
    transport,
    device_id:
      deviceRaw === null || deviceRaw === undefined || deviceRaw === ''
        ? null
        : normalizeScaleDeviceId(String(deviceRaw)),
  };
  if (source.serial && typeof source.serial === 'object') {
    result.serial = source.serial as ScaleConnectionJson['serial'];
  }
  if (source.tcp && typeof source.tcp === 'object') {
    result.tcp = source.tcp as ScaleConnectionJson['tcp'];
  }
  if (source.parser && typeof source.parser === 'object') {
    result.parser = source.parser as ScaleConnectionJson['parser'];
  }
  return result;
}

export function buildScaleConnection(deviceId: ScaleDeviceId | null): ScaleConnectionJson {
  return { transport: 'web_serial', device_id: deviceId };
}

function isBuiltinAdapterId(value: string): value is ScaleDeviceId {
  return BUILTIN_ADAPTER_IDS.has(value as ScaleDeviceId);
}

function normalizeAdapterId(adapterId: string, connection: ScaleConnectionJson): string {
  if (isBuiltinAdapterId(adapterId)) return adapterId;
  if (adapterId === WEB_SERIAL_ADAPTER_ID && connection.device_id) return connection.device_id;
  return adapterId || WEB_SERIAL_ADAPTER_ID;
}

function normalizeScaleForStorage(scale: Scale): Scale {
  const normalizedConnection = parseScaleConnection(scale.connection);
  const normalizedAdapterId = normalizeAdapterId(scale.adapter_id, normalizedConnection);
  if (isBuiltinAdapterId(normalizedAdapterId)) {
    normalizedConnection.device_id = normalizedAdapterId;
  }
  return {
    ...scale,
    adapter_id: normalizedAdapterId,
    connection: normalizedConnection,
  };
}

function hasValidPrimaryConfiguration(scale: Scale | null): scale is Scale {
  if (!scale) return false;
  const normalized = normalizeScaleForStorage(scale);
  if (!isBuiltinAdapterId(normalized.adapter_id)) {
    return false;
  }
  return normalized.connection.device_id === normalized.adapter_id;
}

function normalizeScaleConnectionDraft(connection: ScaleConnectionJson): ScaleConnectionJson {
  return parseScaleConnection(connection);
}

export type EnsureSiteResult = {
  status: 'created' | 'skipped';
  siteId: string;
};

/**
 * Idempotent migration: default site, primary from scale_device_id, spare stub, runtime.
 */
export function ensureDefaultSiteAndScales(settings: AppSettings): EnsureSiteResult {
  try {
    const now = new Date().toISOString();
    const deviceId = normalizeScaleDeviceId(settings.scale_device_id);
    const site = SiteStorage.getById(DEFAULT_SITE_ID);
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare');
    const runtime = SiteRuntimeStorage.get(DEFAULT_SITE_ID);

    if (!site) {
      SiteStorage.upsert({
        id: DEFAULT_SITE_ID,
        name: 'Площадка по умолчанию',
        created_at: now,
      });
    }

    const normalizedPrimary = primary ? normalizeScaleForStorage(primary) : null;
    const validPrimary = hasValidPrimaryConfiguration(normalizedPrimary);

    if (!normalizedPrimary) {
      ScaleStorage.upsert({
        id: crypto.randomUUID(),
        site_id: DEFAULT_SITE_ID,
        role: 'primary',
        adapter_id: deviceId,
        connection: buildScaleConnection(deviceId),
        name: 'Основные',
        created_at: now,
      });
    } else if (!validPrimary) {
      ScaleStorage.upsert({
        ...normalizedPrimary,
        adapter_id: deviceId,
        connection: buildScaleConnection(deviceId),
      });
    } else if (
      normalizedPrimary.adapter_id !== primary!.adapter_id ||
      JSON.stringify(normalizedPrimary.connection) !== JSON.stringify(primary!.connection)
    ) {
      ScaleStorage.upsert(normalizedPrimary);
    }

    if (!spare) {
      ScaleStorage.upsert({
        id: crypto.randomUUID(),
        site_id: DEFAULT_SITE_ID,
        role: 'spare',
        adapter_id: WEB_SERIAL_ADAPTER_ID,
        connection: buildScaleConnection(null),
        name: 'Резервные',
        created_at: now,
      });
    } else {
      const normalizedSpare = normalizeScaleForStorage(spare);
      if (
        normalizedSpare.adapter_id !== spare.adapter_id ||
        JSON.stringify(normalizedSpare.connection) !== JSON.stringify(spare.connection)
      ) {
        ScaleStorage.upsert(normalizedSpare);
      }
    }

    if (!runtime) {
      SiteRuntimeStorage.upsert({
        site_id: DEFAULT_SITE_ID,
        active_scale_set: 'primary',
        camera_mode: 'primary',
        anpr_mode: 'enabled',
        last_switch_reason: null,
        last_switch_comment: null,
        last_switch_operator_name: null,
        last_switch_operator_id: null,
        last_switch_at: null,
        updated_at: now,
      });
    }

    const finalRuntime = SiteRuntimeStorage.get(DEFAULT_SITE_ID);
    const activeScale = finalRuntime
      ? ScaleStorage.getByRole(DEFAULT_SITE_ID, finalRuntime.active_scale_set)
      : null;
    if (activeScale) {
      alignDeviceMirror(activeScale.connection);
    }

    const wasComplete = !!site && !!primary && !!spare && !!runtime;
    const status: EnsureSiteResult['status'] = wasComplete ? 'skipped' : 'created';
    logger.info('site', 'Миграция площадки выполнена', {
      status,
      site_id: DEFAULT_SITE_ID,
      primary_device: activeScale?.connection.device_id ?? deviceId,
    });
    return { status, siteId: DEFAULT_SITE_ID };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('site', `Ошибка миграции площадки: ${message}`, err);
    throw err;
  }
}

/** Active scale for site (default site if omitted). */
export function getActiveScale(siteId: string = DEFAULT_SITE_ID): Scale | null {
  const runtime = SiteRuntimeStorage.get(siteId);
  if (!runtime) return null;
  return ScaleStorage.getByRole(siteId, runtime.active_scale_set);
}

export type TicketScaleFields = {
  site_id: string;
  scale_id: string;
  scale_role: ScaleSet;
};

/** Snapshot for new tickets from form; null if site/runtime not initialized. */
export function ticketScaleFieldsFromRuntime(
  siteId: string = DEFAULT_SITE_ID,
): TicketScaleFields | null {
  const runtime = SiteRuntimeStorage.get(siteId);
  const active = getActiveScale(siteId);
  if (!runtime || !active) return null;
  return {
    site_id: siteId,
    scale_id: active.id,
    scale_role: active.role,
  };
}

/**
 * Align AppSettings.scale_device_id under active connection (SoT).
 * Null device_id → do not write invalid value.
 */
export function alignDeviceMirror(activeConnection: ScaleConnectionJson | null | undefined): AppSettings {
  const current = SettingsStorage.getAppSettings();
  const deviceId = activeConnection?.device_id ?? null;
  if (deviceId === null || deviceId === undefined) {
    return current;
  }
  const normalized = normalizeScaleDeviceId(deviceId);
  if (current.scale_device_id === normalized) {
    return current;
  }
  return SettingsStorage.updateAppSettings({ scale_device_id: normalized });
}

export type ApplyScaleSetSwitchInput = {
  to_set: ScaleSet;
  reason: string;
  comment?: string | null;
  operator_name: string;
  operator_id?: string | null;
  checklist_confirmed?: boolean;
  siteId?: string;
};

export type ApplyScaleSetSwitchResult = {
  applied: boolean;
  from_set?: ScaleSet;
  to_set?: ScaleSet;
};

function normalizeComment(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Atomically switch active scale set: runtime + journal + mirror + disconnect + event.
 */
export function applyScaleSetSwitch(input: ApplyScaleSetSwitchInput): ApplyScaleSetSwitchResult {
  const siteId = input.siteId ?? DEFAULT_SITE_ID;
  const toSet = normalizeScaleSet(input.to_set);
  const reason = normalizeSwitchReason(input.reason);
  if (!toSet || !reason) {
    return { applied: false };
  }

  const runtime = SiteRuntimeStorage.get(siteId);
  if (!runtime) {
    logger.error('site', 'Переключение невозможно: нет site_runtime', { site_id: siteId });
    return { applied: false };
  }

  if (runtime.active_scale_set === toSet) {
    return { applied: false, from_set: toSet, to_set: toSet };
  }

  const fromSet = runtime.active_scale_set;
  const comment = normalizeComment(input.comment);
  const now = new Date().toISOString();
  const anprMode: AnprMode =
    toSet === 'spare' ? 'disabled_by_configuration' : 'enabled';

  try {
    const nextRuntime: SiteRuntime = {
      ...runtime,
      active_scale_set: toSet,
      camera_mode: toSet,
      anpr_mode: anprMode,
      last_switch_reason: reason,
      last_switch_comment: comment,
      last_switch_operator_name: input.operator_name || '',
      last_switch_operator_id: input.operator_id ?? null,
      last_switch_at: now,
      updated_at: now,
    };
    SiteRuntimeStorage.upsert(nextRuntime);

    const entry: ScaleSwitchJournalEntry = {
      id: crypto.randomUUID(),
      site_id: siteId,
      from_set: fromSet,
      to_set: toSet,
      reason,
      comment,
      operator_name: input.operator_name || '',
      operator_id: input.operator_id ?? null,
      switched_at: now,
    };
    ScaleSwitchJournalStorage.append(entry);

    const active = ScaleStorage.getByRole(siteId, toSet);
    if (active) {
      alignDeviceMirror(active.connection);
    }

    if (typeof scaleConnection.isConnected === 'function' && scaleConnection.isConnected()) {
      void scaleConnection.disconnect().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('site', `Ошибка disconnect Web Serial при смене комплекта: ${message}`);
      });
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SITE_RUNTIME_CHANGED_EVENT));
    }

    logger.info('site', `Переключение комплекта ${fromSet}→${toSet}`, {
      from_set: fromSet,
      to_set: toSet,
      reason,
      operator_name: input.operator_name,
      site_id: siteId,
    });

    return { applied: true, from_set: fromSet, to_set: toSet };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('site', `Ошибка переключения комплекта: ${message}`, err);
    throw err;
  }
}

/**
 * Update device_id on a scale; optionally sync AppSettings mirror.
 */
export function updateScaleConnectionDevice(
  scaleId: string,
  deviceId: ScaleDeviceId | null,
  syncMirror: boolean,
): Scale | null {
  const scales = ScaleStorage.getAll();
  const scale = scales.find((row) => row.id === scaleId);
  if (!scale) return null;

  const normalizedDevice =
    deviceId === null ? null : normalizeScaleDeviceId(deviceId);
  const nextAdapterId = normalizedDevice ?? scale.adapter_id;
  const connection: ScaleConnectionJson = {
    ...normalizeScaleConnectionDraft(scale.connection),
    device_id: normalizedDevice,
  };
  if (isBuiltinAdapterId(nextAdapterId)) {
    connection.device_id = nextAdapterId;
  }

  const updated = ScaleStorage.upsert({
    ...scale,
    adapter_id: nextAdapterId,
    connection,
  });

  if (syncMirror && connection.device_id) {
    alignDeviceMirror(connection);
  }
  return updated;
}

export function updateScaleConfiguration(
  scaleId: string,
  input: {
    adapter_id: string;
    connection: ScaleConnectionJson;
  },
  syncMirror: boolean,
): Scale | null {
  const scales = ScaleStorage.getAll();
  const scale = scales.find((row) => row.id === scaleId);
  if (!scale) return null;
  const normalizedConnection = normalizeScaleConnectionDraft(input.connection);
  const normalizedAdapterId = normalizeAdapterId(input.adapter_id, normalizedConnection);
  if (isBuiltinAdapterId(normalizedAdapterId)) {
    normalizedConnection.device_id = normalizedAdapterId;
  }
  const updated = ScaleStorage.upsert({
    ...scale,
    adapter_id: normalizedAdapterId,
    connection: normalizedConnection,
  });
  if (syncMirror && normalizedConnection.device_id) {
    alignDeviceMirror(normalizedConnection);
  }
  return updated;
}

/** Atomically update active scale connection + mirror. */
export function updateActiveScaleDevice(deviceId: ScaleDeviceId): Scale | null {
  const active = getActiveScale();
  if (!active) {
    SettingsStorage.updateAppSettings({ scale_device_id: normalizeScaleDeviceId(deviceId) });
    return null;
  }
  return updateScaleConnectionDevice(active.id, deviceId, true);
}

/** Compact label for weighing form indicator. */
export function activeScaleSetIndicatorLabel(siteId: string = DEFAULT_SITE_ID): string {
  const runtime = SiteRuntimeStorage.get(siteId);
  if (!runtime) return 'Весы: —';
  return runtime.active_scale_set === 'spare' ? 'Весы: резервные' : 'Весы: основные';
}
