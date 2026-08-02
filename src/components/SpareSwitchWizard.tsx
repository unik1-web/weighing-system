import { useEffect, useState } from 'react';
import {
  switchScaleSet,
  SWITCH_REASON_LABELS,
  type SwitchReason,
  type CameraAck,
} from '@/lib/site-runtime';
import { useAuth } from '@/hooks/useAuth';
import { AlertCircle, ArrowRight, CheckCircle2, X } from 'lucide-react';

interface Props {
  direction: 'to_spare' | 'to_primary';
  onDone: () => void;
  onCancel: () => void;
}

type SpareStep = 'reason' | 'terminal' | 'cameras' | 'anpr_info' | 'confirm';

const REASONS = Object.keys(SWITCH_REASON_LABELS) as SwitchReason[];

export function SpareSwitchWizard({ direction, onDone, onCancel }: Props) {
  const { user, displayName } = useAuth();
  const [step, setStep] = useState<SpareStep | 'primary_confirm'>(
    direction === 'to_spare' ? 'reason' : 'reason',
  );
  const [reason, setReason] = useState<SwitchReason | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [cameraAck, setCameraAck] = useState<CameraAck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStep('reason');
    setReason(null);
    setTerminalReady(false);
    setCameraAck(null);
    setError(null);
  }, [direction]);

  const operatorName = displayName || 'Оператор';
  const operatorId = user?.id ?? null;

  const runSwitch = (ack: CameraAck | null) => {
    if (!reason) {
      setError('Выберите причину переключения.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      switchScaleSet({
        to: direction === 'to_spare' ? 'spare' : 'primary',
        reason,
        operator_id: operatorId,
        operator_name: operatorName,
        camera_ack: direction === 'to_spare' ? ack : null,
      });
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось переключить комплект');
    } finally {
      setBusy(false);
    }
  };

  const title =
    direction === 'to_spare'
      ? 'Переключение на резервные весы'
      : 'Возврат на основные весы';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {direction === 'to_primary' ? (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Причина возврата</p>
                <div className="grid grid-cols-2 gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        reason === r
                          ? 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {SWITCH_REASON_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Камеры и ANPR вернутся к режиму основных весов. Подтвердите переключение.
              </p>
            </>
          ) : (
            <>
              {step === 'reason' && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">1. Причина переключения</p>
                  <div className="grid grid-cols-2 gap-2">
                    {REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReason(r)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          reason === r
                            ? 'border-blue-500 bg-blue-50 text-blue-800'
                            : 'border-slate-200 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {SWITCH_REASON_LABELS[r]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 'terminal' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-700">
                    2. Готовность резервного терминала
                  </p>
                  <p className="text-sm text-slate-600">
                    Убедитесь, что профиль резервных весов настроен и при необходимости
                    переподключите Web Serial к резервному терминалу.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={terminalReady}
                      onChange={(e) => setTerminalReady(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>Резервный терминал готов к работе</span>
                  </label>
                </div>
              )}

              {step === 'cameras' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-700">3. Камеры</p>
                  <p className="text-sm text-slate-600">
                    Выберите один вариант. Эталонные снимки не требуются.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                    <input
                      type="radio"
                      name="camera_ack"
                      checked={cameraAck === 'rotated'}
                      onChange={() => setCameraAck('rotated')}
                      className="mt-0.5"
                    />
                    <span>Камеры повёрнуты на резервные весы</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                    <input
                      type="radio"
                      name="camera_ack"
                      checked={cameraAck === 'no_cameras'}
                      onChange={() => setCameraAck('no_cameras')}
                      className="mt-0.5"
                    />
                    <span>Камер нет / будут позже</span>
                  </label>
                </div>
              )}

              {step === 'anpr_info' && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">4. ANPR на резерве</p>
                  <p className="text-sm text-slate-600">
                    На резервных весах распознавание номеров отключено конфигурацией.
                    Госномер вводится вручную или из справочника.
                  </p>
                </div>
              )}

              {step === 'confirm' && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">5. Подтверждение</p>
                  <p className="text-sm text-slate-600">
                    Причина: {reason ? SWITCH_REASON_LABELS[reason] : '—'}. После подтверждения
                    активным станет комплект резервных весов.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            disabled={busy}
          >
            Отмена
          </button>

          <div className="flex gap-2">
            {direction === 'to_spare' && step !== 'reason' && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  if (step === 'terminal') setStep('reason');
                  else if (step === 'cameras') setStep('terminal');
                  else if (step === 'anpr_info') setStep('cameras');
                  else if (step === 'confirm') setStep('anpr_info');
                }}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                disabled={busy}
              >
                Назад
              </button>
            )}

            {direction === 'to_primary' ? (
              <button
                type="button"
                disabled={busy || !reason}
                onClick={() => runSwitch(null)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                Подтвердить
              </button>
            ) : step === 'confirm' ? (
              <button
                type="button"
                disabled={busy || !reason || !cameraAck}
                onClick={() => runSwitch(cameraAck)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                Переключить
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  busy ||
                  (step === 'reason' && !reason) ||
                  (step === 'terminal' && !terminalReady) ||
                  (step === 'cameras' && !cameraAck)
                }
                onClick={() => {
                  setError(null);
                  if (step === 'reason') {
                    if (!reason) {
                      setError('Выберите причину переключения.');
                      return;
                    }
                    setStep('terminal');
                  } else if (step === 'terminal') {
                    if (!terminalReady) {
                      setError('Подтвердите готовность резервного терминала.');
                      return;
                    }
                    setStep('cameras');
                  } else if (step === 'cameras') {
                    if (!cameraAck) {
                      setError('Выберите вариант по камерам.');
                      return;
                    }
                    setStep('anpr_info');
                  } else if (step === 'anpr_info') {
                    setStep('confirm');
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Далее
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
