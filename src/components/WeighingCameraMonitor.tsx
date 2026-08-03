/**
 * Live camera panes on the weighing screen for vehicle position control.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, Loader2, RefreshCw } from 'lucide-react';
import {
  CAMERA_ROLE_LABELS,
  fetchCapabilities,
  photoUrl,
  takeSnapshot,
  type CameraCapabilities,
} from '@/lib/cameras';
import {
  CamerasStorage,
  SettingsStorage,
  type Camera,
  type CameraRole,
} from '@/lib/storage';
import {
  getActiveScaleContext,
  SITE_RUNTIME_UPDATED_EVENT,
} from '@/lib/site-runtime';

const ROLE_ORDER: CameraRole[] = ['entry', 'overview', 'exit'];
const REFRESH_MS = 4000;

interface PaneState {
  path: string | null;
  error: string | null;
  busy: boolean;
  updatedAt: number | null;
}

function sortCameras(cams: Camera[]): Camera[] {
  return [...cams].sort((a, b) => {
    const ri = ROLE_ORDER.indexOf(a.role);
    const rj = ROLE_ORDER.indexOf(b.role);
    if (ri !== rj) return (ri === -1 ? 99 : ri) - (rj === -1 ? 99 : rj);
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru');
  });
}

function loadEnabledCameras(siteId: string): Camera[] {
  return sortCameras(
    CamerasStorage.forSite(siteId).filter((c) => c.enabled && !!c.capture_url.trim()),
  );
}

export function WeighingCameraMonitor({ className = '' }: { className?: string }) {
  const [videoEnabled, setVideoEnabled] = useState(
    () => SettingsStorage.getAppSettings().video_enabled,
  );
  const [siteId, setSiteId] = useState(() => getActiveScaleContext().site_id);
  const [cameras, setCameras] = useState<Camera[]>(() =>
    videoEnabled ? loadEnabledCameras(siteId) : [],
  );
  const [caps, setCaps] = useState<CameraCapabilities | null>(null);
  const [panes, setPanes] = useState<Record<string, PaneState>>({});
  const [paused, setPaused] = useState(false);
  const inFlight = useRef<Set<string>>(new Set());

  const refreshList = useCallback(() => {
    const settings = SettingsStorage.getAppSettings();
    const ctx = getActiveScaleContext();
    setVideoEnabled(settings.video_enabled);
    setSiteId(ctx.site_id);
    setCameras(settings.video_enabled ? loadEnabledCameras(ctx.site_id) : []);
  }, []);

  useEffect(() => {
    refreshList();
    void fetchCapabilities().then(setCaps);
    const onSite = () => refreshList();
    const onVis = () => setPaused(document.visibilityState === 'hidden');
    window.addEventListener(SITE_RUNTIME_UPDATED_EVENT, onSite);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener(SITE_RUNTIME_UPDATED_EVENT, onSite);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshList]);

  const snapOne = useCallback(async (cam: Camera) => {
    if (inFlight.current.has(cam.id)) return;
    inFlight.current.add(cam.id);
    setPanes((prev) => ({
      ...prev,
      [cam.id]: {
        path: prev[cam.id]?.path ?? null,
        error: prev[cam.id]?.error ?? null,
        busy: true,
        updatedAt: prev[cam.id]?.updatedAt ?? null,
      },
    }));
    try {
      const path = await takeSnapshot({
        captureUrl: cam.capture_url,
        captureKind: cam.capture_kind,
      });
      setPanes((prev) => ({
        ...prev,
        [cam.id]: {
          path: path ?? prev[cam.id]?.path ?? null,
          error: path ? null : 'Пустой ответ камеры',
          busy: false,
          updatedAt: path ? Date.now() : prev[cam.id]?.updatedAt ?? null,
        },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка снимка';
      setPanes((prev) => ({
        ...prev,
        [cam.id]: {
          path: prev[cam.id]?.path ?? null,
          error: message,
          busy: false,
          updatedAt: prev[cam.id]?.updatedAt ?? null,
        },
      }));
    } finally {
      inFlight.current.delete(cam.id);
    }
  }, []);

  const snapAll = useCallback(() => {
    for (const cam of cameras) {
      void snapOne(cam);
    }
  }, [cameras, snapOne]);

  useEffect(() => {
    if (!videoEnabled || cameras.length === 0 || paused) return;
    snapAll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      snapAll();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [videoEnabled, cameras, paused, snapAll]);

  if (!videoEnabled || cameras.length === 0) {
    return null;
  }

  const opencvHint =
    caps &&
    caps.opencv_available === false &&
    cameras.some(
      (c) =>
        c.capture_kind === 'rtsp' || c.capture_url.trim().toLowerCase().startsWith('rtsp://'),
    );

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CameraIcon size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Камеры на весах</h3>
        </div>
        <button
          type="button"
          onClick={() => snapAll()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          title="Обновить сейчас"
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Контроль положения автомобиля. Снимки обновляются примерно каждые {REFRESH_MS / 1000} с.
      </p>
      {opencvHint && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          Для RTSP нужен OpenCV (`pip install opencv-python-headless`). HTTP snapshot работает без него.
        </p>
      )}
      <div className="space-y-2">
        {cameras.map((cam) => {
          const pane = panes[cam.id];
          const src = photoUrl(pane?.path);
          return (
            <div
              key={cam.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-800">
                    {cam.name || CAMERA_ROLE_LABELS[cam.role]}
                  </div>
                  <div className="text-[10px] text-slate-500">{CAMERA_ROLE_LABELS[cam.role]}</div>
                </div>
                {pane?.busy && <Loader2 size={14} className="shrink-0 animate-spin text-slate-400" />}
              </div>
              <div className="relative aspect-video bg-slate-900/90">
                {src ? (
                  <img
                    src={src}
                    alt={cam.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-slate-400">
                    {pane?.error ? 'Нет кадра' : 'Ожидание снимка…'}
                  </div>
                )}
              </div>
              {pane?.error && (
                <p className="border-t border-rose-100 bg-rose-50 px-2 py-1 text-[10px] text-rose-700">
                  {pane.error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
