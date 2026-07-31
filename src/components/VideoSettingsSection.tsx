import { useCallback, useEffect, useState } from 'react';
import {
  CameraStorage,
  SettingsStorage,
  type AppSettings,
} from '@/lib/storage';
import {
  ApiRequestError,
  fetchCameraCapability,
  postCameraTest,
  type CameraCapabilityResponse,
} from '@/lib/api';
import { flushDatabaseSync } from '@/lib/storage-sync';
import { DEFAULT_SITE_ID } from '@/lib/site';
import {
  CAMERA_ROLE_LABELS,
  MAX_CAMERAS_PER_SITE,
  cameraFromDraft,
  canAddCamera,
  captureEtalonAndFlush,
  createEditCameraDraft,
  createEmptyCameraDraft,
  maskCameraUrl,
  validateCameraForm,
  type Camera,
  type CameraFormDraft,
  type CameraRole,
} from '@/lib/cameras';
import { Video, AlertCircle, Plus, Pencil, Trash2, Save, CheckCircle2, Camera as CameraIcon } from 'lucide-react';
import { logger } from '@/lib/logger';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600';

const ROLE_OPTIONS: CameraRole[] = ['entry', 'exit', 'overview'];

/**
 * Admin settings section «Видео и камеры»: capability, video_enabled (INI), CRUD камер.
 */
