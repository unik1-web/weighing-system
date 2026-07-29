import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, DictionaryEntry, WeighingTicket } from '../storage';
import { DEFAULT_APP_SETTINGS } from '../storage';

const settingsState: { current: AppSettings } = {
  current: { ...DEFAULT_APP_SETTINGS },
};

const receiversState: { current: DictionaryEntry[] } = {
  current: [],
};

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>();
  return {
    ...actual,
    SettingsStorage: {
      ...actual.SettingsStorage,
      getAppSettings: () => settingsState.current,
    },
    DictionaryStorage: {
      ...actual.DictionaryStorage,
      getTable: (table: string) => (table === 'receivers' ? receiversState.current : []),
    },
  };
});

import {
  buildReoFilePayload,
  buildReoPayload,
  buildWeightControl,
  getReoComplianceIssues,
  getReoEligibleTickets,
  getReoSendState,
  isReoCargoEligible,
  validateReoSettings,
  validateReoTicket,
} from '../reo';

function makeTicket(overrides: Partial<WeighingTicket> = {}): WeighingTicket {
  return {
    id: 't1',
    ticket_number: 42,
    vehicle_number: 'А123ВС56',
    vehicle_brand: 'Камаз',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'ТКО',
    shipper_name: '',
    receiver_name: 'ООО Полигон',
    carrier_name: '',
    price: 0,
    vat_rate: 0,
    gross_weight: 12500.4,
    tare_weight: 8200.6,
    net_weight: 4299.8,
    total_amount: null,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-07-28T10:05:09.000Z',
    tare_datetime: '2026-07-28T11:00:00.000Z',
    scale_device: '',
    operator_id: null,
    operator_name: 'admin',
    status: 'completed',
    reo_status: 'pending',
    reo_sent_at: null,
    notes: '',
    created_at: '2026-07-28T09:00:00.000Z',
    completed_at: '2026-07-28T11:05:00.000Z',
    ...overrides,
  };
}

function enableReo(overrides: Partial<AppSettings> = {}) {
  settingsState.current = {
    ...DEFAULT_APP_SETTINGS,
    org_name: 'Полигон отходов',
    org_inn: '1234567890',
    org_kpp: '123456789',
    reo_enabled: true,
    reo_access_key: 'access-key',
    reo_object_id: 'object-1',
    reo_object_url: 'https://reo.example/api',
    reo_cargo_names: ['ТКО', 'строительные отходы'],
    ...overrides,
  };
}

describe('REO settings and eligibility', () => {
  beforeEach(() => {
    enableReo();
    receiversState.current = [];
  });

  it('validateReoSettings requires enabled integration and credentials', () => {
    expect(validateReoSettings()).toBeNull();

    settingsState.current = { ...settingsState.current, reo_enabled: false };
    expect(validateReoSettings()).toMatch(/отключена/);

    enableReo({ reo_object_url: '  ' });
    expect(validateReoSettings()).toMatch(/URL/);

    enableReo({ reo_access_key: '' });
    expect(validateReoSettings()).toMatch(/ключ доступа/);

    enableReo({ reo_object_id: ' ' });
    expect(validateReoSettings()).toMatch(/objectId|идентификатор/i);

    enableReo({ reo_cargo_names: [] });
    expect(validateReoSettings()).toMatch(/виды груза/);
  });

  it('isReoCargoEligible matches cargo names case-insensitively', () => {
    expect(isReoCargoEligible(makeTicket({ cargo_name: 'тко' }))).toBe(true);
    expect(isReoCargoEligible(makeTicket({ cargo_name: ' Строительные Отходы ' }))).toBe(true);
    expect(isReoCargoEligible(makeTicket({ cargo_name: 'Песок' }))).toBe(false);

    settingsState.current = { ...settingsState.current, reo_cargo_names: [] };
    expect(isReoCargoEligible(makeTicket())).toBe(false);
  });

  it('validateReoTicket rejects incomplete, already-sent, or ineligible tickets', () => {
    expect(validateReoTicket(makeTicket())).toBeNull();
    expect(validateReoTicket(makeTicket({ status: 'open' }))).toMatch(/завершённые/);
    expect(validateReoTicket(makeTicket({ reo_status: 'sent' }))).toMatch(/уже отправлена/);
    expect(validateReoTicket(makeTicket({ net_weight: null }))).toMatch(/веса/);
    expect(validateReoTicket(makeTicket({ vehicle_number: '  ' }))).toMatch(/госномер/);
    expect(validateReoTicket(makeTicket({ gross_datetime: null }))).toMatch(/брутто/);
    expect(validateReoTicket(makeTicket({ cargo_name: 'Песок' }))).toMatch(/не входит/);
  });

  it('getReoEligibleTickets and getReoSendState filter sendable tickets', () => {
    const tickets = [
      makeTicket({ id: 'ok', ticket_number: 1 }),
      makeTicket({ id: 'open', ticket_number: 2, status: 'open' }),
      makeTicket({ id: 'sent', ticket_number: 3, reo_status: 'sent' }),
      makeTicket({ id: 'cargo', ticket_number: 4, cargo_name: 'Песок' }),
    ];

    expect(getReoEligibleTickets(tickets).map((t) => t.id)).toEqual(['ok']);

    const state = getReoSendState(tickets);
    expect(state.disabledReason).toBeNull();
    expect(state.eligibleTickets.map((t) => t.id)).toEqual(['ok']);

    expect(getReoSendState([]).disabledReason).toMatch(/Нет завершённых/);

    settingsState.current = { ...settingsState.current, reo_enabled: false };
    expect(getReoSendState(tickets).disabledReason).toMatch(/Включите интеграцию/);
  });
});

