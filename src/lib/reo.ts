import {
  DictionaryStorage,
  SettingsStorage,
  type AppSettings,
  type WeighingTicket,
} from './storage';
import { apiPost } from './api';
import { logger } from './logger';

/** Формат JSON по инструкции РЭО (весовой контроль). */
export interface ReoWeightControl {
  id: string;
  dateBefore: string;
  dateAfter: string;
  registrationNumber: string;
  garbageTruckType: string | null;
  garbageTruckBrand: string | null;
  garbageTruckModel: string | null;
  companyName: string | null;
  companyInn: string | null;
  companyKpp: string | null;
  weightBefore: string;
  weightAfter: string;
  weightDriver: string | null;
  coefficient: string;
  garbageWeight: string | null;
  garbageType: string | null;
  codeFKKO: string | null;
  nameFKKO: string | null;
}

export interface ReoExportPayload {
  objectId: string;
  accessKey: string;
  weightControls: ReoWeightControl[];
}

export interface ReoComplianceIssue {
  ticketNumber: number | null;
  level: 'error' | 'warning';
  message: string;
}

function findDictionaryName(table: 'receivers', name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return DictionaryStorage.getTable(table).find((entry) => entry.name.trim().toLowerCase() === normalized) ?? null;
}

function formatReoDateTime(iso: string | null, fallbackIso: string): string {
  const date = new Date(iso ?? fallbackIso);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absolute / 60));
  const offsetMins = pad(absolute % 60);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetMins}`;
}

function resolveCompanyFields(ticket: WeighingTicket, settings: AppSettings) {
  const receiver = findDictionaryName('receivers', ticket.receiver_name);
  const companyInn = (receiver?.inn || settings.org_inn || '').trim();
  const companyKpp = companyInn.length === 12 ? null : (settings.org_kpp.trim() || null);

  return {
    companyName: (ticket.receiver_name || settings.org_name || '').trim() || null,
    companyInn: companyInn || null,
    companyKpp,
  };
}

export function buildWeightControl(ticket: WeighingTicket): ReoWeightControl {
  const settings = SettingsStorage.getAppSettings();
  const company = resolveCompanyFields(ticket, settings);
  const fallbackDate = ticket.completed_at ?? ticket.created_at;

  return {
    id: crypto.randomUUID(),
    dateBefore: formatReoDateTime(ticket.gross_datetime, fallbackDate),
    dateAfter: formatReoDateTime(ticket.tare_datetime ?? ticket.gross_datetime, fallbackDate),
    registrationNumber: ticket.vehicle_number.trim(),
    garbageTruckType: null,
    garbageTruckBrand: ticket.vehicle_brand.trim() || null,
    garbageTruckModel: null,
    companyName: company.companyName,
    companyInn: company.companyInn,
    companyKpp: company.companyKpp,
    weightBefore: String(Math.round(ticket.gross_weight ?? 0)),
    weightAfter: String(Math.round(ticket.tare_weight ?? 0)),
    weightDriver: null,
    coefficient: '1',
    garbageWeight: ticket.net_weight != null ? String(Math.round(ticket.net_weight)) : null,
    garbageType: ticket.cargo_name.trim() || null,
    codeFKKO: null,
    nameFKKO: null,
  };
}

export function buildReoPayload(tickets: WeighingTicket[]): ReoExportPayload {
  const settings = SettingsStorage.getAppSettings();
  return {
    objectId: settings.reo_object_id.trim(),
    accessKey: settings.reo_access_key.trim(),
    weightControls: tickets.map(buildWeightControl),
  };
}

/** JSON-файл для ручной отправки: objectId и accessKey пустые, как в образце data_YYYY-MM-DD.json */
export function buildReoFilePayload(tickets: WeighingTicket[]): ReoExportPayload {
  return {
    objectId: '',
    accessKey: '',
    weightControls: tickets.map(buildWeightControl),
  };
}

export function getReoComplianceIssues(
  tickets: WeighingTicket[],
  options?: { checkCredentials?: boolean },
): ReoComplianceIssue[] {
  const settings = SettingsStorage.getAppSettings();
  const issues: ReoComplianceIssue[] = [];
  const checkCredentials = options?.checkCredentials ?? true;

  if (checkCredentials && !settings.reo_object_id.trim()) {
    issues.push({ ticketNumber: null, level: 'error', message: 'Не указан objectId (идентификатор объекта) в настройках РЭО' });
  }
  if (checkCredentials && !settings.reo_access_key.trim()) {
    issues.push({ ticketNumber: null, level: 'error', message: 'Не указан accessKey (ключ доступа) в настройках РЭО' });
  }

  tickets.forEach((ticket) => {
    const no = ticket.ticket_number;

    if (!ticket.vehicle_number.trim()) {
      issues.push({ ticketNumber: no, level: 'error', message: 'Не указан registrationNumber (госномер ТС)' });
    }
    if (!ticket.gross_datetime) {
      issues.push({ ticketNumber: no, level: 'error', message: 'Не указана dateBefore (дата/время брутто)' });
    }
    if (ticket.gross_weight == null) {
      issues.push({ ticketNumber: no, level: 'error', message: 'Не указан weightBefore (вес брутто, кг)' });
    }
    if (ticket.tare_weight == null) {
      issues.push({ ticketNumber: no, level: 'error', message: 'Не указан weightAfter (вес тары, кг)' });
    }
    if (!ticket.cargo_name.trim()) {
      issues.push({ ticketNumber: no, level: 'warning', message: 'Не указан garbageType (вид груза)' });
    }

    const company = resolveCompanyFields(ticket, settings);
    if (!company.companyInn) {
      issues.push({ ticketNumber: no, level: 'warning', message: 'Не указан companyInn (ИНН получателя или организации)' });
    }
  });

  return issues;
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
  if (!settings.reo_object_id.trim()) {
    return 'Не указан идентификатор объекта (objectId) РЭО';
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
  if (!ticket.vehicle_number.trim()) {
    return 'Не указан госномер ТС';
  }
  if (!ticket.gross_datetime) {
    return 'Не указана дата взвешивания брутто';
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
  if (!settings.reo_object_id.trim()) {
    return {
      eligibleTickets: [],
      disabledReason: 'Укажите идентификатор объекта (objectId) в настройках РЭО',
    };
  }

  const eligibleTickets = tickets.filter((ticket) => {
    if (ticket.status !== 'completed') return false;
    if (ticket.reo_status === 'sent') return false;
    if (ticket.gross_weight == null || ticket.tare_weight == null || ticket.net_weight == null) {
      return false;
    }
    if (!ticket.vehicle_number.trim() || !ticket.gross_datetime) return false;
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

export function downloadReoJsonFile(tickets: WeighingTicket[], filename?: string): ReoExportPayload {
  const payload = buildReoFilePayload(tickets);
  const json = JSON.stringify(payload, null, 4);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `data_${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  logger.info('reo', `Сформирован JSON для РЭО: ${tickets.length} записей`);
  return payload;
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
  const payload = buildReoPayload(tickets);

  await apiPost<{ success: true; sent: number }>('/api/reo/send', {
    object_url: settings.reo_object_url.trim(),
    payload,
  });

  logger.info('reo', `Успешная отправка в РЭО: ${tickets.length} записей`);
  return tickets.length;
}
