import { useEffect, useMemo, useState } from 'react';
import type { RotationPreviewResponse } from '@/lib/api';

interface YearRotationDialogProps {
  open: boolean;
  preview: RotationPreviewResponse | null;
  committing: boolean;
  error: string | null;
  blockingTickets: Array<Record<string, unknown>>;
  pendingReoCount: number;
  onConfirm: () => void;
  onClose?: () => void;
}

export function YearRotationDialog({
  open,
  preview,
  committing,
  error,
  blockingTickets,
  pendingReoCount,
  onConfirm,
  onClose,
}: YearRotationDialogProps) {
  const [ackPendingReo, setAckPendingReo] = useState(false);
  useEffect(() => {
    if (!open) {
      setAckPendingReo(false);
    }
  }, [open, preview?.preview_token]);
  if (!open || !preview) return null;
  const hasBlockingTickets = blockingTickets.length > 0;
  const requiresPendingAck = pendingReoCount > 0;
  const confirmDisabled = committing || hasBlockingTickets || (requiresPendingAck && !ackPendingReo);
  const blockingLabel = useMemo(
    () =>
      blockingTickets.map((ticket, index) => {
        const ticketId = String(ticket.ticket_id ?? `ticket-${index}`);
        const ticketNumber = ticket.ticket_number ?? '—';
        const plate = ticket.vehicle_number ?? '—';
        return `${ticketNumber} (${plate}) [${ticketId}]`;
      }),
    [blockingTickets],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={committing ? undefined : onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Предпросмотр ротации года"
      >
        <h3 className="text-lg font-semibold text-slate-800">Предпросмотр ротации года</h3>
        <p className="mt-1 text-sm text-slate-600">
          Закрываемый год: <b>{preview.source_year ?? '—'}</b> · Новый год: <b>{preview.target_year ?? '—'}</b>
        </p>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>Кандидатов на авто-закрытие: {preview.open_candidates.length}</div>
          <div>Ожидают РЭО: {pendingReoCount}</div>
          <div>Блокирующих тикетов: {blockingTickets.length}</div>
        </div>

        <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Ticket ID</th>
                <th className="px-3 py-2 text-right">Номер</th>
                <th className="px-3 py-2 text-right">Тара</th>
                <th className="px-3 py-2 text-left">Источник</th>
              </tr>
            </thead>
            <tbody>
              {preview.open_candidates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-slate-400">
                    Кандидаты отсутствуют
                  </td>
                </tr>
              ) : (
                preview.open_candidates.map((candidate) => (
                  <tr key={candidate.ticket_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{candidate.ticket_id}</td>
                    <td className="px-3 py-2 text-right">{candidate.ticket_number ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{candidate.tare_weight ?? '—'}</td>
                    <td className="px-3 py-2">{candidate.tare_source ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {hasBlockingTickets && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <div className="font-semibold">Ротация заблокирована: у части open-тикетов не найдена тара.</div>
            <div className="mt-1">{blockingLabel.join(', ')}</div>
          </div>
        )}

        {requiresPendingAck && (
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ackPendingReo}
              onChange={(event) => setAckPendingReo(event.target.checked)}
              disabled={committing}
            />
            <span>Подтверждаю продолжение ротации при наличии pending-тикетов РЭО ({pendingReoCount}).</span>
          </label>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={committing || !onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {committing ? 'Выполняется...' : 'Подтвердить ротацию'}
          </button>
        </div>
      </div>
    </div>
  );
}

