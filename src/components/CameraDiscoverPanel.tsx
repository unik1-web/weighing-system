import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Camera, CameraRole, CaptureKind } from '@/lib/storage';
import {
  CAMERA_ROLE_LABELS,
  cancelDiscover,
  createCameraDraft,
  enforceMaxCameras,
  fetchDiscoverBrands,
  maskCameraUrl,
  photoUrl,
  pollDiscover,
  startDiscover,
  type CameraCapabilities,
  type DiscoverBrand,
  type DiscoverCandidate,
  type DiscoverSessionState,
} from '@/lib/cameras';

const POLL_MS = 600;
const CAMERAS_SUBTAB_KEY = 'app_cameras_subtab';

const labelClass = 'mb-1 block text-xs font-medium text-slate-600';
const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export type CamerasSubTab = 'registry' | 'discover';

export function readCamerasSubTab(): CamerasSubTab {
  try {
    const raw = sessionStorage.getItem(CAMERAS_SUBTAB_KEY);
    if (raw === 'registry' || raw === 'discover') return raw;
  } catch {
    // ignore
  }
  return 'registry';
}

export function writeCamerasSubTab(tab: CamerasSubTab): void {
  try {
    sessionStorage.setItem(CAMERAS_SUBTAB_KEY, tab);
  } catch {
    // ignore
  }
}

interface Props {
  siteId: string | null;
  cameras: Camera[];
  setCameras: Dispatch<SetStateAction<Camera[]>>;
  cameraCaps: CameraCapabilities | null;
  onDirty: () => void;
  onApplied?: () => void;
}

