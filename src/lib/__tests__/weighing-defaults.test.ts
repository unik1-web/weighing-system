import { describe, expect, it } from 'vitest';
import {
  defaultsForCargoChange,
  defaultsForVehicleChange,
  importTicketStatus,
} from '../weighing-defaults';

describe('defaultsForVehicleChange', () => {
  it('returns null when the plate did not change', () => {
    expect(
      defaultsForVehicleChange('А123ВС56', 'А123ВС56', {
        vehicle_brand: 'КамАЗ',
        default_tare_weight: 8000,
      }),
    ).toBeNull();
  });

  it('replaces brand and tare when switching to another matched vehicle', () => {
    expect(
      defaultsForVehicleChange('А111АА56', 'В222ВВ56', {
        vehicle_brand: 'МАЗ',
        default_tare_weight: 9200,
      }),
    ).toEqual({ brand: 'МАЗ', tare: 9200 });
  });

  it('returns null when the new plate has no dictionary match', () => {
    expect(defaultsForVehicleChange('А111АА56', 'Х999ХХ56', undefined)).toBeNull();
  });
});

describe('defaultsForCargoChange', () => {
  it('replaces price when switching cargos', () => {
    expect(
      defaultsForCargoChange('Песок', 'Щебень', { default_price: 450 }),
    ).toEqual({ price: 450 });
  });

  it('keeps the previous price when cargo name is unchanged', () => {
    expect(
      defaultsForCargoChange('Песок', 'Песок', { default_price: 300 }),
    ).toBeNull();
  });
});

describe('importTicketStatus', () => {
  it('marks gross-only rows as open', () => {
    expect(importTicketStatus(null)).toBe('open');
    expect(importTicketStatus(undefined)).toBe('open');
  });

  it('marks rows with tare as completed', () => {
    expect(importTicketStatus(0)).toBe('completed');
    expect(importTicketStatus(7500)).toBe('completed');
  });
});
