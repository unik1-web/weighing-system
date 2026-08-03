import { describe, expect, it } from 'vitest';
import { waImportKey } from '../api';

describe('waImportKey', () => {
  it('builds a stable dedupe key including optional wa_id', () => {
    expect(
      waImportKey({
        wa_id: 'guid-1',
        datetimebrutto: '2026-07-28 10:00:00',
        datetimetara: '2026-07-28 11:00:00',
        vehicle_number: ' А123ВС56 ',
        vehicle_brand: '',
        trailer_number: '',
        driver_name: '',
        cargo_name: '',
        shipper_name: '',
        receiver_name: '',
        carrier_name: '',
        gross_weight: 25000,
        tare_weight: 10000,
        net_weight: 15000,
        operator_name: '',
      }),
    ).toBe('guid-1|2026-07-28 10:00:00|2026-07-28 11:00:00|А123ВС56');
  });

  it('uses 0 when wa_id is null or undefined', () => {
    expect(
      waImportKey({
        wa_id: null,
        datetimebrutto: '2026-07-28 10:00:00',
        datetimetara: '',
        vehicle_number: 'В456ОР77',
        vehicle_brand: '',
        trailer_number: '',
        driver_name: '',
        cargo_name: '',
        shipper_name: '',
        receiver_name: '',
        carrier_name: '',
        gross_weight: null,
        tare_weight: null,
        net_weight: null,
        operator_name: '',
      }),
    ).toBe('0|2026-07-28 10:00:00||В456ОР77');
  });
});
