/** Domain helpers: resolve trip fields from vehicle plate (prefs → last trip → defaults). */

import { formatVehiclePlate } from './vehicle-plate';
import { resolveTareAutofill, type TareAutofillResult } from './weight-source';

export type PlateSource = 'anpr' | 'operator' | 'directory';
export type DriverInputMode = 'vehicle' | 'all' | 'free';

export const DRIVER_INPUT_MODES: readonly DriverInputMode[] = ['vehicle', 'all', 'free'] as const;

export const DRIVER_INPUT_MODE_LABELS: Record<DriverInputMode, string> = {
  vehicle: 'По истории ТС',
  all: 'Весь справочник',
  free: 'Свободный ввод',
};

export interface VehicleDriverLink {
  id: string;
  vehicle_number: string;
  driver_name: string;
  last_used_at: string;
  use_count: number;
  driver_id?: string | null;
}

/** Minimal vehicle card shape used by resolve (dictionary payload). */
export interface VehicleCardLike {
  id?: string;
  name?: string;
  vehicle_number?: string;
  vehicle_brand?: string;
  default_tare_weight?: number | null;
  preferred_driver_name?: string | null;
  preferred_cargo_name?: string | null;
  preferred_shipper_name?: string | null;
}

const DRIVER_INPUT_MODE_SET = new Set<string>(DRIVER_INPUT_MODES);
const PLATE_SOURCE_SET = new Set<string>(['anpr', 'operator', 'directory']);

export function normalizeDriverInputMode(raw: unknown): DriverInputMode {
  if (typeof raw === 'string' && DRIVER_INPUT_MODE_SET.has(raw)) {
    return raw as DriverInputMode;
  }
  return 'all';
}

export function normalizePlateSource(raw: unknown): PlateSource | null {
  if (typeof raw === 'string' && PLATE_SOURCE_SET.has(raw)) {
    return raw as PlateSource;
  }
  return null;
}

export interface VehicleResolveContext {
  vehicles: VehicleCardLike[];
  drivers: Array<{ id?: string; name: string }>;
  vehicleDrivers: VehicleDriverLink[];
  completedTickets: Array<{
    vehicle_number: string;
    status: string;
    vehicle_brand?: string;
    driver_name?: string;
    cargo_name?: string;
    shipper_name?: string;
    tare_weight?: number | null;
    completed_at?: string | null;
    created_at: string;
  }>;
  taraDefault: number;
  driverInputMode: DriverInputMode;
}

export interface VehicleResolveResult {
  vehicle_brand: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
  tare?: TareAutofillResult | null;
  driver_candidates: string[];
  plate_source: PlateSource;
  matched_vehicle_id?: string | null;
}

function tripSortKey(ticket: { completed_at?: string | null; created_at: string }): number {
  const iso = ticket.completed_at || ticket.created_at;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Plate already normalized; compares via formatVehiclePlate for safety. */
export function findLastCompletedTrip(
  plate: string,
  tickets: VehicleResolveContext['completedTickets'],
): VehicleResolveContext['completedTickets'][number] | null {
  const normalizedPlate = formatVehiclePlate(plate);
  let best: VehicleResolveContext['completedTickets'][number] | null = null;
  let bestKey = -1;
  for (const ticket of tickets) {
    if (ticket.status !== 'completed') continue;
    if (formatVehiclePlate(ticket.vehicle_number) !== normalizedPlate) continue;
    const key = tripSortKey(ticket);
    if (key >= bestKey) {
      best = ticket;
      bestKey = key;
    }
  }
  return best;
}

function historyForVehicle(
  plate: string,
  vehicleDrivers: VehicleDriverLink[],
): VehicleDriverLink[] {
  const normalizedPlate = formatVehiclePlate(plate);
  return vehicleDrivers
    .filter((link) => formatVehiclePlate(link.vehicle_number) === normalizedPlate)
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.last_used_at);
      const tb = Date.parse(b.last_used_at);
      const byTime = (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      if (byTime !== 0) return byTime;
      return b.use_count - a.use_count;
    });
}

export function resolveDriverCandidates(
  plate: string,
  mode: DriverInputMode,
  vehicleDrivers: VehicleDriverLink[],
  allDriverNames: string[],
): string[] {
  if (mode === 'free') return [];
  if (mode === 'all') return allDriverNames;
  const history = historyForVehicle(plate, vehicleDrivers);
  if (history.length === 0) return allDriverNames;
  return history.map((link) => link.driver_name);
}

function pickText(...candidates: Array<string | null | undefined>): string {
  for (const value of candidates) {
    if (value != null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return '';
}

export function resolveVehicle(
  plate: string,
  context: VehicleResolveContext,
): VehicleResolveResult {
  const normalizedPlate = formatVehiclePlate(plate);
  const card =
    context.vehicles.find(
      (v) => formatVehiclePlate(v.vehicle_number ?? v.name ?? '') === normalizedPlate,
    ) ?? null;
  const last = findLastCompletedTrip(normalizedPlate, context.completedTickets);

  let vehicle_brand = pickText(card?.vehicle_brand, last?.vehicle_brand);
  let driver_name = pickText(card?.preferred_driver_name, last?.driver_name);
  let cargo_name = pickText(card?.preferred_cargo_name, last?.cargo_name);
  let shipper_name = pickText(card?.preferred_shipper_name, last?.shipper_name);

  const tare = resolveTareAutofill({
    defaultTareWeight: card?.default_tare_weight,
    lastCompletedTareWeight: last?.tare_weight,
    taraDefault: context.taraDefault,
  });

  const allDriverNames = context.drivers.map((d) => d.name).filter(Boolean);
  const history = historyForVehicle(normalizedPlate, context.vehicleDrivers);
  const driver_candidates = resolveDriverCandidates(
    normalizedPlate,
    context.driverInputMode,
    context.vehicleDrivers,
    allDriverNames,
  );

  // Auto-ФИО only from vehicle history (not fallback-all), when prefs/last left driver empty.
  if (context.driverInputMode === 'vehicle' && !driver_name) {
    if (history.length === 1) {
      driver_name = history[0].driver_name;
    }
  }

  return {
    vehicle_brand,
    driver_name,
    cargo_name,
    shipper_name,
    tare,
    driver_candidates,
    plate_source: card ? 'directory' : 'operator',
    matched_vehicle_id: card?.id ?? null,
  };
}
