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
    return { device_id: null };
  }
  const deviceRaw = (raw as { device_id?: unknown }).device_id;
  if (deviceRaw === null || deviceRaw === undefined || deviceRaw === '') {
    return { device_id: null };
  }
  return { device_id: normalizeScaleDeviceId(String(deviceRaw)) };
}

export function buildScaleConnection(deviceId: ScaleDeviceId | null): ScaleConnectionJson {
  return { device_id: deviceId };
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
    const site = SiteStorage.getById(DEFAULT_SITE_ID);
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare');
    const runtime = SiteRuntimeStorage.get(DEFAULT_SITE_ID);

    if (site && primary && spare && runtime) {
      const active = ScaleStorage.getByRole(DEFAULT_SITE_ID, runtime.active_scale_set);
      if (active) {
        alignDeviceMirror(active.connection);
      }
      logger.info('site', 'Миграция площадки пропущена (уже есть)', {
        status: 'skipped',
        site_id: DEFAULT_SITE_ID,
      });
      return { status: 'skipped', siteId: DEFAULT_SITE_ID };
    }

    const now = new Date().toISOString();
    const deviceId = normalizeScaleDeviceId(settings.scale_device_id);

    if (!site) {
      SiteStorage.upsert({
        id: DEFAULT_SITE_ID,
        name: 'Площадка по умолчанию',
        created_at: now,
      });
    }

    if (!primary) {
      ScaleStorage.upsert({
        id: crypto.randomUUID(),
        site_id: DEFAULT_SITE_ID,
        role: 'primary',
        adapter_id: WEB_SERIAL_ADAPTER_ID,
        connection: buildScaleConnection(deviceId),
        name: 'Основные',
        created_at: now,
      });
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

    const activePrimary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    if (activePrimary) {
      alignDeviceMirror(activePrimary.connection);
    }

    logger.info('site', 'Миграция площадки выполнена', {
      status: 'created',
      site_id: DEFAULT_SITE_ID,
      primary_device: activePrimary?.connection.device_id ?? deviceId,
    });
    return { status: 'created', siteId: DEFAULT_SITE_ID };
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

  const connection =
    deviceId === null
      ? buildScaleConnection(null)
      : buildScaleConnection(normalizeScaleDeviceId(deviceId));

  const updated = ScaleStorage.upsert({
    ...scale,
    connection,
  });

  if (syncMirror && connection.device_id) {
    alignDeviceMirror(connection);
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
