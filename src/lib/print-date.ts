import type { WeighingTicket } from './storage';

/** Weighing date for print titles: completed_at ?? created_at. */
export function ticketPrintDate(ticket: Pick<WeighingTicket, 'completed_at' | 'created_at'>): string | null {
  return ticket.completed_at || ticket.created_at || null;
}

/** Format ISO timestamp as ДД.ММ.ГГГГ (ru-RU date only). */
export function formatPrintDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Print document title / header: «Талон № N от ДД.ММ.ГГГГ» or «Акт взвешивания № N от ДД.ММ.ГГГГ».
 */
export function formatTicketPrintTitle(
  ticket: Pick<WeighingTicket, 'ticket_number' | 'completed_at' | 'created_at'>,
  kind: 'receipt' | 'act' = 'act',
): string {
  const number = ticket.ticket_number ?? '—';
  const date = formatPrintDate(ticketPrintDate(ticket));
  const prefix = kind === 'receipt' ? 'Талон' : 'Акт взвешивания';
  return `${prefix} № ${number} от ${date}`;
}
