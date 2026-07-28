export function normalizeImportDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ticketImportKey(ticket: {
  gross_datetime: string | null;
  tare_datetime: string | null;
  vehicle_number: string;
}): string {
  return `${normalizeImportDateTime(ticket.gross_datetime)}_${normalizeImportDateTime(ticket.tare_datetime)}_${ticket.vehicle_number.trim()}`;
}