export function VideoSettingsSection() {
  const [capability, setCapability] = useState<CameraCapabilityResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(3);
  const [jpegQuality, setJpegQuality] = useState(80);
  const [draft, setDraft] = useState<CameraFormDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [cameraSaved, setCameraSaved] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testPreview, setTestPreview] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [etalonBusyKey, setEtalonBusyKey] = useState<string | null>(null);
  const [etalonPreview, setEtalonPreview] = useState<{
    cameraId: string;
    scaleSet: 'primary' | 'spare';
    dataUrl: string;
  } | null>(null);
  const [etalonError, setEtalonError] = useState<string | null>(null);

  const reloadCameras = useCallback(() => {
    setCameras(CameraStorage.getBySite(DEFAULT_SITE_ID));
  }, []);

  const loadVideoSettings = useCallback(() => {
    const settings = SettingsStorage.getAppSettings();
    setVideoEnabled(settings.video_enabled);
    setTimeoutSec(settings.camera_capture_timeout_sec);
    setJpegQuality(settings.camera_jpeg_quality);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchCameraCapability();
        if (cancelled) return;
        setCapability(result);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setCapability(null);
        setLoadError(error instanceof Error ? error.message : 'Не удалось получить capability');
      }
      if (!cancelled) {
        reloadCameras();
        loadVideoSettings();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadCameras, loadVideoSettings]);

  const available = capability?.available === true;

  const saveVideoSettings = () => {
    const updates: Partial<AppSettings> = {
      video_enabled: videoEnabled,
      camera_capture_timeout_sec: timeoutSec,
      camera_jpeg_quality: jpegQuality,
    };
    SettingsStorage.updateAppSettings(updates);
    logger.info('settings', 'Сохранены настройки видео', {
      video_enabled: videoEnabled,
      camera_capture_timeout_sec: timeoutSec,
      camera_jpeg_quality: jpegQuality,
    });
    setSettingsSaved(true);
    window.setTimeout(() => setSettingsSaved(false), 2500);
  };

  const openAddForm = () => {
    setFormError(null);
    setTestPreview(null);
    setTestError(null);
    if (!canAddCamera(cameras.length)) {
      setFormError(`На площадке допускается не более ${MAX_CAMERAS_PER_SITE} камер`);
      return;
    }
    const nextOrder =
      cameras.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
    setDraft(createEmptyCameraDraft(nextOrder));
  };

  const openEditForm = (camera: Camera) => {
    setFormError(null);
    setTestPreview(null);
    setTestError(null);
    setDraft(createEditCameraDraft(camera));
  };

  const cancelForm = () => {
    setDraft(null);
    setFormError(null);
    setTestPreview(null);
    setTestError(null);
  };

  const saveCamera = async () => {
    if (!draft) return;
    const errors = validateCameraForm(draft);
    if (errors.length > 0) {
      setFormError(errors.join('; '));
      return;
    }
    if (!draft.id && !canAddCamera(cameras.length)) {
      setFormError(`На площадке допускается не более ${MAX_CAMERAS_PER_SITE} камер`);
      return;
    }

    const existing = draft.id
      ? cameras.find((row) => row.id === draft.id) ?? null
      : null;
    const row = cameraFromDraft(draft, DEFAULT_SITE_ID, existing);
    CameraStorage.upsert(row);
    // Do not clear ticket_photos on the client when saving/removing cameras.
    try {
      await flushDatabaseSync();
    } catch (error) {
      logger.warn('settings', 'flush cameras after save failed', { error });
    }
    reloadCameras();
    setDraft(null);
    setFormError(null);
    setCameraSaved(true);
    window.setTimeout(() => setCameraSaved(false), 2500);
  };

  const deleteCamera = async (camera: Camera) => {
    if (!confirm(`Удалить камеру «${camera.name}»?`)) return;
    CameraStorage.remove(camera.id);
    // Backend best-effort removes Photo/etalons/{id}/ on sync replace.
    try {
      await flushDatabaseSync();
    } catch (error) {
      logger.warn('settings', 'flush cameras after delete failed', { error });
    }
    reloadCameras();
    if (draft?.id === camera.id) {
      cancelForm();
    }
  };

  const runTest = async () => {
    if (!draft) return;
    setTestBusy(true);
    setTestError(null);
    setTestPreview(null);
    try {
      const http = draft.http_url_dirty
        ? draft.http_snapshot_url.trim() || null
        : draft.original_http_snapshot_url;
      const rtsp = draft.rtsp_url_dirty
        ? draft.rtsp_url.trim() || null
        : draft.original_rtsp_url;
      const body =
        draft.id && !draft.http_url_dirty && !draft.rtsp_url_dirty
          ? { camera_id: draft.id, timeout_sec: timeoutSec }
          : {
              camera_id: draft.id ?? undefined,
              http_snapshot_url: http,
              rtsp_url: rtsp,
              timeout_sec: timeoutSec,
            };
      const result = await postCameraTest(body);
      if (result.preview_jpeg_base64) {
        setTestPreview(`data:image/jpeg;base64,${result.preview_jpeg_base64}`);
      } else {
        setTestError('Камера ответила без превью');
      }
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Ошибка проверки камеры';
      setTestError(message);
    } finally {
      setTestBusy(false);
    }
  };

  const runEtalonCapture = async (
    camera: Camera,
    scaleSet: 'primary' | 'spare',
  ) => {
    const busyKey = `${camera.id}:${scaleSet}`;
    setEtalonBusyKey(busyKey);
    setEtalonError(null);
    try {
      // Merge into CameraStorage happens inside captureEtalonAndFlush before flush.
      const result = await captureEtalonAndFlush(camera.id, scaleSet);
      reloadCameras();
      if (result.preview_jpeg_base64) {
        setEtalonPreview({
          cameraId: camera.id,
          scaleSet,
          dataUrl: `data:image/jpeg;base64,${result.preview_jpeg_base64}`,
        });
      }
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Ошибка съёмки эталона';
      setEtalonError(message);
      logger.warn('settings', 'etalon capture failed', {
        cameraId: camera.id,
        scaleSet,
        error,
      });
    } finally {
      setEtalonBusyKey(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <Video size={18} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800">Видео и камеры</h3>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {loadError}
        </div>
      )}

      {capability && !available && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
          Модуль камер недоступен в этой сборке
          {capability.build ? ` (${capability.build})` : ''}. CRUD камер и переключатель
          видео недоступны.
        </div>
      )}

      {!capability && !loadError && (
        <div className="text-sm text-slate-500">Проверка доступности модуля камер…</div>
      )}

      {capability && available && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 space-y-3">
            <div className="text-sm text-slate-700">
              Сборка: <span className="font-medium">{capability.build}</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={videoEnabled}
                onChange={(e) => setVideoEnabled(e.target.checked)}
                className="rounded border-slate-300"
              />
              Видео включено (video_enabled)
            </label>
            <p className="text-xs text-slate-500">
              Флаг сохраняется только в config.ini. Реестр камер при выключении не удаляется.
              Допускается 0 камер при включённом видео.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Таймаут захвата, сек</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(Number(e.target.value) || 3)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Качество JPEG (1–100)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={jpegQuality}
                  onChange={(e) => setJpegQuality(Number(e.target.value) || 80)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveVideoSettings}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Save size={14} />
                Сохранить настройки видео
              </button>
              {settingsSaved && (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                  <CheckCircle2 size={14} />
                  Сохранено
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-800">
                Камеры площадки ({cameras.length}/{MAX_CAMERAS_PER_SITE})
              </h4>
              <button
                type="button"
                onClick={openAddForm}
                disabled={!canAddCamera(cameras.length)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} />
                Добавить камеру
              </button>
            </div>
            {!canAddCamera(cameras.length) && (
              <p className="text-xs text-amber-700">
                Достигнут лимит {MAX_CAMERAS_PER_SITE} камер на площадке.
              </p>
            )}

            {cameras.length === 0 ? (
              <p className="text-sm text-slate-500">Камер пока нет. Можно сохранить пустой реестр.</p>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Имя</th>
                        <th className="px-3 py-2">Роль</th>
                        <th className="px-3 py-2">URL</th>
                        <th className="px-3 py-2">Вкл.</th>
                        <th className="px-3 py-2">Эталоны</th>
                        <th className="px-3 py-2">Порядок</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {cameras.map((camera) => (
                        <tr key={camera.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-800">{camera.name}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {CAMERA_ROLE_LABELS[camera.role]}
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-slate-600">
                            {maskCameraUrl(camera.http_snapshot_url || camera.rtsp_url)}
                          </td>
                          <td className="px-3 py-2">{camera.enabled ? 'да' : 'нет'}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                title="Снять эталон primary"
                                disabled={etalonBusyKey !== null}
                                onClick={() => void runEtalonCapture(camera, 'primary')}
                                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <CameraIcon size={12} />
                                {etalonBusyKey === `${camera.id}:primary`
                                  ? 'Съёмка…'
                                  : 'Снять эталон primary'}
                              </button>
                              <button
                                type="button"
                                title="Снять эталон spare"
                                disabled={etalonBusyKey !== null}
                                onClick={() => void runEtalonCapture(camera, 'spare')}
                                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <CameraIcon size={12} />
                                {etalonBusyKey === `${camera.id}:spare`
                                  ? 'Съёмка…'
                                  : 'Снять эталон spare'}
                              </button>
                              <div className="text-[10px] text-slate-500">
                                primary: {camera.etalon_primary_path ? 'есть' : 'нет'}
                                {' · '}
                                spare: {camera.etalon_spare_path ? 'есть' : 'нет'}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">{camera.sort_order}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                title="Изменить"
                                onClick={() => openEditForm(camera)}
                                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                title="Удалить камеру"
                                onClick={() => void deleteCamera(camera)}
                                className="rounded p-1 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {etalonError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {etalonError}
                  </div>
                )}
                {etalonPreview && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-600">
                      Превью эталона ({etalonPreview.scaleSet})
                    </p>
                    <img
                      src={etalonPreview.dataUrl}
                      alt={`Эталон ${etalonPreview.scaleSet}`}
                      className="max-h-40 rounded border border-slate-200"
                    />
                  </div>
                )}
              </div>
            )}
            {cameraSaved && (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                <CheckCircle2 size={14} />
                Камера сохранена
              </span>
            )}
          </div>

          {draft && (
            <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
              <h4 className="text-sm font-semibold text-slate-800">
                {draft.id ? 'Редактирование камеры' : 'Новая камера'}
              </h4>
              {formError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {formError}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Имя</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Роль</label>
                  <select
                    value={draft.role}
                    onChange={(e) =>
                      setDraft({ ...draft, role: e.target.value as CameraRole })
                    }
                    className={inputClass}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {CAMERA_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>HTTP snapshot URL</label>
                  <input
                    type="text"
                    value={draft.http_snapshot_url}
                    placeholder={
                      draft.original_http_snapshot_url
                        ? maskCameraUrl(draft.original_http_snapshot_url)
                        : 'http://…'
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        http_snapshot_url: e.target.value,
                        http_url_dirty: true,
                      })
                    }
                    className={inputClass}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Пароль в URL маскируется. Если поле не меняли — прежний секрет сохраняется.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>RTSP URL</label>
                  <input
                    type="text"
                    value={draft.rtsp_url}
                    placeholder={
                      draft.original_rtsp_url
                        ? maskCameraUrl(draft.original_rtsp_url)
                        : 'rtsp://…'
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        rtsp_url: e.target.value,
                        rtsp_url_dirty: true,
                      })
                    }
                    className={inputClass}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass}>Порядок</label>
                  <input
                    type="number"
                    value={draft.sort_order}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sort_order: Number(e.target.value) || 0,
                      })
                    }
                    className={inputClass}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) =>
                        setDraft({ ...draft, enabled: e.target.checked })
                      }
                      className="rounded border-slate-300"
                    />
                    Включена
                  </label>
                </div>
              </div>

              {draft.role === 'overview' && (
                <div className="grid gap-3 sm:grid-cols-4">
                  {(['roi_x', 'roi_y', 'roi_w', 'roi_h'] as const).map((field) => (
                    <div key={field}>
                      <label className={labelClass}>{field} [0..1]</label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step="any"
                        value={draft[field]}
                        onChange={(e) =>
                          setDraft({ ...draft, [field]: e.target.value })
                        }
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveCamera()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Save size={14} />
                  Сохранить камеру
                </button>
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={testBusy}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testBusy ? 'Проверка…' : 'Проверить'}
                </button>
                <button
                  type="button"
                  onClick={cancelForm}
                  className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Отмена
                </button>
              </div>

              {testError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {testError}
                </div>
              )}
              {testPreview && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">Превью</p>
                  <img
                    src={testPreview}
                    alt="Превью камеры"
                    className="max-h-40 rounded border border-slate-200"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
