/**
 * Domain module: site / scales / primary↔spare runtime (roadmap stage 4).
 * Source of truth for active scale set; AppSettings.scale_device_id is a cache.
 */
import {
  SitesStorage,
  ScalesStorage,
  SiteRuntimeStorage,
  SiteScaleSwitchesStorage,
  SettingsStorage,
  type Site,
  type Scale,
  type SiteRuntime,
  type SiteScaleSwitchEvent,
  type ScaleRole,
  type ActiveScaleSet,
  type CameraMode,
  type AnprMode,
  type SwitchReason,
  type CameraAck,
  type ScaleConnectionProfile,
} from './storage';
import {
  SCALE_DEVICES,
  getAdapter,
  normalizeAdapterId as normalizeAdapterIdFromRegistry,
  connectionFromAdapter,
  type ScaleDeviceId,
  type ScaleAdapterId,
  type ScaleTransportKind,
} from './scales';
import { logger } from './logger';

export type {
  Site,
  Scale,
  SiteRuntime,
  SiteScaleSwitchEvent,
  ScaleRole,
  ActiveScaleSet,
  CameraMode,
  AnprMode,
  SwitchReason,
  CameraAck,
  ScaleConnectionProfile,
};

export const SWITCH_REASON_LABELS: Record<SwitchReason, string> = {
  repair: 'Ремонт',
  cleaning: 'Очистка',
  verification: 'Поверка',
  other: 'Другое',
};

export const ACTIVE_SCALE_SET_LABELS: Record<ActiveScaleSet, string> = {
  primary: 'Основные',
  spare: 'Резервные',
};

export const SITE_RUNTIME_UPDATED_EVENT = 'site-runtime-updated';

export const DEFAULT_SITE_NAME = 'Основная площадка';
export const DEFAULT_SPARE_SCALE_NAME = 'Резервные весы';

export interface ActiveScaleContext {
  site: Site;
  runtime: SiteRuntime;
  activeScale: Scale;
  site_id: string;
  scale_id: string;
  scale_role: ScaleRole;
  adapter_id: ScaleDeviceId;
}

function dispatchRuntimeUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SITE_RUNTIME_UPDATED_EVENT));
  }
}

export function connectionFromDevice(deviceId: ScaleDeviceId): ScaleConnectionProfile {
  return connectionFromAdapter(deviceId as ScaleAdapterId);
}

function normalizeAdapterId(raw: unknown): ScaleDeviceId {
  return normalizeAdapterIdFromRegistry(raw);
}

function normalizeTransport(raw: unknown): ScaleTransportKind {
  if (raw === 'web_serial' || raw === 'serial' || raw === 'tcp') return raw;
  return 'web_serial';
}

/** Soft-normalize connection: default transport, fill framing gaps from adapter defaults. */
export function normalizeScaleConnection(
  adapterId: ScaleDeviceId,
  connection: Partial<ScaleConnectionProfile> | null | undefined,
): ScaleConnectionProfile {
  const defaults = connectionFromDevice(adapterId);
  const src = connection ?? {};
  const parity =
    src.parity === 'none' || src.parity === 'even' || src.parity === 'odd'
      ? src.parity
      : defaults.parity;
  const dataBits = src.dataBits === 7 || src.dataBits === 8 ? src.dataBits : defaults.dataBits;
  const stopBits = src.stopBits === 1 || src.stopBits === 2 ? src.stopBits : defaults.stopBits;
  return {
    ...defaults,
    ...src,
    transport: normalizeTransport(src.transport ?? defaults.transport),
    baudRate:
      typeof src.baudRate === 'number' && Number.isFinite(src.baudRate)
        ? src.baudRate
        : defaults.baudRate,
    parity,
    dataBits,
    stopBits,
    lineTerminator:
      typeof src.lineTerminator === 'string' ? src.lineTerminator : defaults.lineTerminator,
  };
}

