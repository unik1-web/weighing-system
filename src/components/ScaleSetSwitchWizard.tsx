import { useEffect, useMemo, useState } from 'react';
import {
  fetchCameraCapability,
  postCameraSnapshot,
  type CameraCapabilityResponse,
} from '@/lib/api';
import type { Camera } from '@/lib/cameras';
import {
  applyScaleSetSwitch,
  DEFAULT_SITE_ID,
  SWITCH_REASON_LABELS,
  SWITCH_REASONS,
} from '@/lib/site';
import {
  CameraStorage,
  ScaleStorage,
  SettingsStorage,
  type ScaleConnectionJson,
  type ScaleSet,
  type SwitchReason,
} from '@/lib/storage';
import { photoApiUrl } from '@/lib/ticket-photos-preview';
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

/** Live frame status for one camera during spare etalon comparison. */
export type SpareLiveStatus = 'pending' | 'ok' | 'failed';

export type SpareLiveFrame = {
  cameraId: string;
  status: SpareLiveStatus;
  dataUrl: string | null;
  error: string | null;
};

/**
 * Enabled cameras that have a spare etalon path (candidates for UC-06 comparison).
 */
export function selectEnabledSpareEtalonCameras(cameras: Camera[]): Camera[] {
  return cameras.filter(
    (row) =>
      row.enabled &&
      typeof row.etalon_spare_path === 'string' &&
      row.etalon_spare_path.trim().length > 0,
  );
}

/**
 * Whether the spare wizard should show etalon vs live comparison instead of text fallback.
 */
export function shouldShowSpareEtalonComparison(input: {
  videoEnabled: boolean;
  capabilityAvailable: boolean;
  etalonCameras: Camera[];
}): boolean {
  return (
    input.videoEnabled === true &&
    input.capabilityAvailable === true &&
    input.etalonCameras.length > 0
  );
}

/**
 * Fetch live JPEG frames via operator snapshot API (not admin /test).
 */
export async function fetchSpareLiveSnapshots(
  cameras: Array<{ id: string }>,
  snapshotFn: typeof postCameraSnapshot = postCameraSnapshot,
): Promise<SpareLiveFrame[]> {
  const results: SpareLiveFrame[] = [];
  for (const camera of cameras) {
    try {
      const response = await snapshotFn({ camera_id: camera.id });
      const b64 =
        typeof response.preview_jpeg_base64 === 'string' ? response.preview_jpeg_base64.trim() : '';
      if (!b64) {
        results.push({
          cameraId: camera.id,
          status: 'failed',
          dataUrl: null,
          error: 'Пустой кадр',
        });
        continue;
      }
      results.push({
        cameraId: camera.id,
        status: 'ok',
        dataUrl: `data:image/jpeg;base64,${b64}`,
        error: null,
      });
    } catch (err) {
      results.push({
        cameraId: camera.id,
        status: 'failed',
        dataUrl: null,
        error: err instanceof Error ? err.message : 'Снимок недоступен',
      });
    }
  }
  return results;
}

/** True when every requested live frame succeeded. */
export function allSpareLiveFramesOk(frames: SpareLiveFrame[]): boolean {
  return frames.length > 0 && frames.every((frame) => frame.status === 'ok');
}

type ComparisonPanelProps = {
  etalonCameras: Camera[];
  liveFrames: SpareLiveFrame[];
  liveLoading: boolean;
  stepCompared: boolean;
  onStepComparedChange: (value: boolean) => void;
  acceptedWithoutLive: boolean;
  onAcceptedWithoutLiveChange: (value: boolean) => void;
};

/**
 * Presentational block: spare etalon vs live snapshot for visual check.
 */
