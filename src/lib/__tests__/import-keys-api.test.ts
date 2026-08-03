import { describe, expect, it } from 'vitest';
import { metraImportKey, vescomImportKey } from '../api';

describe('import dedupe keys', () => {
  it('builds stable Vescom keys including optional id', () => {
    expect(
      vescomImportKey({
        vescom_id: 42,
        datetimebrutto: '2026-07-28 10:00:00',
        datetimetara: '2026-07-28 11:00:00',
        vehicle_number: ' А123ВС56 ',
        vehicle_brand: '',
        driver_name: '',
        cargo_name: '',
        shipper_name: '',
        receiver_name: '',
        carrier_name: '',
        gross_weight: 1,
        tare_weight: 1,
        net_weight: 0,
      }),
    ).toBe('42|2026-07-28 10:00:00|2026-07-28 11:00:00|А123ВС56');

    expect(
      vescomImportKey({
        vescom_id: null,
        datetimebrutto: '2026-07-28 10:00:00',
        datetimetara: '',
        vehicle_number: 'В456ОР77',
        vehicle_brand: '',
        driver_name: '',
        cargo_name: '',
        shipper_name: '',
        receiver_name: '',
        carrier_name: '',
        gross_weight: null,
        tare_weight: null,
        net_weight: null,
      }),
    ).toBe('0|2026-07-28 10:00:00||В456ОР77');
  });

  it('builds stable Metra keys from rec_no', () => {
    expect(
      metraImportKey({
        rec_no: 15,
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
        price: 0,
        gross_weight: null,
        tare_weight: null,
        net_weight: null,
        operator_name: '',
        invoice: '',
      }),
    ).toBe('15|2026-07-28 10:00:00|2026-07-28 11:00:00|А123ВС56');
  });
});
