import { useState, useEffect, useCallback, useMemo } from 'react';
import { type WeighingTicket, TicketStorage, REO_STATUS_LABELS, SettingsStorage, softReadBool } from '@/lib/storage';
import { getReoSendState, sendTicketsToReo, isReoCargoEligible, downloadReoJsonFile, getReoComplianceIssues } from '@/lib/reo';
import {
  type WeightSource,
  WEIGHT_SOURCES,
  WEIGHT_SOURCE_LABELS,
  normalizeWeightSource,
  ticketMatchesWeightSources,
} from '@/lib/weight-source';
import { logger } from '@/lib/logger';
import { printTicket } from './PrintAct';
import { TicketPhotoPreview } from '@/components/TicketPhotoPreview';
import { MultiSelectDropdown } from '@/components/MultiSelectDropdown';
import { Search, Download, Trash2, CheckCircle2, Clock, AlertCircle, Printer, Send, RotateCcw, Loader2, FileJson, Eye, X } from 'lucide-react';

const SOURCE_FILTER_OPTIONS = WEIGHT_SOURCES.map((source) => WEIGHT_SOURCE_LABELS[source]);
const LABEL_TO_SOURCE = Object.fromEntries(
  WEIGHT_SOURCES.map((source) => [WEIGHT_SOURCE_LABELS[source], source]),
) as Record<string, WeightSource>;

function sourceLabelForWeight(weight: number | null, source: unknown): string {
  if (weight == null) return '—';
  return WEIGHT_SOURCE_LABELS[normalizeWeightSource(source)];
}

interface Props {
  refreshKey: number;
  onCompleteOpen?: (ticketId: string) => void;
}

