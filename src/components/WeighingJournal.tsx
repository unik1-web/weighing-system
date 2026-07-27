import { useState, useEffect, useCallback } from 'react';
import { type WeighingTicket, TicketStorage, REO_STATUS_LABELS } from '@/lib/storage';
import { getReoSendState, sendTicketsToReo, isReoCargoEligible, downloadReoJsonFile, getReoComplianceIssues } from '@/lib/reo';
import { logger } from '@/lib/logger';
import { printTicket } from './PrintAct';
import { Search, Calendar, Download, Trash2, CheckCircle2, Clock, AlertCircle, Printer, Send, RotateCcw, Loader2, FileJson } from 'lucide-react';

interface Props {
  refreshKey: number;
}

export function WeighingJournal({ refreshKey }: Props) {
  const [tickets, setTickets] = useState<WeighingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [reoFilter, setReoFilter] = useState<'all' | 'pending' | 'sent'>('all');
  const [sendingBulk, setSendingBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let allTickets = TicketStorage.getAll();
      if (statusFilter !== 'all') {
        allTickets = allTickets.filter(t => t.status === statusFilter);
      }
      if (reoFilter !== 'all') {
        allTickets = allTickets.filter(t => t.reo_status === reoFilter);
      }
      setTickets(allTickets);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [statusFilter, reoFilter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const reoSendState = getReoSendState(TicketStorage.getAll());
  const { eligibleTickets, disabledReason } = reoSendState;
  const reoComplianceIssues = getReoComplianceIssues(eligibleTickets, { checkCredentials: false });
  const reoComplianceErrors = reoComplianceIssues.filter((issue) => issue.level === 'error');
  const reoComplianceWarnings = reoComplianceIssues.filter((issue) => issue.level === 'warning');

  const filtered = tickets.filter((t) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return t.vehicle_number?.toLowerCase().includes(s) || t.driver_name?.toLowerCase().includes(s) || t.cargo_name?.toLowerCase().includes(s) || t.shipper_name?.toLowerCase().includes(s) || t.receiver_name?.toLowerCase().includes(s) || t.carrier_name?.toLowerCase().includes(s) || t.operator_name?.toLowerCase().includes(s) || String(t.ticket_number ?? '').includes(s);
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить запись о взвешивании?')) return;
    try {
      TicketStorage.delete(id);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleBulkSendToReo = async () => {
    if (eligibleTickets.length === 0) {
      setError('Нет записей, подходящих для отправки в РЭО');
      return;
    }

    if (!confirm(`Отправить в РЭО ${eligibleTickets.length} запис(ей)?`)) {
      return;
    }

    setError(null);
    setSendingBulk(true);
    try {
      await sendTicketsToReo(eligibleTickets);
      eligibleTickets.forEach((ticket) => TicketStorage.markReoSent(ticket.id));
      logger.info('reo', `Отправлено в РЭО записей: ${eligibleTickets.length}`);
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить данные в РЭО');
    } finally {
      setSendingBulk(false);
    }
  };

  const handleResetReo = async (ticket: WeighingTicket) => {
    if (!confirm('Снять отметку отправки в РЭО?')) return;
    try {
      TicketStorage.markReoPending(ticket.id);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateReoJson = () => {
    if (eligibleTickets.length === 0) {
      setError('Нет записей, подходящих для формирования JSON РЭО');
      return;
    }

    if (reoComplianceErrors.length > 0) {
      setError(`Нельзя сформировать JSON: ${reoComplianceErrors[0].message}`);
      return;
    }

    setError(null);
    downloadReoJsonFile(eligibleTickets);
  };

  const exportCSV = () => {
    const headers = ['№', 'Дата', 'Авто', 'Водитель', 'Груз', 'Отправитель', 'Получатель', 'Перевозчик', 'Брутто', 'Тара', 'Нетто', 'Цена/т', 'Сумма', 'Весовщик', 'Статус', 'РЭО', 'Дата отправки в РЭО'];
    const rows = filtered.map((t) => [
      t.ticket_number,
      new Date(t.created_at).toLocaleString('ru-RU'),
      t.vehicle_number,
      t.driver_name,
      t.cargo_name,
      t.shipper_name,
      t.receiver_name,
      t.carrier_name,
      t.gross_weight ?? '',
      t.tare_weight ?? '',
      t.net_weight ?? '',
      t.price,
      t.total_amount ?? '',
      t.operator_name,
      t.status === 'completed' ? 'Завершён' : 'Открыт',
      REO_STATUS_LABELS[t.reo_status],
      t.reo_sent_at ? new Date(t.reo_sent_at).toLocaleString('ru-RU') : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weighing_journal_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по номеру, авто, водителю, грузу, весовщику..." className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
        </div>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          {(['all', 'completed', 'open'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-4 py-2 text-sm font-medium transition ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{s === 'all' ? 'Все' : s === 'completed' ? 'Завершённые' : 'Открытые'}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          {(['all', 'pending', 'sent'] as const).map((s) => (
            <button key={s} onClick={() => setReoFilter(s)} className={`px-4 py-2 text-sm font-medium transition ${reoFilter === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{s === 'all' ? 'РЭО: все' : s === 'pending' ? 'Не отправлено' : 'Отправлено'}</button>
          ))}
        </div>
        <button
          onClick={handleBulkSendToReo}
          disabled={sendingBulk || eligibleTickets.length === 0}
          title={disabledReason ?? 'Отправить подходящие записи в РЭО'}
          className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sendingBulk ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Отправить в РЭО{eligibleTickets.length > 0 ? ` (${eligibleTickets.length})` : ''}
        </button>
        <button
          onClick={handleCreateReoJson}
          disabled={eligibleTickets.length === 0 || reoComplianceErrors.length > 0}
          title="Сформировать JSON-файл для отправки в РЭО (multipart/form-data -F file=@...)"
          className="flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FileJson size={16} />
          Создать JSON для РЭО{eligibleTickets.length > 0 ? ` (${eligibleTickets.length})` : ''}
        </button>
        <button onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"><Download size={16} /> Экспорт CSV</button>
      </div>

      {disabledReason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {disabledReason}
        </div>
      )}

      {reoComplianceWarnings.length > 0 && eligibleTickets.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Соответствие инструкции РЭО — рекомендуется заполнить:</p>
          <ul className="mt-1 list-disc pl-5">
            {reoComplianceWarnings.slice(0, 5).map((issue, index) => (
              <li key={`${issue.ticketNumber}-${index}`}>
                {issue.ticketNumber != null ? `Запись №${issue.ticketNumber}: ` : ''}{issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" /> {error}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">№</th>
                <th className="px-4 py-3 text-left font-medium">Дата</th>
                <th className="px-4 py-3 text-left font-medium">Авто</th>
                <th className="px-4 py-3 text-left font-medium">Водитель</th>
                <th className="px-4 py-3 text-left font-medium">Груз</th>
                <th className="px-4 py-3 text-left font-medium">Отправитель</th>
                <th className="px-4 py-3 text-left font-medium">Получатель</th>
                <th className="px-4 py-3 text-left font-medium">Перевозчик</th>
                <th className="px-3 py-3 text-right font-medium">Брутто</th>
                <th className="px-3 py-3 text-right font-medium">Тара</th>
                <th className="px-3 py-3 text-right font-medium">Нетто</th>
                <th className="px-3 py-3 text-right font-medium">Сумма</th>
                <th className="px-4 py-3 text-left font-medium">Весовщик</th>
                <th className="px-4 py-3 text-center font-medium">Статус</th>
                <th className="px-4 py-3 text-center font-medium">РЭО</th>
                <th className="px-4 py-3 text-center font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={16} className="px-4 py-8 text-center text-slate-400">Загрузка...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={16} className="px-4 py-8 text-center text-slate-400">Записей не найдено</td></tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-4 py-2.5 font-semibold text-slate-700 tabular-nums">{t.ticket_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap"><div className="flex items-center gap-1 text-xs"><Calendar size={12} className="text-slate-400" />{new Date(t.created_at).toLocaleDateString('ru-RU')}<span className="text-slate-400">{new Date(t.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div></td>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{t.vehicle_number}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.driver_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.cargo_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.shipper_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.receiver_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.carrier_name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{t.gross_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{t.tare_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-800">{t.net_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-blue-700">{t.total_amount != null ? `${t.total_amount.toLocaleString('ru-RU')} ₽` : '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.operator_name || '—'}</td>
                    <td className="px-4 py-2.5 text-center">{t.status === 'completed' ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 size={12} /> Завершён</span> : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><Clock size={12} /> Открыт</span>}</td>
                    <td className="px-4 py-2.5 text-center">
                      {t.reo_status === 'sent' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700" title={t.reo_sent_at ? new Date(t.reo_sent_at).toLocaleString('ru-RU') : undefined}>
                          <Send size={12} /> Отправлено
                        </span>
                      ) : isReoCargoEligible(t) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Не отправлено
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-400">
                          Не подходит
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {t.reo_status === 'sent' && (
                        <button
                          onClick={() => handleResetReo(t)}
                          className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition"
                          title="Снять отметку отправки в РЭО"
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      <button onClick={() => printTicket(t)} disabled={t.status !== 'completed'} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition disabled:opacity-30 disabled:cursor-not-allowed ml-1" title="Печать акта"><Printer size={15} /></button>
                      <button onClick={() => handleDelete(t.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition ml-1"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
