/** Helpers for applying dictionary defaults when the operator changes a selection. */

export interface VehicleDefaultSource {
  vehicle_brand?: string;
  default_tare_weight?: number | null;
}

export interface CargoDefaultSource {
  default_price?: number | null;
}

/**
 * When the vehicle plate changes to a different dictionary match, return the
 * brand/tare that should replace stale values from the previous vehicle.
 * Returns null when the plate did not change or no dictionary row matched.
 */
export function defaultsForVehicleChange(
  previousPlate: string,
  nextPlate: string,
  vehicle: VehicleDefaultSource | undefined,
): { brand?: string; tare?: number } | null {
  if (!nextPlate || previousPlate === nextPlate || !vehicle) return null;

  const result: { brand?: string; tare?: number } = {};
  if (vehicle.vehicle_brand) {
    result.brand = vehicle.vehicle_brand;
  }
  if (vehicle.default_tare_weight != null) {
    result.tare = vehicle.default_tare_weight;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * When the cargo name changes to a different dictionary match, return the
 * default price that should replace a stale price from the previous cargo.
 */
export function defaultsForCargoChange(
  previousCargo: string,
  nextCargo: string,
  cargo: CargoDefaultSource | undefined,
): { price?: number } | null {
  if (!nextCargo || previousCargo === nextCargo || !cargo) return null;
  if (cargo.default_price == null) return null;
  return { price: cargo.default_price };
}

/**
 * Gross-only external rows must stay open; only rows with tare are completed.
 */
export function importTicketStatus(tareWeight: number | null | undefined): 'open' | 'completed' {
  return tareWeight != null ? 'completed' : 'open';
}