export function SpareEtalonComparisonPanel({
  etalonCameras,
  liveFrames,
  liveLoading,
  stepCompared,
  onStepComparedChange,
  acceptedWithoutLive,
  onAcceptedWithoutLiveChange,
}: ComparisonPanelProps) {
  const liveById = useMemo(() => {
    const map = new Map<string, SpareLiveFrame>();
    for (const frame of liveFrames) {
      map.set(frame.cameraId, frame);
    }
    return map;
  }, [liveFrames]);

  const liveFullyOk = !liveLoading && allSpareLiveFramesOk(liveFrames);
  const liveUnavailable = !liveLoading && liveFrames.some((frame) => frame.status === 'failed');

  return (
    <div
      className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
      data-testid="spare-etalon-comparison"
    >
      <p className="text-xs font-medium text-slate-700">Сверка ракурса с эталоном spare</p>
      <div className="space-y-3">
        {etalonCameras.map((camera) => {
          const etalonPath = camera.etalon_spare_path!;
          const live = liveById.get(camera.id);
          return (
            <div
              key={camera.id}
              className="grid grid-cols-2 gap-2"
              data-camera-id={camera.id}
              data-etalon-path={etalonPath}
            >
              <div>
                <div className="mb-1 text-[11px] text-slate-500">
                  Эталон spare — {camera.name}
                </div>
                <img
                  src={photoApiUrl(etalonPath)}
                  alt={`Эталон spare ${camera.name}`}
                  className="h-28 w-full rounded border border-slate-200 bg-white object-contain"
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-slate-500">Текущий кадр</div>
                {liveLoading && !live && (
                  <div className="flex h-28 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-xs text-slate-500">
                    Загрузка…
                  </div>
                )}
                {live?.status === 'ok' && live.dataUrl && (
                  <img
                    src={live.dataUrl}
                    alt={`Live ${camera.name}`}
                    className="h-28 w-full rounded border border-slate-200 bg-white object-contain"
                    data-live-ok="true"
                  />
                )}
                {live?.status === 'failed' && (
                  <div
                    className="flex h-28 items-center justify-center rounded border border-amber-200 bg-amber-50 px-2 text-center text-xs text-amber-800"
                    data-live-failed="true"
                  >
                    Текущий кадр недоступен
                    {live.error ? `: ${live.error}` : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {liveUnavailable && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Текущий кадр недоступен — эталон показан для справки.</span>
        </div>
      )}

      {liveFullyOk && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={stepCompared}
            onChange={(e) => onStepComparedChange(e.target.checked)}
            className="mt-0.5"
            data-testid="spare-etalon-compared"
          />
          <span>Сверил текущий ракурс с эталоном spare</span>
        </label>
      )}

      {liveUnavailable && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={acceptedWithoutLive}
            onChange={(e) => onAcceptedWithoutLiveChange(e.target.checked)}
            className="mt-0.5"
            data-testid="spare-accepted-without-live"
          />
          <span>Принял без live-сверки</span>
        </label>
      )}
    </div>
  );
}

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
  const [stepCompared, setStepCompared] = useState(false);
  const [acceptedWithoutLive, setAcceptedWithoutLive] = useState(false);
  const [reason, setReason] = useState<SwitchReason | ''>('');
  const [comment, setComment] = useState('');
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [capability, setCapability] = useState<CameraCapabilityResponse | null>(null);
  const [etalonCameras, setEtalonCameras] = useState<Camera[]>([]);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [comparisonReady, setComparisonReady] = useState(false);
  const [liveFrames, setLiveFrames] = useState<SpareLiveFrame[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);

  const targetScale = useMemo(
    () => (targetSet ? ScaleStorage.getByRole(DEFAULT_SITE_ID, targetSet) : null),
    [targetSet],
  );
  const targetManualOnly = targetScale ? !hasWorkingConfig(targetScale.connection) : false;

  const showEtalonComparison = useMemo(
    () =>
      comparisonReady &&
      shouldShowSpareEtalonComparison({
        videoEnabled,
        capabilityAvailable: capability?.available === true,
        etalonCameras,
      }),
    [comparisonReady, videoEnabled, capability, etalonCameras],
  );

  const visualStepDone = showEtalonComparison
    ? allSpareLiveFramesOk(liveFrames)
      ? stepCompared
      : acceptedWithoutLive
    : stepVisual;

  const reset = () => {
    setStepConfirm(false);
    setStepCameras(false);
    setStepVisual(false);
    setStepManualPlate(false);
    setStepCompared(false);
    setAcceptedWithoutLive(false);
    setReason('');
    setComment('');
    setFinalConfirm(false);
    setError(null);
    setSaving(false);
    setCapability(null);
    setEtalonCameras([]);
    setVideoEnabled(false);
    setComparisonReady(false);
    setLiveFrames([]);
    setLiveLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open || !isSpare) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const settings = SettingsStorage.getAppSettings();
      const cameras = selectEnabledSpareEtalonCameras(
        CameraStorage.getBySite(DEFAULT_SITE_ID),
      );
      let cap: CameraCapabilityResponse | null = null;
      try {
        cap = await fetchCameraCapability();
      } catch {
        cap = null;
      }
      if (cancelled) return;

      setVideoEnabled(settings.video_enabled === true);
      setEtalonCameras(cameras);
      setCapability(cap);
      setComparisonReady(true);

      const useComparison = shouldShowSpareEtalonComparison({
        videoEnabled: settings.video_enabled === true,
        capabilityAvailable: cap?.available === true,
        etalonCameras: cameras,
      });
      if (!useComparison) {
        setLiveFrames([]);
        setLiveLoading(false);
        return;
      }

      setLiveLoading(true);
      const frames = await fetchSpareLiveSnapshots(cameras);
      if (cancelled) return;
      setLiveFrames(frames);
      setLiveLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isSpare]);

  const spareReady = useMemo(
    () =>
      stepConfirm &&
      stepCameras &&
      visualStepDone &&
      stepManualPlate &&
      !!reason &&
      finalConfirm,
    [stepConfirm, stepCameras, visualStepDone, stepManualPlate, reason, finalConfirm],
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
      <div
        className={`w-full rounded-2xl border border-slate-200 bg-white shadow-xl ${
          showEtalonComparison ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
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

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
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

              {showEtalonComparison ? (
                <SpareEtalonComparisonPanel
                  etalonCameras={etalonCameras}
                  liveFrames={liveFrames}
                  liveLoading={liveLoading}
                  stepCompared={stepCompared}
                  onStepComparedChange={setStepCompared}
                  acceptedWithoutLive={acceptedWithoutLive}
                  onAcceptedWithoutLiveChange={setAcceptedWithoutLive}
                />
              ) : (
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={stepVisual}
                    onChange={(e) => setStepVisual(e.target.checked)}
                    className="mt-0.5"
                    data-testid="spare-text-visual-check"
                  />
                  <span>Эталоны недоступны — сверил визуально на месте / принимаю</span>
                </label>
              )}

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
            <p className="text-sm text-slate-600" data-testid="primary-switch-hint">
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
              Для выбранного комплекта автосъём недоступен. После переключения будет доступен ручной
              ввод.
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
