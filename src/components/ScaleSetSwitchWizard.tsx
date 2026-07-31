import { useMemo, useState } from 'react';
import {
  applyScaleSetSwitch,
  DEFAULT_SITE_ID,
  SWITCH_REASON_LABELS,
  SWITCH_REASONS,
} from '@/lib/site';
import { ScaleStorage, type ScaleConnectionJson, type ScaleSet, type SwitchReason } from '@/lib/storage';
import { AlertCircle, ArrowLeftRight, CheckCircle2, X } from 'lucide-react';

interface Props {
  open: boolean;
  targetSet: ScaleSet | null;
  operatorName: string;
  operatorId: string | null;
  onClose: () => void;
  onApplied: () => void;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600';

function hasWorkingConfig(connection: ScaleConnectionJson): boolean {
  if (connection.transport === 'web_serial') {
    return Boolean(connection.device_id);
  }
  if (connection.transport === 'serial_backend') {
    return Boolean(connection.serial?.port);
  }
  if (connection.transport === 'tcp_client') {
    return Boolean(connection.tcp?.host && connection.tcp?.port);
  }
  return false;
}

export function ScaleSetSwitchWizard({
  open,
  targetSet,
  operatorName,
  operatorId,
  onClose,
  onApplied,
}: Props) {
  const isSpare = targetSet === 'spare';
  const [stepConfirm, setStepConfirm] = useState(false);
  const [stepCameras, setStepCameras] = useState(false);
  const [stepVisual, setStepVisual] = useState(false);
  const [stepManualPlate, setStepManualPlate] = useState(false);
  const [reason, setReason] = useState<SwitchReason | ''>('');
  const [comment, setComment] = useState('');
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const targetScale = useMemo(
    () => (targetSet ? ScaleStorage.getByRole(DEFAULT_SITE_ID, targetSet) : null),
    [targetSet],
  );
  const targetManualOnly = targetScale ? !hasWorkingConfig(targetScale.connection) : false;

  const reset = () => {
    setStepConfirm(false);
    setStepCameras(false);
    setStepVisual(false);
    setStepManualPlate(false);
    setReason('');
    setComment('');
    setFinalConfirm(false);
    setError(null);
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const spareReady = useMemo(
    () =>
      stepConfirm &&
      stepCameras &&
      stepVisual &&
      stepManualPlate &&
      !!reason &&
      finalConfirm,
    [stepConfirm, stepCameras, stepVisual, stepManualPlate, reason, finalConfirm],
  );

  const primaryReady = useMemo(() => !!reason && finalConfirm, [reason, finalConfirm]);

  const handleApply = () => {
    if (!targetSet) return;
    setError(null);
    if (isSpare && !spareReady) {
      setError('Отметьте все пункты чеклиста и выберите причину.');
      return;
    }
    if (!isSpare && !primaryReady) {
      setError('Выберите причину и подтвердите переключение.');
      return;
    }
    setSaving(true);
    try {
      const result = applyScaleSetSwitch({
        to_set: targetSet,
        reason,
        comment: reason === 'other' ? comment : null,
        operator_name: operatorName,
        operator_id: operatorId,
        checklist_confirmed: true,
      });
      setSaving(false);
      if (!result.applied) {
        if (result.from_set && result.to_set && result.from_set === result.to_set) {
          setError('Выбранный комплект уже активен. Переключение не требуется.');
        } else {
          setError('Переключение не выполнено: проверьте входные данные.');
        }
        return;
      }
      reset();
      onApplied();
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : 'Ошибка переключения');
    }
  };

  if (!open || !targetSet) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={18} className="text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              {isSpare ? 'Переключение на резервные весы' : 'Переключение на основные весы'}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {isSpare ? (
            <>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={stepConfirm}
                  onChange={(e) => setStepConfirm(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Подтверждаю переход на резервные весы</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={stepCameras}
                  onChange={(e) => setStepCameras(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Камеры повёрнуты на резерв либо камеры отсутствуют / не используются — пропускаю
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={stepVisual}
                  onChange={(e) => setStepVisual(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Эталоны недоступны — сверил визуально на месте / принимаю</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={stepManualPlate}
                  onChange={(e) => setStepManualPlate(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Номер ТС буду вводить вручную (ANPR на резерве выключен конфигурацией)</span>
              </label>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Возврат на основные весы. Укажите причину и подтвердите переключение.
            </p>
          )}

          <div>
            <label className={labelClass}>Причина переключения *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as SwitchReason | '')}
              className={inputClass}
            >
              <option value="">Выберите причину</option>
              {SWITCH_REASONS.map((key) => (
                <option key={key} value={key}>
                  {SWITCH_REASON_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {reason === 'other' && (
            <div>
              <label className={labelClass}>Комментарий (необязательно)</label>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className={inputClass}
                placeholder="Краткий комментарий"
              />
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={finalConfirm}
              onChange={(e) => setFinalConfirm(e.target.checked)}
              className="mt-0.5"
            />
            <span>Подтверждаю переключение комплекта</span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {targetManualOnly && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              Для выбранного комплекта автосъём недоступен. После переключения будет доступен ручной ввод.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={saving || (isSpare ? !spareReady : !primaryReady)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <CheckCircle2 size={16} />
            {saving ? 'Переключение...' : 'Переключить'}
          </button>
        </div>
      </div>
    </div>
  );
}
