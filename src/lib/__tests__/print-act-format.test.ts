import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PrintAct } from '@/components/PrintAct';
import { DEFAULT_APP_SETTINGS, type WeighingTicket } from '../storage';

function makeTicket(): WeighingTicket {
  return {
    id: 't-print-1',
    ticket_number: 5,
    vehicle_number: 'А123АА56',
    vehicle_brand: 'Камаз',
    trailer_number: '',
    driver_name: 'Иванов И.И.',
    cargo_name: 'Грунт',
    shipper_name: 'Отправитель',
    receiver_name: 'Получатель',
    carrier_name: 'Перевозчик',
    price: 0,
    vat_rate: 20,
    gross_weight: 20000,
    tare_weight: 5000,
    net_weight: 15000,
    total_amount: 0,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: '2026-03-10T09:30:00',
    tare_datetime: '2026-03-10T09:35:00',
    scale_device: 'manual',
    operator_id: null,
    operator_name: 'Оператор',
    status: 'completed',
    reo_status: 'pending',
    reo_sent_at: null,
    auto_closed: false,
    notes: '',
    created_at: '2026-03-10T09:30:00',
    completed_at: '2026-03-10T09:35:00',
    weighing_mode: 'single',
    version: 1,
  };
}

describe('PrintAct format', () => {
  it('TC-UNIT-03: classic layout includes "№ N от ДД.ММ.ГГГГ"', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrintAct, {
        ticket: makeTicket(),
        settings: {
          ...DEFAULT_APP_SETTINGS,
          print_layout: 'act',
        },
      }),
    );
    expect(html).toContain('№ 5 от 10.03.2026');
  });

  it('TC-UNIT-03: receipt layout includes "№ N от ДД.ММ.ГГГГ"', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrintAct, {
        ticket: makeTicket(),
        settings: {
          ...DEFAULT_APP_SETTINGS,
          print_layout: 'receipt',
        },
      }),
    );
    expect(html).toContain('№ 5 от 10.03.2026');
  });
});