function ensureRuntimeRow(siteId: string): SiteRuntime {
  const existing = SiteRuntimeStorage.getBySite(siteId);
  if (existing) return existing;
  const created: SiteRuntime = {
    site_id: siteId,
    active_scale_set: 'primary',
    camera_mode: 'normal',
    anpr_mode: 'enabled',
    switch_reason: null,
    switch_by_operator_id: null,
    switch_by_operator_name: null,
    switch_at: null,
  };
  return SiteRuntimeStorage.upsert(created);
}

/** Idempotent migration: default site + primary from scale_device_id + disabled spare. */
export function ensureSiteMigrated(): void {
  SitesStorage.ensureInitialized();
  ScalesStorage.ensureInitialized();
  SiteRuntimeStorage.ensureInitialized();
  SiteScaleSwitchesStorage.ensureInitialized();

  const sites = SitesStorage.getAll();
  const scales = ScalesStorage.getAll();
  const hasPrimary = scales.some((s) => s.role === 'primary');

  if (sites.length > 0 && hasPrimary) {
    const defaultSite = sites.find((s) => s.is_default) ?? sites[0];
    ensureRuntimeRow(defaultSite.id);
    return;
  }

  const adapterId = normalizeAdapterId(SettingsStorage.getAppSettings().scale_device_id);
  const now = new Date().toISOString();
  const siteId = crypto.randomUUID();
  const primaryId = crypto.randomUUID();
  const spareId = crypto.randomUUID();

  const site: Site = {
    id: siteId,
    name: DEFAULT_SITE_NAME,
    is_default: true,
    created_at: now,
  };

  const primary: Scale = {
    id: primaryId,
    site_id: siteId,
    role: 'primary',
    name: SCALE_DEVICES[adapterId].name,
    adapter_id: adapterId,
    connection: connectionFromDevice(adapterId),
    enabled: true,
    created_at: now,
  };

  const spare: Scale = {
    id: spareId,
    site_id: siteId,
    role: 'spare',
    name: DEFAULT_SPARE_SCALE_NAME,
    adapter_id: adapterId,
    connection: connectionFromDevice(adapterId),
    enabled: false,
    created_at: now,
  };

  const runtime: SiteRuntime = {
    site_id: siteId,
    active_scale_set: 'primary',
    camera_mode: 'normal',
    anpr_mode: 'enabled',
    switch_reason: null,
    switch_by_operator_id: null,
    switch_by_operator_name: null,
    switch_at: null,
  };

  SitesStorage.replaceAll([site]);
  ScalesStorage.replaceAll([primary, spare]);
  SiteRuntimeStorage.replaceAll([runtime]);
}

export function getDefaultSite(): Site {
  ensureSiteMigrated();
  const sites = SitesStorage.getAll();
  const found = sites.find((s) => s.is_default) ?? sites[0];
  if (!found) {
    throw new Error('Площадка не найдена');
  }
  return found;
}

export function getSiteRuntime(siteId?: string): SiteRuntime {
  ensureSiteMigrated();
  const site = siteId
    ? SitesStorage.getAll().find((s) => s.id === siteId) ?? getDefaultSite()
    : getDefaultSite();
  return ensureRuntimeRow(site.id);
}

export function listScalesForSite(siteId?: string): Scale[] {
  ensureSiteMigrated();
  const id = siteId ?? getDefaultSite().id;
  return ScalesStorage.getBySite(id);
}