export function CameraDiscoverPanel({
  siteId,
  cameras,
  setCameras,
  cameraCaps,
  onDirty,
  onApplied,
}: Props) {
  const [ip, setIp] = useState('');
  const [httpPort, setHttpPort] = useState('80');
  const [rtspPort, setRtspPort] = useState('554');
  const [brand, setBrand] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  const [session, setSession] = useState<DiscoverSessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [applyCameraId, setApplyCameraId] = useState('');
  const [createRole, setCreateRole] = useState<CameraRole>('overview');
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void fetchDiscoverBrands().then(setBrands);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback(
    (sessionId: string) => {
      stopPolling();
      pollTimerRef.current = setTimeout(async () => {
        try {
          const state = await pollDiscover(sessionId);
          if (sessionIdRef.current !== sessionId) return;
          setSession(state);
          if (state.status === 'running') {
            schedulePoll(sessionId);
          } else {
            setBusy(false);
          }
        } catch (err) {
          if (sessionIdRef.current !== sessionId) return;
          setError(err instanceof Error ? err.message : 'Ошибка опроса поиска');
          setBusy(false);
        }
      }, POLL_MS);
    },
    [stopPolling],
  );

  useEffect(() => {
    return () => {
      stopPolling();
      const sid = sessionIdRef.current;
      if (sid) {
        void cancelDiscover(sid).catch(() => undefined);
      }
    };
  }, [stopPolling]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [session?.candidates?.length]);

  const candidates = session?.candidates ?? [];
  const selected: DiscoverCandidate | null =
    candidates.length > 0 ? candidates[Math.min(selectedIdx, candidates.length - 1)] : null;
  const previewPath = selected?.preview_path ?? candidates[0]?.preview_path ?? null;
  const previewSrc = photoUrl(previewPath);
  const running = busy || session?.status === 'running';

  const siteCameras = siteId ? cameras.filter((c) => c.site_id === siteId) : [];

  const onFind = async () => {
    setError(null);
    setApplyMessage(null);
    const trimmed = ip.trim();
    if (!trimmed) {
      setError('Укажите IP-адрес');
      return;
    }
    stopPolling();
    setBusy(true);
    setSession(null);
    try {
      const http_port = Number(httpPort) || 80;
      const rtsp_port = Number(rtspPort) || 554;
      const state = await startDiscover({
        ip: trimmed,
        username: username.trim(),
        password,
        brand: brand || null,
        http_port,
        rtsp_port,
      });
      sessionIdRef.current = state.session_id;
      setSession(state);
      if (state.status === 'running') {
        schedulePoll(state.session_id);
      } else {
        setBusy(false);
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Не удалось начать поиск');
    }
  };

  const onCancel = async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const state = await cancelDiscover(sid);
      setSession(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить поиск');
    } finally {
      setBusy(false);
      stopPolling();
    }
  };

  const applyToSelected = () => {
    if (!selected || !applyCameraId) return;
    const kind = (selected.kind === 'rtsp' ? 'rtsp' : 'http_snapshot') as CaptureKind;
    setCameras((prev) =>
      prev.map((c) =>
        c.id === applyCameraId
          ? { ...c, capture_url: selected.url, capture_kind: kind }
          : c,
      ),
    );
    onDirty();
    setApplyMessage('URL подставлен — нажмите «Сохранить»');
    onApplied?.();
  };

  const createNew = () => {
    if (!selected || !siteId) return;
    if (!enforceMaxCameras(siteId)) {
      setError('Не более 4 камер на площадку');
      return;
    }
    const kind = (selected.kind === 'rtsp' ? 'rtsp' : 'http_snapshot') as CaptureKind;
    const brandLabel =
      brands.find((b) => b.id === selected.brand)?.label ||
      selected.brand ||
      CAMERA_ROLE_LABELS[createRole];
    const draft = createCameraDraft(siteId, createRole);
    draft.capture_url = selected.url;
    draft.capture_kind = kind;
    draft.name = brandLabel;
    setCameras((prev) => [...prev, draft]);
    onDirty();
    setApplyMessage('Камера создана — нажмите «Сохранить»');
    onApplied?.();
  };

  const progress = session?.progress;
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : running
        ? 5
        : 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Укажите IP камеры, при необходимости бренд и учётную запись. Система переберёт известные
        шаблоны URL (HTTP, затем RTSP при наличии OpenCV). Пароль не сохраняется, пока вы не
        примените найденный URL к камере и не нажмёте «Сохранить».
        {cameraCaps && !cameraCaps.opencv_available && (
          <> RTSP сейчас недоступен (нет OpenCV) — будут проверены только HTTP snapshot.</>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>IP *</label>
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="192.168.1.64 или 192.168.1.64:8080"
            className={inputClass}
            disabled={running}
          />
        </div>
        <div>
          <label className={labelClass}>Порт HTTP</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={httpPort}
            onChange={(e) => setHttpPort(e.target.value)}
            className={inputClass}
            disabled={running}
          />
        </div>
        <div>
          <label className={labelClass}>Порт RTSP</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={rtspPort}
            onChange={(e) => setRtspPort(e.target.value)}
            className={inputClass}
            disabled={running}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Наименование (бренд)</label>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className={inputClass}
            disabled={running}
          >
            <option value="">Неизвестно / перебор</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Логин</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            className={inputClass}
            disabled={running}
          />
        </div>
        <div>
          <label className={labelClass}>Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
            disabled={running}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onFind()}
          disabled={running}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Найти
        </button>
        <button
          type="button"
          onClick={() => void onCancel()}
          disabled={!running}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Отмена
        </button>
      </div>

      {(running || (progress && progress.total > 0)) && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-600">
            <span className="truncate pr-2">{progress?.label || (running ? 'Поиск…' : '')}</span>
            <span className="shrink-0">
              {progress ? `${progress.current} из ${progress.total}` : ''}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      {session?.message && session.status !== 'running' && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {session.message}
          {session.skipped_rtsp ? ' (RTSP пропущен: нет OpenCV)' : ''}
        </p>
      )}
      {applyMessage && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {applyMessage}
        </p>
      )}

      {previewSrc && (
        <div>
          <label className={labelClass}>Превью</label>
          <img
            src={previewSrc}
            alt="Превью камеры"
            className="max-h-64 w-full rounded-lg border border-slate-200 object-contain bg-slate-50"
          />
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2">
          <label className={labelClass}>Найденные URL</label>
          <ul className="space-y-2">
            {candidates.map((c, idx) => (
              <li key={`${c.template_id}-${idx}`}>
                <button
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                    idx === selectedIdx
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-medium text-slate-800">
                    {c.brand} · {c.kind === 'rtsp' ? 'RTSP' : 'HTTP'}
                  </span>
                  <span className="mt-0.5 block break-all text-slate-600">
                    {maskCameraUrl(c.url)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="grid gap-2 sm:grid-cols-2 border-t border-slate-100 pt-3">
            <div>
              <label className={labelClass}>Подставить в камеру</label>
              <select
                value={applyCameraId}
                onChange={(e) => setApplyCameraId(e.target.value)}
                className={inputClass}
              >
                <option value="">— выберите —</option>
                {siteCameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.role} ({CAMERA_ROLE_LABELS[c.role]})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selected || !applyCameraId}
                onClick={applyToSelected}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Подставить в камеру
              </button>
            </div>
            <div>
              <label className={labelClass}>Создать камеру (роль)</label>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as CameraRole)}
                className={inputClass}
              >
                {(Object.keys(CAMERA_ROLE_LABELS) as CameraRole[]).map((role) => (
                  <option key={role} value={role}>
                    {CAMERA_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selected || !siteId || (siteId ? !enforceMaxCameras(siteId) : true)}
                onClick={createNew}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Создать камеру
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
