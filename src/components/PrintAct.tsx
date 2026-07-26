import type { WeighingTicket } from '@/lib/storage';
import { SettingsStorage, type AppSettings, type PrintLayout } from '@/lib/storage';

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

function fmtDate(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtTime(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
    <div style="font-size:12px;font-weight:bold;text-align:center;flex:1">Акт взвешивания № ${t.ticket_number ?? '—'}</div>
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

function renderActReceipt(t: WeighingTicket, settings: AppSettings): string {
  const grossTs = t.gross_datetime ?? t.created_at;
  const tareTs = t.tare_datetime ?? (t.tare_weight != null ? t.completed_at : null);
  const client = t.shipper_name || t.receiver_name || '—';
  const priceLabel = `${(t.price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} руб/т.`;
  const sumLabel = `${(t.total_amount ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} руб.`;

  const orgDetails: string[] = [];
  if (settings.org_address) orgDetails.push(esc(settings.org_address));
  if (settings.org_phone) orgDetails.push(`тел: ${esc(settings.org_phone)}`);
  const requisites: string[] = [];
  if (settings.org_inn) requisites.push(`ИНН ${esc(settings.org_inn)}`);
  if (settings.org_kpp) requisites.push(`КПП ${esc(settings.org_kpp)}`);
  if (settings.org_ogrn) requisites.push(`ОГРН ${esc(settings.org_ogrn)}`);
  if (settings.org_bik) requisites.push(`БИК ${esc(settings.org_bik)}`);

  return `
<div style="font-family:Arial,sans-serif;font-size:10px;box-sizing:border-box;color:#000;width:100%;">
  <div style="position:relative;margin-bottom:2mm;padding-bottom:1mm;border-bottom:1px solid #000;">
    <div style="text-align:center;">
      <div style="font-size:13px;font-weight:bold;">${esc(settings.org_name || '—')}</div>
      ${orgDetails.length ? `<div style="font-size:9px;margin-top:0.5mm;">${orgDetails.join(', ')}</div>` : ''}
      ${requisites.length ? `<div style="font-size:8.5px;margin-top:0.5mm;color:#333;">${requisites.join(' · ')}</div>` : ''}
    </div>
    <div style="position:absolute;top:0;right:0;border:1px solid #000;padding:1mm 2mm;font-size:10px;font-weight:bold;white-space:nowrap;">
      № п/п ${t.ticket_number ?? '—'}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:1.5mm;">
    <tbody>
      <tr>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;width:28%;">Номер автомобиля</td>
        <td style="padding:0.5mm 2mm;font-weight:bold;width:22%;">${esc(t.vehicle_number || '—')}</td>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;width:22%;">Марка автомобиля</td>
        <td style="padding:0.5mm 0;">${esc(t.vehicle_brand || '—')}</td>
      </tr>
      <tr>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;">ФИО Водителя</td>
        <td style="padding:0.5mm 2mm;font-weight:bold;">${esc(t.driver_name || '—')}</td>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;">Клиент</td>
        <td style="padding:0.5mm 0;">${esc(client)}</td>
      </tr>
      <tr>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;">Тип груза</td>
        <td style="padding:0.5mm 2mm;">${esc(t.cargo_name || '—')}</td>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;">Цена</td>
        <td style="padding:0.5mm 0;">${priceLabel}</td>
      </tr>
      <tr>
        <td colspan="2"></td>
        <td style="padding:0.5mm 2mm 0.5mm 0;white-space:nowrap;color:#444;">Сумма</td>
        <td style="padding:0.5mm 0;">${sumLabel}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex;gap:3mm;align-items:flex-start;margin-bottom:1.5mm;">
    <table style="border-collapse:collapse;font-size:9.5px;flex:1;">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:1mm 2mm;font-weight:bold;">Дата</th>
          <th style="border:1px solid #000;padding:1mm 2mm;font-weight:bold;">Время</th>
          <th style="border:1px solid #000;padding:1mm 2mm;font-weight:bold;">Вес, т</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border:1px solid #000;padding:1mm 2mm;text-align:center;">${fmtDate(grossTs)}</td>
          <td style="border:1px solid #000;padding:1mm 2mm;text-align:center;">${fmtTime(grossTs)}</td>
          <td style="border:1px solid #000;padding:1mm 2mm;text-align:center;font-weight:bold;">${fmtTonsShort(t.gross_weight)}</td>
        </tr>
        <tr>
          <td style="border:1px solid #000;padding:1mm 2mm;text-align:center;">${fmtDate(tareTs)}</td>
          <td style="border:1px solid #000;padding:1mm 2mm;text-align:center;">${fmtTime(tareTs)}</td>
          <td style="border:1px solid #000;padding:1mm 2mm;text-align:center;font-weight:bold;">${fmtTonsShort(t.tare_weight)}</td>
        </tr>
      </tbody>
    </table>
    <div style="min-width:22mm;font-size:10px;padding-top:6mm;">
      <div style="display:flex;justify-content:space-between;padding:1mm 0;border-bottom:1px solid #ccc;">
        <span>Брутто</span>
        <span style="font-weight:bold;">${fmtTonsShort(t.gross_weight)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:1mm 0;border-bottom:1px solid #ccc;">
        <span>Тара</span>
        <span style="font-weight:bold;">${fmtTonsShort(t.tare_weight)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:1.5mm 0;margin-top:1mm;">
        <span style="font-weight:bold;">Нетто</span>
        <span style="font-weight:bold;font-size:14px;">${fmtTonsShort(t.net_weight)}</span>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:6mm;margin-top:2mm;padding-top:1mm;border-top:1px solid #000;">
    <div style="flex:1;text-align:center;">
      <div style="font-size:9px;margin-bottom:1mm;">Весовщик</div>
      <div style="border-bottom:1px solid #000;min-height:6mm;margin-bottom:0.5mm;"></div>
      <div style="font-size:8px;color:#555;">Подпись Весовщика</div>
      <div style="font-size:10px;font-weight:bold;margin-top:1mm;">${esc(t.operator_name || '—')}</div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="font-size:9px;margin-bottom:1mm;">Водитель</div>
      <div style="border-bottom:1px solid #000;min-height:6mm;margin-bottom:0.5mm;"></div>
      <div style="font-size:8px;color:#555;">Подпись Водителя</div>
      <div style="font-size:10px;font-weight:bold;margin-top:1mm;">${esc(t.driver_name || '—')}</div>
    </div>
  </div>
</div>`;
}

function renderAct(t: WeighingTicket, settings: AppSettings): string {
  return settings.print_layout === 'receipt'
    ? renderActReceipt(t, settings)
    : renderActClassic(t, settings);
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

function copiesForLayout(layout: PrintLayout): number {
  return layout === 'receipt' ? 3 : 2;
}

function buildSheetHtml(t: WeighingTicket, settings: AppSettings): string {
  const count = copiesForLayout(settings.print_layout);
  const acts = Array.from({ length: count }, () => `<div class="act">${renderAct(t, settings)}</div>`).join('');
  return `<div style="display:flex;flex-direction:column;gap:0;">${acts}</div>`;
}

export function printTicket(ticket: WeighingTicket, settings?: AppSettings) {
  const appSettings = settings ?? SettingsStorage.getAppSettings();
  const title = appSettings.print_layout === 'receipt'
    ? `Талон № ${ticket.ticket_number ?? '—'}`
    : `Акт взвешивания № ${ticket.ticket_number ?? '—'}`;

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
