import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getArchiveTicket,
  getArchiveTickets,
  getArchiveYears,
  type ArchiveTicketDetails,
  type ArchiveTicketPatchResponse,
  type ArchiveTicketSummary,
  type ArchiveWarning,
  type ArchiveYearInfo,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { ArchiveTicketCard } from './ArchiveTicketCard';
import { ArchiveTicketEditDialog } from './ArchiveTicketEditDialog';

export function canEditArchiveTicket(isAdmin: boolean): boolean {
  return isAdmin;
}

export function ArchiveView() {
  const { isAdmin } = useAuth();
  const [years, setYears] = useState<ArchiveYearInfo[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [tickets, setTickets] = useState<ArchiveTicketSummary[]>([]);
  const [listWarning, setListWarning] = useState<ArchiveWarning | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<ArchiveTicketDetails | null>(null);
  const [ticketWarning, setTicketWarning] = useState<ArchiveWarning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const loadYears = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getArchiveYears();
      setYears(response.years);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить архивные годы');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTickets = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getArchiveTickets(year);
      setTickets(response.tickets);
      setListWarning(response.warning ?? null);
      setSelectedTicketId(null);
      setSelectedTicket(null);
      setTicketWarning(null);
    } catch (err) {
      setTickets([]);
      setListWarning(null);
      setSelectedTicketId(null);
      setSelectedTicket(null);
      setTicketWarning(null);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить архивные тикеты');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTicket = useCallback(async (year: number, ticketId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getArchiveTicket(year, ticketId);
      setSelectedTicket(response.ticket);
      setSelectedTicketId(ticketId);
      setTicketWarning(response.warning ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить карточку архива');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  useEffect(() => {
    if (selectedYear !== null) {
      void loadTickets(selectedYear);
    } else {
      setTickets([]);
      setListWarning(null);
      setSelectedTicketId(null);
      setSelectedTicket(null);
      setTicketWarning(null);
    }
  }, [loadTickets, selectedYear]);

  const selectedYearLabel = useMemo(
    () => years.find((item) => item.year === selectedYear)?.label ?? '—',
    [selectedYear, years],
  );

  const handleSaved = useCallback((response: ArchiveTicketPatchResponse) => {
    setSelectedTicket(response.ticket);
    setTickets((prev) =>
      prev.map((item) =>
        String(item.id) === String(response.ticket.id)
          ? {
              ...item,
              ...response.ticket,
            }
          : item,
      ),
    );
    if (response.warning?.code === 'archive_reo_sent_warning') {
      window.alert(response.warning.message || 'Архивный тикет уже отправлялся в РЭО; статус сохранён как sent');
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Архивные тикеты</h2>
        <p className="text-sm text-slate-600">
          Выберите год архива. Журнал загружается только после выбора года и не меняет активный год.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {years.length === 0 && !loading ? (
            <span className="text-sm text-slate-400">Архивов нет</span>
          ) : (
            years.map((item) => (
              <button
                key={item.year}
                type="button"
                onClick={() => setSelectedYear(item.year)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  selectedYear === item.year
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))
          )}
        </div>

        {listWarning && selectedYear !== null && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {listWarning.message}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">
            Список тикетов ({selectedYear !== null ? selectedYearLabel : 'год не выбран'})
          </h3>
          {selectedYear === null ? (
            <p className="mt-3 text-sm text-slate-400">Сначала выберите архивный год</p>
          ) : loading ? (
            <p className="mt-3 text-sm text-slate-400">Загрузка...</p>
          ) : tickets.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">В выбранном архиве нет тикетов</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {tickets.map((ticket, index) => {
                const ticketId = String(ticket.id ?? `ticket-${index}`);
                return (
                  <li key={ticketId}>
                    <button
                      type="button"
                      onClick={() => void loadTicket(selectedYear, ticketId)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        selectedTicketId === ticketId
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-medium text-slate-800">
                        № {ticket.ticket_number ?? '—'} · {ticket.vehicle_number ?? '—'}
                      </div>
                      <div className="text-xs text-slate-500">
                        Статус: {String(ticket.status ?? '—')} · РЭО: {String(ticket.reo_status ?? '—')}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Карточка архива</h3>
          {!selectedTicket || selectedYear === null ? (
            <p className="mt-3 text-sm text-slate-400">Выберите тикет для просмотра карточки</p>
          ) : (
            <ArchiveTicketCard
              archiveYear={selectedYear}
              ticket={selectedTicket}
              warning={ticketWarning}
              canEdit={canEditArchiveTicket(isAdmin)}
              onEdit={() => setEditOpen(true)}
            />
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {selectedYear !== null && selectedTicketId && (
        <ArchiveTicketEditDialog
          open={editOpen}
          year={selectedYear}
          ticketId={selectedTicketId}
          ticket={selectedTicket}
          onClose={() => setEditOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