export function getActiveScaleContext(): ActiveScaleContext {
  ensureSiteMigrated();
  const site = getDefaultSite();
  const runtime = ensureRuntimeRow(site.id);
  const scales = ScalesStorage.getBySite(site.id);
  const activeScale = scales.find(
    (s) => s.role === runtime.active_scale_set && s.enabled,
  );
  if (!activeScale) {
    const primary = scales.find((s) => s.role === 'primary');
    if (!primary) {
      throw new Error('Основные весы не найдены');
    }
    logger.warn(
      'site-runtime',
      'Активный комплект недоступен (enabled=false или отсутствует); откат на основные',
      {
        active_scale_set: runtime.active_scale_set,
        spare_enabled: scales.some((s) => s.role === 'spare' && s.enabled),
        site_id: site.id,
      },
    );
    // Heal split-brain: runtime claimed spare/primary but matching enabled scale is gone
    let resolvedRuntime = runtime;
    if (runtime.active_scale_set !== 'primary') {
      resolvedRuntime = SiteRuntimeStorage.upsert({
        ...runtime,
        active_scale_set: 'primary',
        camera_mode: 'normal',
        anpr_mode: 'enabled',
      });
      SettingsStorage.updateAppSettings({
        scale_device_id: normalizeAdapterId(primary.adapter_id),
      });
      dispatchRuntimeUpdated();
    }
    return {
      site,
      runtime: resolvedRuntime,
      activeScale: primary,
      site_id: site.id,
      scale_id: primary.id,
      scale_role: primary.role,
      adapter_id: normalizeAdapterId(primary.adapter_id),
    };
  }
  return {
    site,
    runtime,
    activeScale,
    site_id: site.id,
    scale_id: activeScale.id,
    scale_role: activeScale.role,
    adapter_id: normalizeAdapterId(activeScale.adapter_id),
  };
}

export function updateSite(patch: Partial<Pick<Site, 'name'>> & { id: string }): Site {
  ensureSiteMigrated();
  const sites = SitesStorage.getAll();
  const index = sites.findIndex((s) => s.id === patch.id);
  if (index === -1) {
    throw new Error('Площадка не найдена');
  }
  const updated: Site = {
    ...sites[index],
    ...(patch.name !== undefined ? { name: patch.name.trim() || sites[index].name } : {}),
  };
  SitesStorage.upsert(updated);
  dispatchRuntimeUpdated();
  return updated;
}

export function upsertScale(
  scale: Omit<Scale, 'created_at'> & { created_at?: string },
): Scale {
  ensureSiteMigrated();
  const adapterId = normalizeAdapterId(scale.adapter_id);
  const next: Scale = {
    ...scale,
    adapter_id: adapterId,
    connection: normalizeScaleConnection(adapterId, scale.connection),
    created_at: scale.created_at ?? new Date().toISOString(),
  };
  const saved = ScalesStorage.upsert(next);
  dispatchRuntimeUpdated();
  return saved;
}

/** Enable/configure spare scale for switching. */
export function enableSpareScale(input: {
  adapter_id: ScaleDeviceId;
  name?: string;
}): Scale {
  ensureSiteMigrated();
  const site = getDefaultSite();
  const scales = ScalesStorage.getBySite(site.id);
  const existing = scales.find((s) => s.role === 'spare');
  const adapterId = normalizeAdapterId(input.adapter_id);
  const now = new Date().toISOString();

  const keepConnection =
    existing &&
    normalizeAdapterId(existing.adapter_id) === adapterId &&
    existing.connection
      ? existing.connection
      : connectionFromDevice(adapterId);
  const spare: Scale = {
    id: existing?.id ?? crypto.randomUUID(),
    site_id: site.id,
    role: 'spare',
    name: (input.name?.trim() || existing?.name || DEFAULT_SPARE_SCALE_NAME),
    adapter_id: adapterId,
    connection: normalizeScaleConnection(adapterId, keepConnection),
    enabled: true,
    created_at: existing?.created_at ?? now,
  };
  return upsertScale(spare);
}

/**
 * Disable spare scale. Forbidden while active_scale_set === 'spare'
 * to avoid split-brain (runtime spare vs tickets/device on primary fallback).
 */
export function disableSpareScale(input?: {
  adapter_id?: ScaleDeviceId;
  name?: string;
}): Scale {
  ensureSiteMigrated();
  const site = getDefaultSite();
  const runtime = ensureRuntimeRow(site.id);
  if (runtime.active_scale_set === 'spare') {
    throw new Error(
      'Сначала вернитесь на основные весы, затем отключите резервный комплект.',
    );
  }
  const scales = ScalesStorage.getBySite(site.id);
  const existing = scales.find((s) => s.role === 'spare');
  if (!existing) {
    throw new Error('Резервные весы не найдены');
  }
  const adapterId = normalizeAdapterId(input?.adapter_id ?? existing.adapter_id);
  const keepConnection =
    normalizeAdapterId(existing.adapter_id) === adapterId && existing.connection
      ? existing.connection
      : connectionFromDevice(adapterId);
  return upsertScale({
    ...existing,
    adapter_id: adapterId,
    name: input?.name?.trim() || existing.name,
    connection: normalizeScaleConnection(adapterId, keepConnection),
    enabled: false,
  });
}

