/** Best-effort learning of vehicle prefs and driver history on ticket complete. */

import {
  DictionaryStorage,
  VehicleDriversStorage,
  type WeighingTicket,
} from './storage';
import { formatVehiclePlate } from './vehicle-plate';
import { formatPersonName, formatVehicleBrand } from './text-format';
import { logger } from './logger';

/**
 * Update vehicle_drivers + vehicles prefs after a ticket becomes completed.
 * Errors are logged; never throws (must not block complete).
 */
export function applyVehicleLearningOnComplete(ticket: WeighingTicket): void {
  try {
    if (ticket.status !== 'completed') return;

    const plate = formatVehiclePlate(ticket.vehicle_number);
    if (!plate) return;

    const driverName = ticket.driver_name ? formatPersonName(ticket.driver_name) : '';
    const at = ticket.completed_at ?? new Date().toISOString();

    if (driverName) {
      const drivers = DictionaryStorage.getTable('drivers');
      const matched = drivers.find((d) => formatPersonName(d.name) === driverName);
      VehicleDriversStorage.upsert({
        vehicle_number: plate,
        driver_name: driverName,
        last_used_at: at,
        driver_id: matched?.id ?? null,
      });
    }

    const vehicles = DictionaryStorage.getTable('vehicles');
    const existing = vehicles.find(
      (v) => formatVehiclePlate(v.vehicle_number ?? v.name) === plate,
    );

    const brand = ticket.vehicle_brand ? formatVehicleBrand(ticket.vehicle_brand) : '';
    const prefs = {
      preferred_driver_name: driverName || null,
      preferred_cargo_name: ticket.cargo_name?.trim() ? ticket.cargo_name.trim() : null,
      preferred_shipper_name: ticket.shipper_name?.trim() ? ticket.shipper_name.trim() : null,
      ...(brand ? { vehicle_brand: brand } : {}),
      ...(ticket.tare_weight != null ? { default_tare_weight: ticket.tare_weight } : {}),
    };

    if (existing) {
      DictionaryStorage.update('vehicles', existing.id, prefs);
    } else {
      DictionaryStorage.add('vehicles', {
        name: plate,
        notes: '',
        vehicle_number: plate,
        vehicle_brand: brand || undefined,
        preferred_driver_name: prefs.preferred_driver_name,
        preferred_cargo_name: prefs.preferred_cargo_name,
        preferred_shipper_name: prefs.preferred_shipper_name,
        default_tare_weight: ticket.tare_weight != null ? ticket.tare_weight : null,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('vehicle-learning', `Ошибка обучения prefs/vehicle_drivers: ${message}`, {
      ticket_id: ticket.id,
    });
  }
}
