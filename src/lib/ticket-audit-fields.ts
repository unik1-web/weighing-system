/**
 * Significant ticket fields for audit revisions (aligned with ARCHIVE_EDITABLE_FIELDS).
 */
import type { WeighingTicket } from './storage';

/** Same whitelist as server year_rotation.ARCHIVE_EDITABLE_FIELDS. */
export const SIGNIFICANT_TICKET_FIELDS = [
  'vehicle_number',
  'vehicle_brand',
  'trailer_number',
  'driver_name',
  'cargo_name',
  'shipper_name',
  'receiver_name',
  'carrier_name',
  'price',
  'vat_rate',
  'gross_weight',
  'tare_weight',
  'net_weight',
  'total_amount',
  'gross_source',
  'tare_source',
  'gross_raw',
  'tare_raw',
  'gross_datetime',
  'tare_datetime',
  'scale_device',
  'status',
  'reo_status',
  'reo_sent_at',
  'notes',
  'created_at',
  'completed_at',
  'weighing_mode',
  'plate_source',
  'site_id',
  'scale_id',
  'scale_role',
  'manual_weight_reason',
  'photo_entry_path',
  'photo_exit_path',
  'photo_overview_path',
  'anpr_plate_raw',
  'plate_confidence',
  'anpr_accepted',
  'anpr_status',
] as const;

export type SignificantTicketField = (typeof SIGNIFICANT_TICKET_FIELDS)[number];

/** Match server year_rotation._stringify_revision_value. */
export function stringifyRevisionValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface TicketFieldDiff {
  field: SignificantTicketField;
  old_value: string | null;
  new_value: string | null;
}

export function diffTicketFields(
  before: Partial<WeighingTicket>,
  after: Partial<WeighingTicket>,
  fields: readonly SignificantTicketField[] = SIGNIFICANT_TICKET_FIELDS,
): TicketFieldDiff[] {
  const diffs: TicketFieldDiff[] = [];
  for (const field of fields) {
    const oldValue = stringifyRevisionValue(before[field as keyof WeighingTicket]);
    const newValue = stringifyRevisionValue(after[field as keyof WeighingTicket]);
    if (oldValue === newValue) continue;
    diffs.push({ field, old_value: oldValue, new_value: newValue });
  }
  return diffs;
}
