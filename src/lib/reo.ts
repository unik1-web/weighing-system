import { SettingsStorage, type WeighingTicket } from './storage';
import { apiPost } from './api';
import { logger } from './logger';

interface ReoWeightControl {
  id: string;
  dateBefore: string;
  dateAfter: string;
  registrationNumber: string;
  garbageTruckType: null;
  garbageTruckBrand: string;
  garbageTruckModel: null;
  companyName: string;
  companyInn: string;
  companyKpp: string;
  weightBefore: string;
  weightAfter: string;
  weightDriver: null;
  coefficient: string;
  garbageWeight: string;
  garbageType: string;
  codeFKKO: null;
  nameFKKO: null;
}

function formatReoDateTime(iso: string | null, fallbackIso: string): string {
  const date = new Date(iso ?? fallbackIso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildWeightControl(ticket: WeighingTicket): ReoWeightControl {
  const settings = SettingsStorage.getAppSettings();

  return {
    id: crypto.randomUUID(),
    dateBefore: formatReoDateTime(ticket.gross_datetime, ticket.completed_at ?? ticket.created_at),
    dateAfter: formatReoDateTime(ticket.tare_datetime, ticket.completed_at ?? ticket.created_at),
    registrationNumber: ticket.vehicle_number,
    garbageTruckType: null,
    garbageTruckBrand: ticket.vehicle_brand || '',
    garbageTruckModel: null,
    companyName: ticket.receiver_name || settings.org_name,
    companyInn: settings.org_inn,
    companyKpp: settings.org_kpp,
    weightBefore: String(ticket.gross_weight),
    weightAfter: String(ticket.tare_weight),
    weightDriver: null,
    coefficient: '1',
    garbageWeight: String(ticket.net_weight),
    garbageType: ticket.cargo_name,
    codeFKKO: null,
    nameFKKO: null,
  };
}

function normalizeCargoName(name: string): string {
  return name.trim().toLowerCase();
}

export function isReoCargoEligible(ticket: WeighingTicket): boolean {
  const settings = SettingsStorage.getAppSettings();
  if (settings.reo_cargo_names.length === 0) {
    return false;
  }

  const cargo = normalizeCargoName(ticket.cargo_name);
  return settings.reo_cargo_names.some((name) => normalizeCargoName(name) === cargo);
}

export function validateReoSettings(): string | null {
  const settings = SettingsStorage.getAppSettings();

  if (!settings.reo_enabled) {
    return 'Интеграция с РЭО отключена в настройках';
  }
  if (!settings.reo_object_url.trim()) {
    return 'Не указан URL сервиса РЭО';
  }
  if (!settings.reo_access_key.trim()) {
    return 'Не указан ключ доступа РЭО';
  }
  if (settings.reo_cargo_names.length === 0) {
    return 'Не выбраны виды груза для отправки в РЭО';
  }

  return null;
}

export function validateReoTicket(ticket: WeighingTicket): string | null {
  const settingsError = validateReoSettings();
  if (settingsError) {
    return settingsError;
  }
  if (ticket.status !== 'completed') {
    return 'Можно отправлять только завершённые записи';
  }
  if (ticket.reo_status === 'sent') {
    return 'Запись уже отправлена в РЭО';
  }
  if (ticket.gross_weight == null || ticket.tare_weight == null || ticket.net_weight == null) {
    return 'Не заполнены веса брутто, тара или нетто';
  }
  if (!isReoCargoEligible(ticket)) {
    return 'Вид груза не входит в список для отправки в РЭО';
  }

  return null;
}

export function getReoEligibleTickets(tickets: WeighingTicket[]): WeighingTicket[] {
  if (validateReoSettings()) {
    return [];
  }
  return tickets.filter((ticket) => validateReoTicket(ticket) === null);
}

export interface ReoSendState {
  eligibleTickets: WeighingTicket[];
  disabledReason: string | null;
}

export function getReoSendState(tickets: WeighingTicket[]): ReoSendState {
  const settings = SettingsStorage.getAppSettings();

  if (!settings.reo_enabled) {
    return {
      eligibleTickets: [],
      disabledReason: 'Включите интеграцию с РЭО в настройках и сохраните их',
    };
  }
  if (settings.reo_cargo_names.length === 0) {
    return {
      eligibleTickets: [],
      disabledReason: 'Выберите виды груза для отправки в настройках РЭО и сохраните',
    };
  }
  if (!settings.reo_object_url.trim()) {
    return {
      eligibleTickets: [],
      disabledReason: 'Укажите URL сервиса РЭО в настройках',
    };
  }
  if (!settings.reo_access_key.trim()) {
    return {
      eligibleTickets: [],
      disabledReason: 'Укажите ключ доступа РЭО в настройках',
    };
  }

  const eligibleTickets = tickets.filter((ticket) => {
    if (ticket.status !== 'completed') return false;
    if (ticket.reo_status === 'sent') return false;
    if (ticket.gross_weight == null || ticket.tare_weight == null || ticket.net_weight == null) {
      return false;
    }
    return isReoCargoEligible(ticket);
  });

  if (eligibleTickets.length === 0) {
    return {
      eligibleTickets: [],
      disabledReason: 'Нет завершённых неотправленных записей с выбранным видом груза',
    };
  }

  return { eligibleTickets, disabledReason: null };
}

export async function sendTicketsToReo(tickets: WeighingTicket[]): Promise<number> {
  if (tickets.length === 0) {
    throw new Error('Нет записей для отправки в РЭО');
  }

  const invalidTicket = tickets.find((ticket) => validateReoTicket(ticket));
  if (invalidTicket) {
    const ticketNo = invalidTicket.ticket_number ?? '—';
    throw new Error(`Запись №${ticketNo}: ${validateReoTicket(invalidTicket)}`);
  }

  const settings = SettingsStorage.getAppSettings();
  const payload = {
    ObjectId: settings.reo_object_id.trim(),
    AccessKey: settings.reo_access_key.trim(),
    WeightControls: tickets.map(buildWeightControl),
  };

  await apiPost<{ success: true; sent: number }>('/api/reo/send', {
    object_url: settings.reo_object_url.trim(),
    payload,
  });

  logger.info('reo', `Успешная отправка в РЭО: ${tickets.length} записей`);
  return tickets.length;
}