export function WeighingJournal({ refreshKey, onCompleteOpen }: Props) {
  const reoEnabled = SettingsStorage.getAppSettings().reo_enabled;
  const [tickets, setTickets] = useState<WeighingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [reoFilter, setReoFilter] = useState<'all' | 'pending' | 'sent'>('all');
  const [sourceFilter, setSourceFilter] = useState<WeightSource[]>([]);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [viewTicket, setViewTicket] = useState<WeighingTicket | null>(null);

  const sourceFilterLabels = useMemo(
    () => sourceFilter.map((source) => WEIGHT_SOURCE_LABELS[source]),
    [sourceFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let allTickets = TicketStorage.getAll();
      if (statusFilter !== 'all') {
        allTickets = allTickets.filter(t => t.status === statusFilter);
      }
      if (reoEnabled && reoFilter !== 'all') {
        allTickets = allTickets.filter(t => t.reo_status === reoFilter);
      }
      setTickets(allTickets);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [statusFilter, reoFilter, reoEnabled]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const reoSendState = reoEnabled ? getReoSendState(TicketStorage.getAll()) : { eligibleTickets: [], disabledReason: null };
  const { eligibleTickets, disabledReason } = reoSendState;
  const reoComplianceIssues = reoEnabled
    ? getReoComplianceIssues(eligibleTickets, { checkCredentials: false })
    : [];
  const reoComplianceErrors = reoComplianceIssues.filter((issue) => issue.level === 'error');
  const reoComplianceWarnings = reoComplianceIssues.filter((issue) => issue.level === 'warning');

  const filtered = tickets.filter((t) => {
    if (!ticketMatchesWeightSources(t, sourceFilter)) return false;
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
    const headers = reoEnabled
      ? ['ID', 'Дата', 'Номер', 'Водитель', 'Груз', 'Отправитель', 'Получатель', 'Перевозчик', 'Брутто', 'Тара', 'Нетто', 'Цена/т', 'Сумма', 'Весовщик', 'Источник брутто', 'Источник тары', 'Устройство весов', 'Статус', 'РЭО', 'Дата отправки в РЭО']
      : ['ID', 'Дата', 'Номер', 'Водитель', 'Груз', 'Отправитель', 'Получатель', 'Перевозчик', 'Брутто', 'Тара', 'Нетто', 'Цена/т', 'Сумма', 'Весовщик', 'Источник брутто', 'Источник тары', 'Устройство весов', 'Статус'];
    const rows = filtered.map((t) => {
      const base = [
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
        sourceLabelForWeight(t.gross_weight, t.gross_source),
        sourceLabelForWeight(t.tare_weight, t.tare_source),
        t.scale_device || '',
        t.status === 'completed' ? 'Завершён' : 'Открыт',
      ];
      if (!reoEnabled) return base;
      return [
        ...base,
        REO_STATUS_LABELS[t.reo_status],
        t.reo_sent_at ? new Date(t.reo_sent_at).toLocaleString('ru-RU') : '',
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weighing_journal_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tableColSpan = reoEnabled ? 13 : 12;

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
        <div className="w-[220px]">
          <MultiSelectDropdown
            options={SOURCE_FILTER_OPTIONS}
            selected={sourceFilterLabels}
            onChange={(labels) => {
              setSourceFilter(
                labels
                  .map((label) => LABEL_TO_SOURCE[label])
                  .filter((source): source is WeightSource => source != null),
              );
            }}
            placeholder="Источник веса"
            emptyMessage="Нет источников"
          />
        </div>
        {reoEnabled && (
          <>
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
          </>
        )}
        <button onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"><Download size={16} /> Экспорт CSV</button>
      </div>

      {reoEnabled && disabledReason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {disabledReason}
        </div>
      )}

      {reoEnabled && reoComplianceWarnings.length > 0 && eligibleTickets.length > 0 && (
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
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">ID</th>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">Дата</th>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">Номер</th>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">Груз</th>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">Отправитель</th>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">Получатель</th>
                <th className="px-2 py-2.5 text-left font-medium whitespace-nowrap uppercase">Перевозчик</th>
                <th className="px-2 py-2.5 text-right font-medium whitespace-nowrap uppercase">Брутто</th>
                <th className="px-2 py-2.5 text-right font-medium whitespace-nowrap uppercase">Тара</th>
                <th className="px-2 py-2.5 text-right font-medium whitespace-nowrap uppercase">Нетто</th>
                <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap uppercase">Статус</th>
                {reoEnabled && (
                  <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap" title="РЭО: + отправлено, − не отправлено">РЭО</th>
                )}
                <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={tableColSpan} className="px-4 py-8 text-center text-slate-400">Загрузка...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={tableColSpan} className="px-4 py-8 text-center text-slate-400">Записей не найдено</td></tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-2 py-2.5 font-semibold text-slate-700 tabular-nums whitespace-nowrap">{t.ticket_number ?? '—'}</td>
                    <td className="px-2 py-2.5 text-slate-500 whitespace-nowrap tabular-nums">{new Date(t.created_at).toLocaleDateString('ru-RU')} {new Date(t.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-2 py-2.5 font-medium text-slate-700 whitespace-nowrap">{t.vehicle_number}</td>
                    <td className="px-2 py-2.5 text-slate-600 whitespace-nowrap">{t.cargo_name}</td>
                    <td className="px-2 py-2.5 text-slate-600 max-w-[10rem] truncate" title={t.shipper_name}>{t.shipper_name}</td>
                    <td className="px-2 py-2.5 text-slate-600 max-w-[10rem] truncate" title={t.receiver_name}>{t.receiver_name}</td>
                    <td className="px-2 py-2.5 text-slate-600 max-w-[10rem] truncate" title={t.carrier_name}>{t.carrier_name}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">
                      <div>{t.gross_weight?.toLocaleString('ru-RU') ?? '—'}</div>
                      <div className="text-[10px] font-medium text-slate-400">Б: {sourceLabelForWeight(t.gross_weight, t.gross_source)}</div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap">
                      <div>{t.tare_weight?.toLocaleString('ru-RU') ?? '—'}</div>
                      <div className="text-[10px] font-medium text-slate-400">Т: {sourceLabelForWeight(t.tare_weight, t.tare_source)}</div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-slate-800 whitespace-nowrap">{t.net_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                    <td className="px-2 py-2.5 text-center whitespace-nowrap">
                      {softReadBool(t.auto_closed) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700" title="Закрыт при ротации года">
                          Закрыт при ротации
                        </span>
                      ) : t.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 size={12} /> Завершён</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><Clock size={12} /> Открыт</span>
                      )}
                    </td>
                    {reoEnabled && (
                      <td className="px-2 py-2.5 text-center whitespace-nowrap">
                        {t.reo_status === 'sent' ? (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center text-lg font-bold leading-none text-emerald-600"
                            title={t.reo_sent_at ? `Отправлено в РЭО: ${new Date(t.reo_sent_at).toLocaleString('ru-RU')}` : 'Отправлено в РЭО'}
                          >
                            +
                          </span>
                        ) : (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center text-lg font-bold leading-none text-slate-400"
                            title={isReoCargoEligible(t) ? 'Не отправлено в РЭО' : 'Не подходит для отправки в РЭО'}
                          >
                            −
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-2 py-2.5 text-center whitespace-nowrap">
                      <button
                        onClick={() => setViewTicket(t)}
                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition mr-1"
                        title="Просмотр"
                      >
                        <Eye size={15} />
                      </button>
                      {t.status === 'open' && (
                        <button
                          onClick={() => onCompleteOpen?.(t.id)}
                          className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition mr-1"
                          title="Завершить на форме взвешивания"
                        >
                          Завершить
                        </button>
                      )}
                      {reoEnabled && t.reo_status === 'sent' && (
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

      {viewTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setViewTicket(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Просмотр тикета №{viewTicket.ticket_number ?? '—'}
              </h3>
              <button
                type="button"
                onClick={() => setViewTicket(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Закрыть"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-500">ТС</div>
                  <div className="font-medium">{viewTicket.vehicle_number}</div>
                  {viewTicket.vehicle_brand && (
                    <div className="text-xs text-slate-500">{viewTicket.vehicle_brand}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-500">Водитель</div>
                  <div className="font-medium">{viewTicket.driver_name || '—'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-slate-500">Груз</div>
                  <div className="font-medium">{viewTicket.cargo_name || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Брутто</div>
                  <div className="font-medium tabular-nums">
                    {viewTicket.gross_weight?.toLocaleString('ru-RU') ?? '—'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {sourceLabelForWeight(viewTicket.gross_weight, viewTicket.gross_source)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Тара</div>
                  <div className="font-medium tabular-nums">
                    {viewTicket.tare_weight?.toLocaleString('ru-RU') ?? '—'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {sourceLabelForWeight(viewTicket.tare_weight, viewTicket.tare_source)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Нетто</div>
                  <div className="font-semibold tabular-nums">
                    {viewTicket.net_weight?.toLocaleString('ru-RU') ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Устройство весов</div>
                  <div className="font-medium">{viewTicket.scale_device || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Оператор</div>
                  <div className="font-medium">{viewTicket.operator_name || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Создан</div>
                  <div className="font-medium">
                    {new Date(viewTicket.created_at).toLocaleString('ru-RU')}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Завершён</div>
                  <div className="font-medium">
                    {viewTicket.completed_at
                      ? new Date(viewTicket.completed_at).toLocaleString('ru-RU')
                      : '—'}
                  </div>
                </div>
                {softReadBool(viewTicket.auto_closed) && (
                  <div className="col-span-2 text-sm text-violet-700">
                    Закрыт при ротации года
                  </div>
                )}
                <div className="col-span-2">
                  <TicketPhotoPreview ticket={viewTicket} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setViewTicket(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Закрыть
              </button>
              <button
                type="button"
                disabled={viewTicket.status !== 'completed'}
                onClick={() => printTicket(viewTicket)}
                className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer size={16} /> Печать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
