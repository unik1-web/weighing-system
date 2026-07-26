import type { WeighingTicket } from '@/lib/storage';

interface Props {
  ticket: WeighingTicket;
  orgName: string;
}

function fmt(ts: string | null) {
  if (!ts) return '——';
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTons(kg: number | null) {
  if (kg == null) return '——';
  return (kg / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function computeVat(amount: number | null, vatRate: number): number {
  if (!amount || !vatRate) return 0;
  return amount * vatRate / (100 + vatRate);
}

export function PrintAct({ ticket, orgName }: Props) {
  return (
    <div
      style={{
        fontFamily: 'Times New Roman, serif',
        fontSize: '11px',
        width: '210mm',
        padding: '3mm 4mm',
        boxSizing: 'border-box',
        backgroundColor: '#fff',
        color: '#000',
      }}
    >
      {renderAct(ticket, orgName)}
    </div>
  );
}

function renderAct(t: WeighingTicket, orgName: string): string {
  const vatAmount = computeVat(t.price || 0, t.vat_rate || 0);
  const totalVat = computeVat(t.total_amount, t.vat_rate || 0);

  return `
<div style="font-family:Times New Roman,serif;font-size:10.5px;box-sizing:border-box;color:#000;width:100%;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2mm;border-bottom:1px solid #000;padding-bottom:1mm;gap:3mm;">
    <div style="font-size:12px;font-weight:bold;white-space:nowrap;min-width:32%">Грузополучатель: ${orgName || 'ООО Организация'}</div>
    <div style="font-size:12px;font-weight:bold;text-align:center;flex:1">Акт взвешивания № ${t.ticket_number ?? '—'}</div>
    <div style="min-width:18mm;text-align:right;font-size:10px;white-space:nowrap;">${t.created_at ? fmt(t.created_at) : '——'}</div>
  </div>

  <div style="display:flex;gap:2mm;align-items:stretch;">
    <div style="flex:1 1 57%;padding-right:2mm;border-right:1px solid #555;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Номер ТС:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${t.vehicle_number || '—'}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Марка ТС:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${t.vehicle_brand || '—'}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Прицеп:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${t.trailer_number || '—'}</td></tr>
          <tr><td style="padding:0 2mm 0 0;white-space:nowrap;color:#444;">Водитель:</td><td style="padding:0;font-weight:bold;">${t.driver_name || '—'}</td></tr>
        </tbody>
      </table>
    </div>

    <div style="flex:1 1 43%;padding-left:2mm;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr>
            <td style="padding:0 2mm 1mm 0;white-space:nowrap;">Брутто, т</td>
            <td style="padding:0 2mm 1mm 0;font-weight:bold;text-align:right;">${fmtTons(t.gross_weight)}</td>
            <td style="padding:0 0 1mm 0;color:#555;font-size:9px;text-align:right;white-space:nowrap;">${t.gross_datetime ? fmt(t.gross_datetime) : fmt(t.created_at)}</td>
          </tr>
          <tr>
            <td style="padding:0 2mm 1mm 0;white-space:nowrap;">Тара, т</td>
            <td style="padding:0 2mm 1mm 0;font-weight:bold;text-align:right;">${fmtTons(t.tare_weight)}</td>
            <td style="padding:0 0 1mm 0;color:#555;font-size:9px;text-align:right;white-space:nowrap;">${t.tare_datetime ? fmt(t.tare_datetime) : (t.tare_weight != null ? fmt(t.completed_at) : '——')}</td>
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

  <div style="display:flex;gap:2mm;margin-top:1.8mm;border-top:1px solid #555;padding-top:1.2mm;align-items:flex-start;">
    <div style="flex:1 1 58%;padding-right:2mm;border-right:1px solid #555;">
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Отправитель:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${t.shipper_name || '—'}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Получатель:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${t.receiver_name || '—'}</td></tr>
          <tr><td style="padding:0 2mm 1mm 0;white-space:nowrap;color:#444;">Перевозчик:</td><td style="padding:0 0 1mm 0;font-weight:bold;">${t.carrier_name || '—'}</td></tr>
          <tr><td style="padding:0 2mm 0 0;white-space:nowrap;color:#444;">Вид груза:</td><td style="padding:0;font-weight:bold;">${t.cargo_name || '—'}</td></tr>
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

  <div style="margin-top:2mm;border-top:1px solid #000;padding-top:1.5mm;display:flex;align-items:flex-end;gap:4mm;">
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #000;min-height:5mm;margin-bottom:1mm;">/${t.operator_name || '—'}/</div>
      <div style="font-size:9px;color:#555;">Весовщик</div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #000;min-height:5mm;margin-bottom:1mm;">/${t.driver_name || '—'}/</div>
      <div style="font-size:9px;color:#555;">Водитель</div>
    </div>
  </div>
</div>`;
}

function buildTwoActsHtml(t: WeighingTicket, orgName: string): string {
  return `
<div style="display:flex;flex-direction:column;gap:1.2mm;">
  <div class="act">${renderAct(t, orgName)}</div>
  <div class="act">${renderAct(t, orgName)}</div>
</div>`;
}

export function printTicket(ticket: WeighingTicket, orgName: string) {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Акт взвешивания № ${ticket.ticket_number ?? '—'}</title>
<style>
  @page { size: A4 portrait; margin: 4mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 210mm; min-height: 297mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 100%; box-sizing: border-box; }
  .act { width: 100%; box-sizing: border-box; border: 1px solid #000; padding: 1.8mm 2mm 1.6mm; height: 141mm; overflow: hidden; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
</style>
</head>
<body>
<div class="sheet">
${buildTwoActsHtml(ticket, orgName)}
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
