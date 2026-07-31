import type { ArchiveTicketDetails, ArchiveWarning } from '@/lib/api';
import type { WeighingTicket } from '@/lib/storage';
import { printTicket } from './PrintAct';

function asText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

export function archiveTicketToWeighingTicket(
  ticket: ArchiveTicketDetails,
  archiveYear: number,
): WeighingTicket {
  return {
    id: String(ticket.id),
    ticket_number: typeof ticket.ticket_number === 'number' ? ticket.ticket_number : null,
    vehicle_number: String(ticket.vehicle_number ?? ''),
    vehicle_brand: String(ticket.vehicle_brand ?? ''),
    trailer_number: String(ticket.trailer_number ?? ''),
    driver_name: String(ticket.driver_name ?? ''),
    cargo_name: String(ticket.cargo_name ?? ''),
    shipper_name: String(ticket.shipper_name ?? ''),
    receiver_name: String(ticket.receiver_name ?? ''),
    carrier_name: String(ticket.carrier_name ?? ''),
    price: typeof ticket.price === 'number' ? ticket.price : 0,
    vat_rate: typeof ticket.vat_rate === 'number' ? ticket.vat_rate : 0,
    gross_weight: typeof ticket.gross_weight === 'number' ? ticket.gross_weight : null,
    tare_weight: typeof ticket.tare_weight === 'number' ? ticket.tare_weight : null,
    net_weight: typeof ticket.net_weight === 'number' ? ticket.net_weight : null,
    total_amount: typeof ticket.total_amount === 'number' ? ticket.total_amount : null,
    gross_source: (ticket.gross_source as WeighingTicket['gross_source']) || 'manual',
    tare_source: (ticket.tare_source as WeighingTicket['tare_source']) || 'manual',
    gross_raw: typeof ticket.gross_raw === 'string' ? ticket.gross_raw : null,
    tare_raw: typeof ticket.tare_raw === 'string' ? ticket.tare_raw : null,
    gross_datetime: typeof ticket.gross_datetime === 'string' ? ticket.gross_datetime : null,
    tare_datetime: typeof ticket.tare_datetime === 'string' ? ticket.tare_datetime : null,
    scale_device: String(ticket.scale_device ?? 'manual'),
    manual_weight_reason:
      typeof ticket.manual_weight_reason === 'string' ? ticket.manual_weight_reason : null,
    operator_id: typeof ticket.operator_id === 'string' ? ticket.operator_id : null,
    operator_name: String(ticket.operator_name ?? ''),
    status: (ticket.status as WeighingTicket['status']) || 'completed',
    reo_status: (ticket.reo_status as WeighingTicket['reo_status']) || 'pending',
    reo_sent_at: typeof ticket.reo_sent_at === 'string' ? ticket.reo_sent_at : null,
    auto_closed: Boolean(ticket.auto_closed),
    notes: String(ticket.notes ?? ''),
    created_at: String(ticket.created_at ?? ''),
    completed_at: typeof ticket.completed_at === 'string' ? ticket.completed_at : null,
    weighing_mode: (ticket.weighing_mode as WeighingTicket['weighing_mode']) || 'single',
    version: typeof ticket.version === 'number' ? ticket.version : 1,
    year: archiveYear,
  };
}

interface ArchiveTicketCardProps {
  archiveYear: number;
  ticket: ArchiveTicketDetails;
  warning?: ArchiveWarning | null;
  canEdit: boolean;
  onEdit?: () => void;
}

export function ArchiveTicketCard({
  archiveYear,
  ticket,
  warning,
  canEdit,
  onEdit,
}: ArchiveTicketCardProps) {
  const canPrint = ticket.status === 'completed';

  const handlePrint = () => {
    const printable = archiveTicketToWeighingTicket(ticket, archiveYear);
    printTicket(printable, undefined, { source: 'archive' });
  };

  return (
    <div className="mt-3 space-y-2 text-sm text-slate-700">
      <div>Год архива: {archiveYear}</div>
      <div>Номер талона: {asText(ticket.ticket_number)}</div>
      <div>Дата и время: {formatDateTime(ticket.created_at || ticket.gross_datetime)}</div>
      <div>Статус: {asText(ticket.status)}</div>
      <div>auto_closed: {ticket.auto_closed ? 'да' : 'нет'}</div>
      <div>РЭО: {asText(ticket.reo_status)}</div>
      <div>Госномер: {asText(ticket.vehicle_number)}</div>
      <div>Марка: {asText(ticket.vehicle_brand)}</div>
      <div>Водитель: {asText(ticket.driver_name)}</div>
      <div>Груз: {asText(ticket.cargo_name)}</div>
      <div>Брутто: {asText(ticket.gross_weight)}</div>
      <div>Тара: {asText(ticket.tare_weight)}</div>
      <div>Нетто: {asText(ticket.net_weight)}</div>

      {warning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
          {warning.message || 'Обнаружено расхождение календарного года тикета и имени архива'}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          onClick={handlePrint}
          disabled={!canPrint}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Печать
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            Редактировать
          </button>
        )}
      </div>
    </div>
  );
}
