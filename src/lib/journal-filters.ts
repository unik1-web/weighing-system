/**
 * Client-side journal filters (AND across groups).
 */
import type { AnprStatus, WeighingMode, WeighingTicket } from './storage';
import { TicketPhotosStorage } from './storage';

export type PhotoFilter = 'all' | 'has' | 'none';
export type ScaleRoleFilter = 'all' | 'primary' | 'spare' | 'unset';
export type AnprStatusFilter = 'all' | AnprStatus | 'unset';
export type WeighingModeFilter = 'all' | WeighingMode;
export type SiteFilter = 'all' | 'unset' | string; // string = site_id
export type OperatorFilter = string; // empty = all; match id exact or name substring

export interface JournalFilterState {
  siteId: SiteFilter;
  scaleId: string; // empty = all; 'unset' = null/''
  scaleRole: ScaleRoleFilter;
  photo: PhotoFilter;
  anprStatus: AnprStatusFilter;
  weighingMode: WeighingModeFilter;
  operator: OperatorFilter;
}

export const DEFAULT_JOURNAL_FILTERS: JournalFilterState = {
  siteId: 'all',
  scaleId: '',
  scaleRole: 'all',
  photo: 'all',
  anprStatus: 'all',
  weighingMode: 'all',
  operator: '',
};

export function ticketHasPhotos(ticket: WeighingTicket): boolean {
  if (ticket.photo_entry_path || ticket.photo_exit_path || ticket.photo_overview_path) {
    return true;
  }
  try {
    return TicketPhotosStorage.forTicket(ticket.id).length > 0;
  } catch {
    return false;
  }
}

function isUnset(value: string | null | undefined): boolean {
  return value == null || value === '';
}

export function matchSiteFilter(ticket: WeighingTicket, filter: SiteFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unset') return isUnset(ticket.site_id);
  return ticket.site_id === filter;
}

export function matchScaleIdFilter(ticket: WeighingTicket, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'unset') return isUnset(ticket.scale_id);
  return ticket.scale_id === filter;
}

export function matchScaleRoleFilter(ticket: WeighingTicket, filter: ScaleRoleFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unset') return isUnset(ticket.scale_role);
  return ticket.scale_role === filter;
}

export function matchPhotoFilter(ticket: WeighingTicket, filter: PhotoFilter): boolean {
  if (filter === 'all') return true;
  const has = ticketHasPhotos(ticket);
  return filter === 'has' ? has : !has;
}

export function matchAnprStatusFilter(ticket: WeighingTicket, filter: AnprStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unset') return isUnset(ticket.anpr_status as string | null | undefined);
  return ticket.anpr_status === filter;
}

export function matchWeighingModeFilter(
  ticket: WeighingTicket,
  filter: WeighingModeFilter,
): boolean {
  if (filter === 'all') return true;
  return (ticket.weighing_mode ?? 'single') === filter;
}

export function matchOperatorFilter(ticket: WeighingTicket, filter: OperatorFilter): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  if (ticket.operator_id && ticket.operator_id.toLowerCase() === q) return true;
  return (ticket.operator_name ?? '').toLowerCase().includes(q);
}

export function matchJournalFilters(
  ticket: WeighingTicket,
  filters: JournalFilterState,
): boolean {
  return (
    matchSiteFilter(ticket, filters.siteId) &&
    matchScaleIdFilter(ticket, filters.scaleId) &&
    matchScaleRoleFilter(ticket, filters.scaleRole) &&
    matchPhotoFilter(ticket, filters.photo) &&
    matchAnprStatusFilter(ticket, filters.anprStatus) &&
    matchWeighingModeFilter(ticket, filters.weighingMode) &&
    matchOperatorFilter(ticket, filters.operator)
  );
}

export const WEIGHING_MODE_LABELS: Record<WeighingMode, string> = {
  single: 'Одиночное',
  dual: 'Двойное',
};

export const ANPR_STATUS_LABELS: Record<AnprStatus, string> = {
  enabled: 'Включён',
  disabled_by_configuration: 'Выкл. конфигурацией',
  failed: 'Ошибка',
};

export const SCALE_ROLE_LABELS: Record<'primary' | 'spare', string> = {
  primary: 'Основные',
  spare: 'Резервные',
};