/** Update adapter/connection of the currently active scale + settings cache. */
export function updateActiveScaleDevice(deviceId: ScaleDeviceId): Scale {
  ensureSiteMigrated();
  const ctx = getActiveScaleContext();
  const adapterId = normalizeAdapterId(deviceId);
  const adapterChanged = normalizeAdapterId(ctx.activeScale.adapter_id) !== adapterId;
  const updated = upsertScale({
    ...ctx.activeScale,
    adapter_id: adapterId,
    name:
      ctx.activeScale.role === 'spare' && ctx.activeScale.name === DEFAULT_SPARE_SCALE_NAME
        ? DEFAULT_SPARE_SCALE_NAME
        : getAdapter(adapterId).name,
    connection: adapterChanged
      ? connectionFromDevice(adapterId)
      : normalizeScaleConnection(adapterId, ctx.activeScale.connection),
  });
  SettingsStorage.updateAppSettings({ scale_device_id: adapterId });
  dispatchRuntimeUpdated();
  return updated;
}

export function switchScaleSet(input: {
  to: ActiveScaleSet;
  reason: SwitchReason;
  operator_id: string | null;
  operator_name: string;
  camera_ack?: CameraAck | null;
}): ActiveScaleContext {
  ensureSiteMigrated();
  const site = getDefaultSite();
  const runtime = ensureRuntimeRow(site.id);
  const from = runtime.active_scale_set;

  if (from === input.to) {
    return getActiveScaleContext();
  }

  const scales = ScalesStorage.getBySite(site.id);
  const target = scales.find((s) => s.role === input.to);

  if (input.to === 'spare') {
    if (!target || !target.enabled) {
      throw new Error(
        'Резервные весы не настроены. Включите и сохраните профиль резервных весов в настройках.',
      );
    }
    if (input.camera_ack !== 'rotated' && input.camera_ack !== 'no_cameras') {
      throw new Error('Подтвердите состояние камер перед переключением на резерв.');
    }
  } else {
    if (!target || !target.enabled) {
      throw new Error('Основные весы не найдены.');
    }
  }

  const at = new Date().toISOString();
  const nextRuntime: SiteRuntime = {
    site_id: site.id,
    active_scale_set: input.to,
    camera_mode: input.to === 'spare' ? 'rotated_for_spare' : 'normal',
    anpr_mode: input.to === 'spare' ? 'disabled_by_configuration' : 'enabled',
    switch_reason: input.reason,
    switch_by_operator_id: input.operator_id,
    switch_by_operator_name: input.operator_name,
    switch_at: at,
  };

  const event: SiteScaleSwitchEvent = {
    id: crypto.randomUUID(),
    site_id: site.id,
    from_set: from,
    to_set: input.to,
    reason: input.reason,
    operator_id: input.operator_id,
    operator_name: input.operator_name || 'Оператор',
    at,
    camera_ack: input.to === 'spare' ? (input.camera_ack ?? null) : null,
  };

  SiteRuntimeStorage.upsert(nextRuntime);
  SiteScaleSwitchesStorage.append(event);
  SettingsStorage.updateAppSettings({
    scale_device_id: normalizeAdapterId(target.adapter_id),
  });
  dispatchRuntimeUpdated();
  return getActiveScaleContext();
}

export function listSwitchHistory(siteId?: string): SiteScaleSwitchEvent[] {
  ensureSiteMigrated();
  const id = siteId ?? getDefaultSite().id;
  return SiteScaleSwitchesStorage.getBySite(id);
}

export function isSpareEnabled(siteId?: string): boolean {
  return listScalesForSite(siteId).some((s) => s.role === 'spare' && s.enabled);
}
