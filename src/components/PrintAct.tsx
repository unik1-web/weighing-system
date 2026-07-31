import type { WeighingTicket } from '@/lib/storage';
import { SettingsStorage, type AppSettings } from '@/lib/storage';

interface Props {
  ticket: WeighingTicket;
  settings?: AppSettings;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(ts: string | null) {
  if (!ts) return '——';
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDateFull(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtTimeFull(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTicketNumberWithDate(ticket: WeighingTicket): string {
  const number = ticket.ticket_number ?? '—';
  const date = fmtDateFull(ticket.created_at);
  return `№ ${number} от ${date}`;
}

function fmtTons(kg: number | null) {
  if (kg == null) return '——';
  return (kg / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtTonsShort(kg: number | null) {
  if (kg == null) return '—';
  return (kg / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function computeVat(amount: number | null, vatRate: number): number {
  if (!amount || !vatRate) return 0;
  return amount * vatRate / (100 + vatRate);
}

function renderActClassic(t: WeighingTicket, settings: AppSettings): string {
  const orgName = settings.org_name;
  const vatAmount = computeVat(t.price || 0, t.vat_rate || 0);
  const totalVat = computeVat(t.total_amount, t.vat_rate || 0);
  const receiverLabel = t.receiver_name || orgName || '—';

  return `
<div style="font-family:Times New Roman,serif;font-size:10.5px;box-sizing:border-box;color:#000;width:100%;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.2mm;border-bottom:1px solid #000;padding-bottom:0.8mm;gap:3mm;">
    <div style="font-size:12px;font-weight:bold;white-space:nowrap;min-width:32%">${esc(receiverLabel)}</div>
      <div style="font-size:12px;font-weight:bold;text-align:center;flex:1">Акт взвешивания ${formatTicketNumberWithDate(t)}</div>
    <div style="min-width:18mm;text-align:right;font-size:10px;white-space:nowrap;">${t.created_at ? fmt(t.created_at) : '——'}</div>
  </div>

  <div style="display:flex;gap:2mm;align-items:stretch;">
    <div style="flex:1 1 57%;padding-right:2mm;border-right:1px solid #555;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr><td style="padding:0 2mm 0.8mm 0;white-space:nowrap;color:#444;">Номер ТС:</td><td style="padding:0 0 0.8mm 0;font-weight:bold;">${esc(t.vehicle_number || '—')}</td></tr>
          <tr><td style="padding:0 2mm 0.8mm 0;white-space:nowrap;color:#444;">Марка ТС:</td><td style="padding:0 0 0.8mm 0;font-weight:bold;">${esc(t.vehicle_brand || '—')}</td></tr>
          <tr><td style="padding:0 2mm 0.8mm 0;white-space:nowrap;color:#444;">Прицеп:</td><td style="padding:0 0 0.8mm 0;font-weight:bold;">${esc(t.trailer_number || '—')}</td></tr>
          <tr><td style="padding:0 2mm 0 0;white-space:nowrap;color:#444;">Водитель:</td><td style="padding:0;font-weight:bold;">${esc(t.driver_name || '—')}</td></tr>
        </tbody>
      </table>
    </div>

    <div style="flex:1 1 43%;padding-left:2mm;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr>
            <td style="padding:0 2mm 0.8mm 0;white-space:nowrap;">Брутто, т</td>
            <td style="padding:0 2mm 0.8mm 0;font-weight:bold;text-align:right;">${fmtTons(t.gross_weight)}</td>
            <td style="padding:0 0 0.8mm 0;color:#555;font-size:9px;text-align:right;white-space:nowrap;">${t.gross_datetime ? fmt(t.gross_datetime) : fmt(t.created_at)}</td>
          </tr>
          <tr>
            <td style="padding:0 2mm 0.8mm 0;white-space:nowrap;">Тара, т</td>
            <td style="padding:0 2mm 0.8mm 0;font-weight:bold;text-align:right;">${fmtTons(t.tare_weight)}</td>
            <td style="padding:0 0 0.8mm 0;color:#555;font-size:9px;text-align:right;white-space:nowrap;">${t.tare_datetime ? fmt(t.tare_datetime) : (t.tare_weight != null ? fmt(t.completed_at) : '——')}</td>
          </tr>
          <tr>
            <td style="padding:0 2mm 0 0;white-space:nowrap;font-weight:bold;">Нетто, т</td>
            <td style="padding:0 2mm 0 0;font-weight:bold;font-size:12px;text-align:right;border-top:1px solid #000;">${fmtTons(t.net_weight)}</td>
            <td style="padding:0;"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div style="display:flex;gap:2mm;margin-top:1mm;border-top:1px solid #555;padding-top:1mm;align-items:flex-start;">
    <div style="flex:1 1 58%;padding-right:2mm;border-right:1px solid #555;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Отправитель:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${esc(t.shipper_name || '—')}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Получатель:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${esc(t.receiver_name || '—')}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Перевозчик:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${esc(t.carrier_name || '—')}</td></tr>
          <tr><td style="padding:0 2mm 0 0;white-space:nowrap;color:#444;">Вид груза:</td><td style="padding:0;font-weight:bold;">${esc(t.cargo_name || '—')}</td></tr>
        </tbody>
      </table>
    </div>

    <div style="flex:1 1 42%;padding-left:2mm;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Цена мусора, руб:</td><td style="padding:0;text-align:right;">${(t.price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">(в т.ч. НДС):</td><td style="padding:0;text-align:right;">${vatAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;font-weight:bold;">Сумма оплаты, руб:</td><td style="padding:0;text-align:right;font-weight:bold;">${(t.total_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:0 2mm 0 0;white-space:nowrap;color:#444;">(в т.ч. НДС):</td><td style="padding:0;text-align:right;">${totalVat.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div style="margin-top:1mm;border-top:1px solid #000;border-bottom:1px solid #000;padding:1mm 0 0.8mm;display:flex;align-items:flex-end;gap:4mm;">
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #000;min-height:5mm;margin-bottom:1mm;">/${esc(t.operator_name || '—')}/</div>
      <div style="font-size:9px;color:#555;">Весовщик</div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #000;min-height:5mm;margin-bottom:1mm;">/${esc(t.driver_name || '—')}/</div>
      <div style="font-size:9px;color:#555;">Водитель</div>
    </div>
  </div>
</div>`;
}

const RECEIPT_COPY_NUMBERS = [3, 1, 2] as const;

function buildOrgHeaderLine(settings: AppSettings): string {
  const parts: string[] = [];
  if (settings.org_address) parts.push(esc(settings.org_address));
  if (settings.org_phone) parts.push(esc(settings.org_phone));
  if (settings.org_inn) parts.push(`ИНН${esc(settings.org_inn)}`);
  if (settings.org_kpp) parts.push(`КПП${esc(settings.org_kpp)}`);
  if (settings.org_ogrn) parts.push(`ОГРН${esc(settings.org_ogrn)}`);
  if (settings.org_bik) parts.push(`БИК${esc(settings.org_bik)}`);
  return parts.join(', ');
}

function receiptHalfCell(label: string, value: string, withRightBorder: boolean): string {
  const border = withRightBorder ? 'border-right:1px solid #000;' : '';
  return `
    <td style="width:50%;${border}border-bottom:1px solid #000;padding:1.8mm 3mm;vertical-align:middle;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:3mm;">
        <span style="white-space:nowrap;">${label}</span>
        <span style="font-weight:bold;text-align:right;">${value}</span>
      </div>
    </td>`;
}

function receiptPairRow(
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
): string {
  return `<tr>
    ${receiptHalfCell(leftLabel, leftValue, true)}
    ${receiptHalfCell(rightLabel, rightValue, false)}
  </tr>`;
}

function receiptBottomBlock(
  grossTs: string | null,
  tareTs: string | null,
  grossWeight: number | null,
  tareWeight: number | null,
  netWeight: number | null,
  sumLabel: string,
): string {
  const leftGridCols = '28% 30% 22% 1fr';
  const weightStyle = (bold = false) =>
    `text-align:left;${bold ? 'font-weight:bold;font-size:11px;' : ''}`;

  const weightRow = (date: string, time: string, weight: string, tag: string, bold = false) => `
    <div style="display:grid;grid-template-columns:${leftGridCols};align-items:baseline;font-size:9.5px;padding:0.6mm 2mm;">
      <span>${date}</span>
      <span>${time}</span>
      <span style="${weightStyle(bold)}">${weight}</span>
      <span>${tag}</span>
    </div>`;

  return `
    <tr>
      <td style="width:50%;border-right:1px solid #000;border-bottom:1px solid #000;padding:1.2mm 2mm;vertical-align:bottom;">
        <div style="display:grid;grid-template-columns:${leftGridCols};font-weight:bold;font-size:9.5px;">
          <span>Дата</span><span>Время</span><span>Вес т</span><span></span>
        </div>
      </td>
      <td style="width:50%;border-bottom:1px solid #000;padding:1.2mm 3mm;vertical-align:bottom;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:3mm;font-size:9.5px;">
          <span style="font-weight:bold;">Сумма</span>
          <span style="font-weight:bold;">${sumLabel}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0.8mm 0 2mm;vertical-align:top;">
        <div style="width:50%;">
          ${weightRow(fmtDateFull(grossTs), fmtTimeFull(grossTs), fmtTonsShort(grossWeight), 'Брутто')}
          ${weightRow(fmtDateFull(tareTs), fmtTimeFull(tareTs), fmtTonsShort(tareWeight), 'Тара')}
          ${weightRow('', '', fmtTonsShort(netWeight), 'Нетто', true)}
        </div>
      </td>
    </tr>`;
}

function receiptSignatureBlock(label: string, name: string, caption: string): string {
  return `
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:2mm;">
        <span style="white-space:nowrap;font-size:9px;">${label}</span>
        <span style="flex:1;border-bottom:1px solid #000;min-height:4mm;"></span>
        <span style="white-space:nowrap;font-size:10px;font-weight:bold;">${name}</span>
      </div>
      <div style="text-align:center;font-size:8px;color:#555;margin-top:0.6mm;">${caption}</div>
    </div>`;
}

function renderActReceipt(t: WeighingTicket, settings: AppSettings, copyNumber: number): string {
  const grossTs = t.gross_datetime ?? t.created_at;
  const tareTs = t.tare_datetime ?? (t.tare_weight != null ? t.completed_at : null);
  const client = t.shipper_name || t.receiver_name || '—';
  const priceLabel = `${(t.price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} руб/т.`;
  const sumLabel = `${(t.total_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} руб.`;
  const orgLine = buildOrgHeaderLine(settings);
  const ticketLabel = formatTicketNumberWithDate(t);

  return `
<div style="font-family:Arial,sans-serif;font-size:10px;box-sizing:border-box;color:#000;width:100%;">
  <div style="position:relative;margin-bottom:1.5mm;padding-bottom:1mm;">
    <div style="text-align:center;padding-right:16mm;">
      <div style="font-size:13px;font-weight:bold;">${esc(settings.org_name || '—')}</div>
      <div style="font-size:10px;font-weight:bold;margin-top:0.6mm;">${ticketLabel}</div>
      ${orgLine ? `<div style="font-size:8.5px;margin-top:0.8mm;line-height:1.3;">${orgLine}</div>` : ''}
    </div>
    <div style="position:absolute;top:0;right:0;border:1px solid #000;padding:1mm 2.5mm;font-size:10px;font-weight:bold;white-space:nowrap;">
      № п/п ${copyNumber}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #000;margin-bottom:1.5mm;table-layout:fixed;">
    <tbody>
      ${receiptPairRow('Номер автомобиля', esc(t.vehicle_number || '—'), 'Марка автомобиля', esc(t.vehicle_brand || '—'))}
      ${receiptPairRow('ФИО Водителя', esc(t.driver_name || '—'), 'Клиент', esc(client))}
      ${receiptPairRow('Тип груза', esc(t.cargo_name || '—'), 'Цена', priceLabel)}
      ${receiptBottomBlock(grossTs, tareTs, t.gross_weight, t.tare_weight, t.net_weight, sumLabel)}
    </tbody>
  </table>

  <div style="display:flex;gap:8mm;margin-top:2mm;">
    ${receiptSignatureBlock('Весовщик', esc(t.operator_name || '—'), 'Подпись Весовщика')}
    ${receiptSignatureBlock('Водитель', esc(t.driver_name || '—'), 'Подпись Водителя')}
  </div>
</div>`;
}

function renderAct(t: WeighingTicket, settings: AppSettings, copyNumber?: number): string {
  if (settings.print_layout === 'receipt') {
    return renderActReceipt(t, settings, copyNumber ?? RECEIPT_COPY_NUMBERS[0]);
  }
  return renderActClassic(t, settings);
}

export function PrintAct({ ticket, settings }: Props) {
  const appSettings = settings ?? SettingsStorage.getAppSettings();
  return (
    <div
      dangerouslySetInnerHTML={{ __html: renderAct(ticket, appSettings) }}
      style={{
        fontFamily: appSettings.print_layout === 'receipt' ? 'Arial, sans-serif' : 'Times New Roman, serif',
        fontSize: '11px',
        width: '210mm',
        padding: '3mm 4mm',
        boxSizing: 'border-box',
        backgroundColor: '#fff',
        color: '#000',
      }}
    />
  );
}

function buildSheetHtml(t: WeighingTicket, settings: AppSettings): string {
  if (settings.print_layout === 'receipt') {
    const acts = RECEIPT_COPY_NUMBERS.map(
      (copyNumber) => `<div class="act">${renderActReceipt(t, settings, copyNumber)}</div>`
    ).join('');
    return `<div style="display:flex;flex-direction:column;gap:0;">${acts}</div>`;
  }

  const acts = Array.from({ length: 2 }, () => `<div class="act">${renderActClassic(t, settings)}</div>`).join('');
  return `<div style="display:flex;flex-direction:column;gap:0;">${acts}</div>`;
}

export function printTicket(
  ticket: WeighingTicket,
  settings?: AppSettings,
  options?: { source?: 'active' | 'archive' },
) {
  // Archive reprint must stay side-effect free: no TicketStorage/REO writes.
  void options?.source;
  const appSettings = settings ?? SettingsStorage.getAppSettings();
  const ticketNumberLabel = formatTicketNumberWithDate(ticket);
  const title = appSettings.print_layout === 'receipt'
    ? `Талон ${ticketNumberLabel}`
    : `Акт взвешивания ${ticketNumberLabel}`;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4 portrait; margin: 2.5mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 210mm; min-height: 297mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 100%; box-sizing: border-box; }
  .act { width: 100%; box-sizing: border-box; border: 1px solid #000; padding: 0.7mm 1.2mm 0.4mm; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
</style>
</head>
<body>
<div class="sheet">
${buildSheetHtml(ticket, appSettings)}
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}
