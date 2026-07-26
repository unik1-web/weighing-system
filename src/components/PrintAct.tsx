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
  const vatAmount = computeVat(ticket.price || 0, ticket.vat_rate || 0);
  const totalVat = computeVat(ticket.total_amount, ticket.vat_rate || 0);

  return (
    <div
      id="print-act"
      style={{
        fontFamily: 'Times New Roman, serif',
        fontSize: '13px',
        width: '210mm',
        padding: '12mm 14mm',
        boxSizing: 'border-box',
        backgroundColor: '#fff',
        color: '#000',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', borderBottom: '1px solid #000', paddingBottom: '6px' }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{orgName || 'ООО Организация'}</div>
        <div style={{ fontSize: '14px', fontWeight: 'bold', textAlign: 'center' }}>
          Акт взвешивания № {ticket.ticket_number ?? '—'}
        </div>
        <div style={{ width: '60px' }} />
      </div>

      {/* Main body: two columns */}
      <div style={{ display: 'flex', gap: '0', marginTop: '6px' }}>
        {/* Left column: vehicle and route data */}
        <div style={{ flex: '1 1 50%', paddingRight: '12px', borderRight: '1px solid #555' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              <ActRow label="Номер ТС:" value={ticket.vehicle_number} />
              <ActRow label="Марка ТС:" value={ticket.vehicle_brand || '—'} />
              <ActRow label="Прицеп:" value={ticket.trailer_number || '—'} />
              <ActRow label="Водитель:" value={ticket.driver_name} />
            </tbody>
          </table>
        </div>

        {/* Right top: weight columns */}
        <div style={{ flex: '1 1 50%', paddingLeft: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              <tr>
                <td style={{ paddingBottom: '3px', paddingRight: '8px', whiteSpace: 'nowrap' }}>Брутто, т</td>
                <td style={{ paddingBottom: '3px', fontWeight: 'bold', textAlign: 'right', paddingRight: '12px' }}>{fmtTons(ticket.gross_weight)}</td>
                <td style={{ paddingBottom: '3px', color: '#555' }}>{ticket.gross_datetime ? fmt(ticket.gross_datetime) : fmt(ticket.created_at)}</td>
              </tr>
              <tr>
                <td style={{ paddingBottom: '3px', paddingRight: '8px', whiteSpace: 'nowrap' }}>Тара, т</td>
                <td style={{ paddingBottom: '3px', fontWeight: 'bold', textAlign: 'right', paddingRight: '12px' }}>{fmtTons(ticket.tare_weight)}</td>
                <td style={{ paddingBottom: '3px', color: '#555' }}>{ticket.tare_datetime ? fmt(ticket.tare_datetime) : (ticket.tare_weight != null ? fmt(ticket.completed_at) : '——')}</td>
              </tr>
              <tr>
                <td style={{ paddingRight: '8px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>Нетто, т</td>
                <td style={{ fontWeight: 'bold', fontSize: '15px', textAlign: 'right', paddingRight: '12px', borderTop: '1px solid #000' }}>{fmtTons(ticket.net_weight)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Second row: shipper/receiver/carrier | pricing */}
      <div style={{ display: 'flex', gap: '0', marginTop: '8px', borderTop: '1px solid #555', paddingTop: '6px' }}>
        <div style={{ flex: '1 1 60%', paddingRight: '12px', borderRight: '1px solid #555' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              <ActRow label="Отправитель:" value={ticket.shipper_name} />
              <ActRow label="Получатель:" value={ticket.receiver_name} />
              <ActRow label="Перевозчик:" value={ticket.carrier_name} />
              <ActRow label="Вид груза:" value={ticket.cargo_name} />
            </tbody>
          </table>
        </div>
        <div style={{ flex: '1 1 40%', paddingLeft: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              <PriceRow label="Цена мусора, руб:" value={ticket.price?.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) ?? '0.00'} />
              <PriceRow label="(в т.ч. НДС:" value={vatAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} />
              <PriceRow label="Сумма оплаты, руб:" value={ticket.total_amount?.toLocaleString('ru-RU', { minimumFractionDigits: 2 }) ?? '0.00'} bold />
              <PriceRow label="(в т.ч. НДС:" value={totalVat.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer: signatures */}
      <div style={{ marginTop: '18px', borderTop: '1px solid #000', paddingTop: '10px', display: 'flex', alignItems: 'flex-end', gap: '0' }}>
        <div style={{ flex: '1', textAlign: 'center' }}>
          <div style={{ borderBottom: '1px solid #000', marginBottom: '3px', minHeight: '18px' }}>
            /{ticket.operator_name}/
          </div>
          <div style={{ fontSize: '11px', color: '#555' }}>Весовщик Ф.И.О.</div>
        </div>
        <div style={{ width: '24px' }} />
        <div style={{ flex: '1', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', marginBottom: '3px' }}>Водитель:</div>
        </div>
        <div style={{ flex: '1', borderBottom: '1px solid #000', marginBottom: '3px' }}>
          <div style={{ textAlign: 'right' }}>/{ticket.driver_name}/</div>
        </div>
        <div style={{ width: '16px' }} />
        <div style={{ flex: '0 0 auto', textAlign: 'right', fontSize: '11px', color: '#555' }}>
          <div>Весовщик: {ticket.operator_name}</div>
        </div>
      </div>
    </div>
  );
}

function ActRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ paddingBottom: '3px', paddingRight: '6px', whiteSpace: 'nowrap', color: '#444' }}>{label}</td>
      <td style={{ paddingBottom: '3px', fontWeight: 'bold' }}>{value}</td>
    </tr>
  );
}

function PriceRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr>
      <td style={{ paddingBottom: '3px', paddingRight: '4px', whiteSpace: 'nowrap', color: '#444', fontSize: '12px' }}>{label}</td>
      <td style={{ paddingBottom: '3px', textAlign: 'right', fontWeight: bold ? 'bold' : 'normal' }}>{value}</td>
    </tr>
  );
}

export function printTicket(ticket: WeighingTicket, orgName: string) {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Акт взвешивания № ${ticket.ticket_number}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { margin: 0; background: #fff; width: 297mm; height: 210mm; }
  #print-act { width: 100%; max-width: 280mm; margin: 0 auto; box-sizing: border-box; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${buildActHtml(ticket, orgName)}
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

function buildActHtml(t: WeighingTicket, orgName: string): string {
  const vatAmount = computeVat2(t.price || 0, t.vat_rate || 0);
  const totalVat = computeVat2(t.total_amount, t.vat_rate || 0);

  return `
<div id="print-act" style="font-family:Times New Roman,serif;font-size:12px;padding:5mm 6mm;box-sizing:border-box;color:#000;max-width:280mm;min-width:240mm;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;border-bottom:1px solid #000;padding-bottom:6px">
    <div style="font-size:14px;font-weight:bold">${orgName || 'ООО Организация'}</div>
    <div style="font-size:14px;font-weight:bold;text-align:center">Акт взвешивания № ${t.ticket_number ?? '—'}</div>
    <div style="width:60px"></div>
  </div>
  <div style="display:flex;gap:0;margin-top:6px;flex-wrap:wrap">
    <div style="flex:1 1 32%;min-width:220px;padding-right:10px;border-right:1px solid #555">
      <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Номер ТС:</td><td style="font-weight:bold">${t.vehicle_number}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Марка ТС:</td><td style="font-weight:bold">${t.vehicle_brand || '—'}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Прицеп:</td><td style="font-weight:bold">${t.trailer_number || '—'}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Водитель:</td><td style="font-weight:bold">${t.driver_name}</td></tr>
      </tbody></table>
    </div>
    <div style="flex:1 1 28%;min-width:180px;padding:0 10px;border-right:1px solid #555">
      <table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>
        <tr><td style="padding-bottom:3px;padding-right:8px;white-space:nowrap">Брутто, т</td><td style="font-weight:bold;text-align:right;padding-right:12px">${fmtTons(t.gross_weight)}</td><td style="color:#555;font-size:11px">${t.gross_datetime ? fmt(t.gross_datetime) : fmt(t.created_at)}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:8px;white-space:nowrap">Тара, т</td><td style="font-weight:bold;text-align:right;padding-right:12px">${fmtTons(t.tare_weight)}</td><td style="color:#555;font-size:11px">${t.tare_datetime ? fmt(t.tare_datetime) : '——'}</td></tr>
        <tr><td style="padding-right:8px;white-space:nowrap;font-weight:bold">Нетто, т</td><td style="font-weight:bold;font-size:15px;text-align:right;padding-right:12px;border-top:1px solid #000">${fmtTons(t.net_weight)}</td><td></td></tr>
      </tbody></table>
    </div>
    <div style="flex:1 1 30%;padding-left:12px">
      <table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>
        <tr><td style="padding-bottom:3px;padding-right:4px;white-space:nowrap;color:#444">Цена мусора, руб:</td><td style="text-align:right">${(t.price || 0).toLocaleString('ru-RU',{minimumFractionDigits:2})}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:4px;color:#444">(в т.ч. НДС:</td><td style="text-align:right">${vatAmount.toLocaleString('ru-RU',{minimumFractionDigits:2})}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:4px;white-space:nowrap;font-weight:bold">Сумма оплаты, руб:</td><td style="text-align:right;font-weight:bold">${(t.total_amount ?? 0).toLocaleString('ru-RU',{minimumFractionDigits:2})}</td></tr>
        <tr><td style="color:#444">(в т.ч. НДС:</td><td style="text-align:right">${totalVat.toLocaleString('ru-RU',{minimumFractionDigits:2})}</td></tr>
      </tbody></table>
    </div>
  </div>
  <div style="display:flex;gap:0;margin-top:8px;border-top:1px solid #555;padding-top:6px">
    <div style="flex:1 1 60%;padding-right:12px;border-right:1px solid #555">
      <table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Отправитель:</td><td style="font-weight:bold">${t.shipper_name}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Получатель:</td><td style="font-weight:bold">${t.receiver_name}</td></tr>
        <tr><td style="padding-bottom:3px;padding-right:6px;white-space:nowrap;color:#444">Перевозчик:</td><td style="font-weight:bold">${t.carrier_name}</td></tr>
        <tr><td style="padding-right:6px;white-space:nowrap;color:#444">Вид груза:</td><td style="font-weight:bold">${t.cargo_name}</td></tr>
      </tbody></table>
    </div>
    <div style="flex:1 1 40%;padding-left:12px;display:flex;align-items:flex-end">
    </div>
  </div>
  <div style="margin-top:18px;border-top:1px solid #000;padding-top:10px;display:flex;align-items:flex-end;gap:8px">
    <div style="flex:1;text-align:center">
      <div style="border-bottom:1px solid #000;margin-bottom:3px;min-height:18px">/${t.operator_name}/</div>
      <div style="font-size:11px;color:#555">Весовщик Ф.И.О.</div>
    </div>
    <div style="flex:2;text-align:center">
      Водитель: <span style="display:inline-block;border-bottom:1px solid #000;min-width:120px;margin:0 8px">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> /${t.driver_name}/
    </div>
    <div style="flex:0 0 auto;text-align:right;font-size:11px;color:#555">
      <div>${new Date(t.created_at).toLocaleString('ru-RU')}</div>
    </div>
  </div>
</div>`;
}

function computeVat2(amount: number | null, vatRate: number): number {
  if (!amount || !vatRate) return 0;
  return amount * vatRate / (100 + vatRate);
}
