import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError, patchArchiveTicket, type ArchiveTicketPatchResponse } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

const EDITABLE_FIELDS = [
  'vehicle_number',
  'vehicle_brand',
  'trailer_number',
  'driver_name',
  'cargo_name',
  'shipper_name',
  'receiver_name',
  'carrier_name',
  'gross_weight',
  'tare_weight',
  'notes',
] as const;

const FIELD_LABELS: Record<(typeof EDITABLE_FIELDS)[number], string> = {
  vehicle_number: 'Госномер',
  vehicle_brand: 'Марка',
  trailer_number: 'Прицеп',
  driver_name: 'Водитель',
  cargo_name: 'Груз',
  shipper_name: 'Грузоотправитель',
  receiver_name: 'Грузополучатель',
  carrier_name: 'Перевозчик',
  gross_weight: 'Брутто',
  tare_weight: 'Тара',
  notes: 'Примечание',
};

type EditableField = (typeof EDITABLE_FIELDS)[number];
type EditablePatch = Partial<Record<EditableField, string>>;

interface ArchiveTicketEditDialogProps {
  open: boolean;
  year: number;
  ticketId: string;
  ticket: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: (response: ArchiveTicketPatchResponse) => void;
}

export function ArchiveTicketEditDialog({
  open,
  year,
  ticketId,
  ticket,
  onClose,
  onSaved,
}: ArchiveTicketEditDialogProps) {
  const { isAdmin } = useAuth();
  const initialPatch = useMemo<EditablePatch>(() => {
    const next: EditablePatch = {};
    for (const field of EDITABLE_FIELDS) {
      const value = ticket?.[field];
      next[field] = value === undefined || value === null ? '' : String(value);
    }
    return next;
  }, [ticket]);
  const [patch, setPatch] = useState<EditablePatch>(initialPatch);
  useEffect(() => {
    setPatch(initialPatch);
  }, [initialPatch]);

  const reoWasSent = String(ticket?.reo_status ?? '') === 'sent';
  const [acknowledgeReo, setAcknowledgeReo] = useState(false);
  useEffect(() => {
    setAcknowledgeReo(false);
  }, [ticketId, open]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !ticket) return null;

  const handleChange = (field: EditableField, value: string) => {
    setPatch((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    if (reoWasSent && !acknowledgeReo) {
      setError('Подтвердите предупреждение по РЭО перед сохранением');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of EDITABLE_FIELDS) {
        const raw = patch[field] ?? '';
        const initial = initialPatch[field] ?? '';
        if (raw === initial) continue;
        if (field === 'gross_weight' || field === 'tare_weight') {
          const n = Number(raw);
          payload[field] = Number.isFinite(n) ? n : raw;
        } else {
          payload[field] = raw;
        }
      }
      const response = await patchArchiveTicket(ticketId, {
        year,
        patch: payload,
        acknowledge_reo_sent_warning: reoWasSent ? acknowledgeReo : false,
      });
      onSaved(response);
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'archive_reo_ack_required') {
          setError(err.message);
        } else if (
          err.code === 'archive_edit_forbidden_field'
          || err.code === 'archive_edit_validation_failed'
        ) {
          setError(err.message);
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить архивную правку');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-800">Редактирование архивного тикета</h3>
        <p className="mt-1 text-sm text-slate-600">Год {year}, ID: {ticketId}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EDITABLE_FIELDS.map((field) => (
            <label key={field} className="text-sm text-slate-700">
              <span className="mb-1 block text-xs text-slate-500">{FIELD_LABELS[field]}</span>
              <input
                type="text"
                value={patch[field] ?? ''}
                onChange={(event) => handleChange(field, event.target.value)}
                disabled={!isAdmin || saving}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
              />
            </label>
          ))}
        </div>

        {reoWasSent && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p>
              Тикет уже отправлялся в РЭО. После сохранения статус останется{' '}
              <span className="font-semibold">sent</span>, но архивные данные могут
              разойтись с уже отправленным payload.
            </p>
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledgeReo}
                onChange={(event) => setAcknowledgeReo(event.target.checked)}
                disabled={!isAdmin || saving}
                className="mt-1"
              />
              <span>Подтверждаю правку при статусе РЭО sent</span>
            </label>
          </div>
        )}

        {!isAdmin && (
          <p className="mt-3 text-sm text-amber-700">Редактирование доступно только пользователю с ролью admin.</p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Закрыть
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isAdmin || saving || (reoWasSent && !acknowledgeReo)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
