import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  softReadBool,
  type WeighingTicket,
} from '@/lib/storage';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchArchiveYear,
  fetchYears,
  updateArchiveTicket,
} from '@/lib/year-archive';
import { printTicket } from '@/components/PrintAct';
import { Archive, Eye, Printer, Search, X, Pencil, Loader2 } from 'lucide-react';

export function ArchiveView() {
  const { isAdmin, session, displayName } = useAuth();
  const [years, setYears] = useState<number[]>([]);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [tickets, setTickets] = useState<WeighingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [viewTicket, setViewTicket] = useState<WeighingTicket | null>(null);
  const [editTicket, setEditTicket] = useState<WeighingTicket | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editDriver, setEditDriver] = useState('');
  const [editVehicle, setEditVehicle] = useState('');
  const [saving, setSaving] = useState(false);

  const loadYears = useCallback(async () => {
    try {
      const data = await fetchYears();
      setYears(data.years);
      setActiveYear(data.active_year);
      setSelectedYear((prev) => {
        if (prev != null && data.years.includes(prev)) return prev;
        const archiveYears = data.years.filter((y) => y !== data.active_year);
        return archiveYears.length > 0 ? archiveYears[archiveYears.length - 1] : data.active_year;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить список годов');
    }
  }, []);

  const loadArchive = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArchiveYear(year);
      setTickets(data.tickets);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить архив');
      setTickets([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  useEffect(() => {
    if (selectedYear != null) {
      void loadArchive(selectedYear);
    }
  }, [selectedYear, loadArchive]);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        t.vehicle_number?.toLowerCase().includes(s) ||
        t.driver_name?.toLowerCase().includes(s) ||
        t.cargo_name?.toLowerCase().includes(s) ||
        String(t.ticket_number ?? '').includes(s)
      );
    });
  }, [tickets, search, statusFilter]);

  const openEdit = (ticket: WeighingTicket) => {
    setEditTicket(ticket);
    setEditNotes(ticket.notes || '');
    setEditDriver(ticket.driver_name || '');
    setEditVehicle(ticket.vehicle_number || '');
  };

  const handleSaveEdit = async () => {
    if (!editTicket || selectedYear == null) return;
    setSaving(true);
    setError(null);
    try {
      let confirmReo = false;
      if (editTicket.reo_status === 'sent') {
        confirmReo = window.confirm(
          'Тикет уже отправлен в РЭО. Сохранить изменения?',
        );
        if (!confirmReo) {
          setSaving(false);
          return;
        }
      }
      const result = await updateArchiveTicket({
        year: selectedYear,
        ticket: {
          id: editTicket.id,
          version: editTicket.version ?? 1,
          notes: editNotes,
          driver_name: editDriver,
          vehicle_number: editVehicle,
        },
        operator_id: session?.user.id ?? null,
        operator_name: displayName || 'admin',
        confirm_reo_sent: confirmReo || editTicket.reo_status !== 'sent',
      });
      setTickets((prev) => prev.map((t) => (t.id === result.ticket.id ? result.ticket : t)));
      setViewTicket((prev) => (prev?.id === result.ticket.id ? result.ticket : prev));
      setEditTicket(null);
    } catch (err: unknown) {
      const e = err as Error & { error?: string };
      if (e.error === 'reo_sent_confirm_required') {
        setError('Требуется подтверждение изменения отправленного в РЭО тикета');
      } else {
        setError(e.message || 'Не удалось сохранить');
      }
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive size={20} className="text-slate-600" />
          <h2 className="text-lg font-bold text-slate-800">Архив по годам</h2>
          {activeYear != null && (
            <span className="text-xs text-slate-500">Активный год: {activeYear}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Год</label>
          <select
            value={selectedYear ?? ''}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}{y === activeYear ? ' (текущий)' : ''}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="all">Все статусы</option>
            <option value="completed">Завершённые</option>
            <option value="open">Открытые</option>
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Просмотр и печать архивных тикетов.
        {isAdmin ? ' Администратор может править записи с записью аудита.' : ' Изменение данных недоступно.'}
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">№</th>
                <th className="px-3 py-2.5 text-left">Дата</th>
                <th className="px-3 py-2.5 text-left">ТС</th>
                <th className="px-3 py-2.5 text-left">Груз</th>
                <th className="px-3 py-2.5 text-right">Нетто</th>
                <th className="px-3 py-2.5 text-center">Статус</th>
                <th className="px-3 py-2.5 text-center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto animate-spin" size={18} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">Записей не найдено</td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{t.ticket_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{t.vehicle_number}</td>
                    <td className="px-3 py-2.5 text-slate-600">{t.cargo_name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {t.net_weight?.toLocaleString('ru-RU') ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {softReadBool(t.auto_closed) ? (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                          закрыт при ротации
                        </span>
                      ) : t.status === 'completed' ? (
                        <span className="text-xs text-emerald-700">Завершён</span>
                      ) : (
                        <span className="text-xs text-amber-700">Открыт</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setViewTicket(t)}
                        className="p-1 text-slate-400 hover:text-blue-600"
                        title="Просмотр"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => printTicket(t)}
                        disabled={t.status !== 'completed'}
                        className="p-1 text-slate-400 hover:text-blue-600 disabled:opacity-30"
                        title="Печать"
                      >
                        <Printer size={15} />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          className="p-1 text-slate-400 hover:text-amber-600"
                          title="Править"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
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
                Архив · тикет №{viewTicket.ticket_number ?? '—'}
              </h3>
              <button type="button" onClick={() => setViewTicket(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2 px-5 py-4 text-sm">
              <div><span className="text-slate-500">ТС:</span> {viewTicket.vehicle_number}</div>
              <div><span className="text-slate-500">Водитель:</span> {viewTicket.driver_name || '—'}</div>
              <div><span className="text-slate-500">Груз:</span> {viewTicket.cargo_name || '—'}</div>
              <div><span className="text-slate-500">Нетто:</span> {viewTicket.net_weight?.toLocaleString('ru-RU') ?? '—'}</div>
              {softReadBool(viewTicket.auto_closed) && (
                <div className="text-violet-700">Закрыт при ротации года</div>
              )}
              {viewTicket.notes && <div><span className="text-slate-500">Заметки:</span> {viewTicket.notes}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    openEdit(viewTicket);
                    setViewTicket(null);
                  }}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800"
                >
                  Править
                </button>
              )}
              <button
                type="button"
                disabled={viewTicket.status !== 'completed'}
                onClick={() => printTicket(viewTicket)}
                className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40"
              >
                <Printer size={16} /> Печать
              </button>
            </div>
          </div>
        </div>
      )}

      {editTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !saving && setEditTicket(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Правка архива №{editTicket.ticket_number ?? '—'}
              </h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-xs text-slate-500">
                Номер ТС
                <input
                  value={editVehicle}
                  onChange={(e) => setEditVehicle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500">
                Водитель
                <input
                  value={editDriver}
                  onChange={(e) => setEditDriver(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500">
                Заметки
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              {editTicket.reo_status === 'sent' && (
                <p className="text-xs text-amber-700">
                  Тикет отправлен в РЭО — при сохранении потребуется подтверждение.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditTicket(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveEdit()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
