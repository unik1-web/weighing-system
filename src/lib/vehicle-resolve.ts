/**
 * Pure helpers: resolve trip fields by confirmed plate, driver matrix, datalist options.
 * No I/O / React. Autofill tare stays outside (resolveTareAutofill).
 */

import { normalizeVehicleKey } from './vehicle-plate';
import type {
  DictionaryEntry,
  DriverInputMode,
  VehicleDriverRecord,
  WeighingTicket,
} from './storage';

export type PlateSourceValue = 'anpr' | 'operator' | 'directory';

export interface TripFieldsCurrent {
  vehicle_brand: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
}

export interface TripFieldsPatch {
  vehicle_brand?: string;
  driver_name?: string;
  cargo_name?: string;
  shipper_name?: string;
}

function isEmptyText(value: string | null | undefined): boolean {
  return !(value ?? '').trim();
}

function ticketTimeMs(ticket: WeighingTicket): number {
  const raw = ticket.completed_at || ticket.created_at;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Find vehicle card by normalizeVehicleKey(vehicle_number|name). */
export function findVehicleByKey(
  vehicles: DictionaryEntry[],
  key: string,
): DictionaryEntry | undefined {
  if (!key) return undefined;
  return vehicles.find((vehicle) => {
    const raw = vehicle.vehicle_number ?? vehicle.name ?? '';
    return normalizeVehicleKey(raw) === key;
  });
}

/** Last completed ticket for the plate key (max completed_at || created_at). */
export function findLastCompletedTicket(
  tickets: WeighingTicket[],
  key: string,
): WeighingTicket | undefined {
  if (!key) return undefined;
  let best: WeighingTicket | undefined;
  let bestMs = -Infinity;
  for (const ticket of tickets) {
    if (ticket.status !== 'completed') continue;
    if (normalizeVehicleKey(ticket.vehicle_number) !== key) continue;
    const ms = ticketTimeMs(ticket);
    if (!best || ms > bestMs) {
      best = ticket;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Driver autofill matrix:
 * - history length 1 → that name
 * - 0 → preferred → last completed driver → empty
 * - >1 → empty (no fallthrough)
 */
export function resolveDriverAutofill(args: {
  history: VehicleDriverRecord[];
  preferred?: string | null;
  lastTicket?: WeighingTicket | null;
}): string {
  if (args.history.length === 1) {
    return (args.history[0].driver_name ?? '').trim();
  }
  if (args.history.length > 1) {
    return '';
  }
  const preferred = (args.preferred ?? '').trim();
  if (preferred) return preferred;
  return (args.lastTicket?.driver_name ?? '').trim();
}

/**
 * Patch only empty trim text fields: brand, driver, cargo, shipper.
 * Does not include tare / carrier / receiver.
 */
export function resolveTripFields(input: {
  key: string;
  vehicles: DictionaryEntry[];
  tickets: WeighingTicket[];
  driversHistory: VehicleDriverRecord[];
  current: TripFieldsCurrent;
}): TripFieldsPatch {
  const patch: TripFieldsPatch = {};
  if (!input.key) return patch;

  const vehicle = findVehicleByKey(input.vehicles, input.key);
  const lastTicket = findLastCompletedTicket(input.tickets, input.key);

  if (isEmptyText(input.current.vehicle_brand)) {
    const brand = (vehicle?.vehicle_brand ?? lastTicket?.vehicle_brand ?? '').trim();
    if (brand) patch.vehicle_brand = brand;
  }

  if (isEmptyText(input.current.driver_name)) {
    const driver = resolveDriverAutofill({
      history: input.driversHistory,
      preferred: vehicle?.preferred_driver_name,
      lastTicket,
    });
    if (driver) patch.driver_name = driver;
  }

  if (isEmptyText(input.current.cargo_name)) {
    const cargo = (vehicle?.preferred_cargo_name ?? lastTicket?.cargo_name ?? '').trim();
    if (cargo) patch.cargo_name = cargo;
  }

  if (isEmptyText(input.current.shipper_name)) {
    const shipper = (vehicle?.preferred_shipper_name ?? lastTicket?.shipper_name ?? '').trim();
    if (shipper) patch.shipper_name = shipper;
  }

  return patch;
}

function sortDriverHistory(history: VehicleDriverRecord[]): VehicleDriverRecord[] {
  return [...history].sort((a, b) => {
    const ta = Date.parse(a.last_used_at) || 0;
    const tb = Date.parse(b.last_used_at) || 0;
    if (tb !== ta) return tb - ta;
    return (b.use_count ?? 0) - (a.use_count ?? 0);
  });
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const dedupe = trimmed.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(trimmed);
  }
  return out;
}

/**
 * Driver datalist options by driver_input_mode.
 * - vehicle: history only (0 → [])
 * - all: history first, then full directory without duplicates
 * - free: []
 */
export function driverDatalistOptions(args: {
  mode: DriverInputMode;
  history: VehicleDriverRecord[];
  allDrivers: Array<{ name: string }>;
}): string[] {
  if (args.mode === 'free') return [];

  const historyNames = sortDriverHistory(args.history).map((row) => row.driver_name);

  if (args.mode === 'vehicle') {
    return uniqueNames(historyNames);
  }

  const directoryNames = args.allDrivers.map((d) => d.name ?? '');
  return uniqueNames([...historyNames, ...directoryNames]);
}

/** Match plate key against vehicle directory → directory, else operator. Never anpr. */
export function resolvePlateSource(
  vehicleKey: string,
  vehicles: DictionaryEntry[],
): Exclude<PlateSourceValue, 'anpr'> {
  if (!vehicleKey) return 'operator';
  return findVehicleByKey(vehicles, vehicleKey) ? 'directory' : 'operator';
}
