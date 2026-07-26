import { useState, useEffect, useCallback } from 'react';
import { type WeighingTicket } from '@/lib/storage';
import { TicketStorage } from '@/lib/storage';
import { BarChart3, Download, Filter, Calendar, RefreshCw } from 'lucide-react';

type GroupBy = 'shipper_name' | 'carrier_name' | 'cargo_name' | 'operator_name' | 'receiver_name' | 'vehicle_number';

interface GroupRow {
  key: string;
  count: number;
  totalGross: number;
  totalTare: number;
  totalNet: number;
  totalAmount: number;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  shipper_name: 'Грузоотправитель',
  carrier_name: 'Перевозчик',
  cargo_name: 'Вид груза',
  operator_name: 'Весовщик',
  receiver_name: 'Получатель',
  vehicle_number: 'Автомобиль',
};

function toDateLocal(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function ReportsView() {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [dateFrom, setDateFrom] = useState(toDateLocal(firstDayOfMonth));
  const [dateTo, setDateTo] = useState(toDateLocal(today));
  const [groupBy, setGroupBy] = useState<GroupBy>('shipper_name');
  const [tickets, setTickets] = useState<WeighingTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allTickets = TicketStorage.getAll();
      const filtered = allTickets.filter(t => {
        const created = new Date(t.created_at).toISOString().slice(0, 10);
        return t.status === 'completed' && created >= dateFrom && created <= dateTo;
      });
      setTickets(filtered);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const grouped: GroupRow[] = (() => {
    const map = new Map<string, GroupRow>();
    for (const t of tickets) {
      const key = (t[groupBy] as string) || '(не указано)';
      const existing = map.get(key) ?? { key, count: 0, totalGross: 0, totalTare: 0, totalNet: 0, totalAmount: 0 };
      existing.count += 1;
      existing.totalGross += t.gross_weight ?? 0;
      existing.totalTare += t.tare_weight ?? 0;
      existing.totalNet += t.net_weight ?? 0;
      existing.totalAmount += t.total_amount ?? 0;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.totalNet - a.totalNet);
  })();

  const totals = grouped.reduce(
    (acc, r) => ({ count: acc.count + r.count, net: acc.net + r.totalNet, amount: acc.amount + r.totalAmount }),
    { count: 0, net: 0, amount: 0 }
  );

  const exportCSV = () => {
    const headers = [GROUP_LABELS[groupBy], 'Провесок', 'Брутто, кг', 'Тара, кг', 'Нетто, кг', 'Нетто, т', 'Сумма, ₽'];
    const rows = grouped.map((r) => [r.key, r.count, r.totalGross.toFixed(2), r.totalTare.toFixed(2), r.totalNet.toFixed(2), (r.totalNet / 1000).toFixed(3), r.totalAmount.toFixed(2)]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${groupBy}_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pct = (val: number) => totals.net ? ((val / totals.net) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={20} className="text-blue-600" />
          <h2 className="text-base font-semibold text-slate-800">Параметры отчёта</h2>
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">С даты</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="pl-8 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">По дату</label>
            <div className="relative">
              <Calendar size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="pl-8 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Группировать по</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20">
              {(Object.keys(GROUP_LABELS) as GroupBy[]).map((k) => (
                <option key={k} value={k}>{GROUP_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500">
              <RefreshCw size={16} /> Обновить
            </button>
            <button onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <Download size={16} /> CSV
            </button>
          </div>
        </div>

        {/* Quick period buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { label: 'Сегодня', from: toDateLocal(today), to: toDateLocal(today) },
            { label: 'Вчера', from: toDateLocal(new Date(today.getTime() - 86400000)), to: toDateLocal(new Date(today.getTime() - 86400000)) },
            { label: 'Тек. месяц', from: toDateLocal(firstDayOfMonth), to: toDateLocal(today) },
            { label: 'Пред. месяц', from: toDateLocal(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: toDateLocal(new Date(today.getFullYear(), today.getMonth(), 0)) },
            { label: 'Тек. год', from: `${today.getFullYear()}-01-01`, to: toDateLocal(today) },
          ].map((p) => (
            <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:border-blue-400 hover:text-blue-700">{p.label}</button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Провесок" value={totals.count.toString()} sub="шт" color="blue" />
        <SummaryCard label="Нетто (т)" value={(totals.net / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} sub="тонн" color="emerald" />
        <SummaryCard label="Сумма" value={totals.amount.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} sub="₽" color="amber" />
        <SummaryCard label="Позиций" value={grouped.length.toString()} sub={GROUP_LABELS[groupBy].toLowerCase()} color="slate" />
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Report table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 bg-slate-50">
          <BarChart3 size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">
            Отчёт по полю «{GROUP_LABELS[groupBy]}» · {dateFrom} — {dateTo}
          </h3>
          {loading && <span className="ml-auto text-xs text-slate-400">Загрузка...</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-3 text-left font-medium">{GROUP_LABELS[groupBy]}</th>
                <th className="px-3 py-3 text-right font-medium">Провесков</th>
                <th className="px-3 py-3 text-right font-medium">Брутто, т</th>
                <th className="px-3 py-3 text-right font-medium">Тара, т</th>
                <th className="px-3 py-3 text-right font-medium">Нетто, т</th>
                <th className="px-3 py-3 text-right font-medium">Доля, %</th>
                <th className="px-5 py-3 text-right font-medium">Сумма, ₽</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {grouped.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">{loading ? 'Загрузка...' : 'Нет завершённых записей за выбранный период'}</td></tr>
              ) : (
                <>
                  {grouped.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50/50 transition">
                      <td className="px-5 py-2.5 font-medium text-slate-700">{r.key}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{(r.totalGross / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{(r.totalTare / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800">{(r.totalNet / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 bg-slate-100 rounded-full h-1.5">
                            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct(r.totalNet)}%` }} />
                          </div>
                          <span className="text-slate-500 text-xs">{pct(r.totalNet)}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-blue-700">{r.totalAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="px-5 py-3 text-slate-800">Итого</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{totals.count}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{(grouped.reduce((s, r) => s + r.totalGross, 0) / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{(grouped.reduce((s, r) => s + r.totalTare, 0) / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">{(totals.net / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                    <td className="px-3 py-3 text-right text-slate-500">100%</td>
                    <td className="px-5 py-3 text-right tabular-nums text-blue-800">{totals.amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail list */}
      {tickets.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-800">Детализация — все записи за период ({tickets.length})</h3>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white border-b border-slate-100 text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">№</th>
                  <th className="px-4 py-2 text-left font-medium">Дата</th>
                  <th className="px-4 py-2 text-left font-medium">Авто</th>
                  <th className="px-4 py-2 text-left font-medium">Водитель</th>
                  <th className="px-4 py-2 text-left font-medium">Груз</th>
                  <th className="px-4 py-2 text-left font-medium">Отправитель</th>
                  <th className="px-4 py-2 text-left font-medium">Весовщик</th>
                  <th className="px-3 py-2 text-right font-medium">Нетто, т</th>
                  <th className="px-4 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-semibold text-slate-600">{t.ticket_number}</td>
                    <td className="px-4 py-2 text-slate-500">{new Date(t.created_at).toLocaleDateString('ru-RU')}</td>
                    <td className="px-4 py-2 text-slate-700">{t.vehicle_number}</td>
                    <td className="px-4 py-2 text-slate-600">{t.driver_name}</td>
                    <td className="px-4 py-2 text-slate-600">{t.cargo_name}</td>
                    <td className="px-4 py-2 text-slate-600">{t.shipper_name}</td>
                    <td className="px-4 py-2 text-slate-600">{t.operator_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-700">{t.net_weight != null ? (t.net_weight / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-blue-700">{t.total_amount != null ? `${t.total_amount.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      <div className="text-xs opacity-60">{sub}</div>
    </div>
  );
}