describe('REO payload and compliance', () => {
  beforeEach(() => {
    enableReo();
    receiversState.current = [];
  });

  it('buildWeightControl rounds weights and resolves company fields', () => {
    const control = buildWeightControl(makeTicket());

    expect(control.registrationNumber).toBe('А123ВС56');
    expect(control.garbageTruckBrand).toBe('Камаз');
    expect(control.weightBefore).toBe('12500');
    expect(control.weightAfter).toBe('8201');
    expect(control.garbageWeight).toBe('4300');
    expect(control.garbageType).toBe('ТКО');
    expect(control.coefficient).toBe('1');
    expect(control.companyName).toBe('ООО Полигон');
    expect(control.companyInn).toBe('1234567890');
    expect(control.companyKpp).toBe('123456789');
    expect(control.dateBefore).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(control.dateAfter).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('uses receiver dictionary INN and clears KPP for 12-digit personal INN', () => {
    receiversState.current = [
      {
        id: 'r1',
        name: 'ООО Полигон',
        inn: '123456789012',
        notes: '',
        created_at: '2026-01-01',
      },
    ];

    const control = buildWeightControl(makeTicket());
    expect(control.companyInn).toBe('123456789012');
    expect(control.companyKpp).toBeNull();
  });

  it('buildReoPayload uses settings credentials; file payload clears them', () => {
    const tickets = [makeTicket()];
    const apiPayload = buildReoPayload(tickets);
    expect(apiPayload.objectId).toBe('object-1');
    expect(apiPayload.accessKey).toBe('access-key');
    expect(apiPayload.weightControls).toHaveLength(1);

    const filePayload = buildReoFilePayload(tickets);
    expect(filePayload.objectId).toBe('');
    expect(filePayload.accessKey).toBe('');
    expect(filePayload.weightControls).toHaveLength(1);
  });

  it('getReoComplianceIssues reports credential and ticket field problems', () => {
    settingsState.current = {
      ...settingsState.current,
      reo_object_id: '',
      reo_access_key: '',
      org_inn: '',
    };

    const issues = getReoComplianceIssues([
      makeTicket({
        vehicle_number: '',
        gross_datetime: null,
        gross_weight: null,
        tare_weight: null,
        cargo_name: '',
        receiver_name: '',
      }),
    ]);

    const messages = issues.map((issue) => issue.message);
    expect(messages.some((m) => m.includes('objectId'))).toBe(true);
    expect(messages.some((m) => m.includes('accessKey'))).toBe(true);
    expect(messages.some((m) => m.includes('registrationNumber'))).toBe(true);
    expect(messages.some((m) => m.includes('dateBefore'))).toBe(true);
    expect(messages.some((m) => m.includes('weightBefore'))).toBe(true);
    expect(messages.some((m) => m.includes('weightAfter'))).toBe(true);
    expect(messages.some((m) => m.includes('garbageType'))).toBe(true);
    expect(messages.some((m) => m.includes('companyInn'))).toBe(true);

    const withoutCreds = getReoComplianceIssues([makeTicket()], { checkCredentials: false });
    expect(withoutCreds.every((issue) => issue.ticketNumber !== null || issue.message.includes('companyInn'))).toBe(
      true,
    );
    expect(withoutCreds.every((issue) => !issue.message.includes('objectId'))).toBe(true);
  });
});
