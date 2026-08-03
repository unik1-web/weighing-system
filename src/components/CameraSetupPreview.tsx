/**
 * Live/test snapshot panel for camera setup in Settings.
 */
import { useCallback, useState } from 'react';
import { Eye, Loader2, RefreshCw } from 'lucide-react';
import { photoUrl, takeSnapshot } from '@/lib/cameras';
import type { Camera, CameraRoi } from '@/lib/storage';

interface Props {
  camera: Camera;
  /** Persist draft before snapshot-by-id; parent may upsert. */
  onBeforeCapture?: () => void;
  className?: string;
}

function RoiOverlay({ roi }: { roi: CameraRoi }) {
  const left = `${Math.max(0, Math.min(1, roi.x)) * 100}%`;
  const top = `${Math.max(0, Math.min(1, roi.y)) * 100}%`;
  const width = `${Math.max(0.01, Math.min(1 - roi.x, roi.w)) * 100}%`;
  const height = `${Math.max(0.01, Math.min(1 - roi.y, roi.h)) * 100}%`;
  return (
    <div
      className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]"
      style={{ left, top, width, height }}
      title="Область ROI"
    />
  );
}

export function CameraSetupPreview({ camera, onBeforeCapture, className = '' }: Props) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const runSnapshot = useCallback(async () => {
    if (!camera.capture_url.trim()) {
      setError('Укажите URL захвата');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onBeforeCapture?.();
      // Always use the form URL so unsaved edits are tested (server prefers camera_id from DB).
      const path = await takeSnapshot({
        captureUrl: camera.capture_url,
        captureKind: camera.capture_kind,
      });
      if (!path) {
        setError('Снимок не получен');
        return;
      }
      setPreviewPath(path);
      setCapturedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err: unknown) {
      setPreviewPath(null);
      setError(err instanceof Error ? err.message : 'Не удалось получить снимок');
    } finally {
      setBusy(false);
    }
  }, [camera.capture_url, camera.capture_kind, onBeforeCapture]);

  const src = photoUrl(previewPath);
  const refNormal = photoUrl(camera.reference_normal_path);
  const refSpare = photoUrl(camera.reference_spare_path);
  const showRoi = camera.role === 'overview' && camera.roi && src;

  return (
    <div className={`space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-700">Проверка изображения</div>
        <button
          type="button"
          disabled={busy || !camera.capture_url.trim()}
          onClick={() => void runSnapshot()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : previewPath ? <RefreshCw size={14} /> : <Eye size={14} />}
          {busy ? 'Съёмка…' : previewPath ? 'Обновить снимок' : 'Показать снимок'}
        </button>
      </div>

      <div className="relative aspect-video overflow-hidden rounded-md border border-slate-200 bg-slate-900/90">
        {src ? (
          <>
            <img
              src={src}
              alt={`Превью: ${camera.name || 'камера'}`}
              className="h-full w-full object-contain"
            />
            {showRoi && camera.roi ? <RoiOverlay roi={camera.roi} /> : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-slate-400">
            <Eye size={22} className="opacity-60" />
            <span>
              Нажмите «Показать снимок», чтобы проверить URL, ракурс
              {camera.role === 'overview' ? ' и ROI' : ''}.
            </span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 text-white">
            <Loader2 size={28} className="animate-spin" />
          </div>
        )}
      </div>

      {capturedAt && !error && (
        <p className="text-[11px] text-slate-500">Снимок обновлён: {capturedAt}</p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {(refNormal || refSpare) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
              Эталон primary
            </div>
            {refNormal ? (
              <img src={refNormal} alt="Эталон primary" className="aspect-video w-full object-cover" />
            ) : (
              <div className="flex aspect-video items-center justify-center text-[10px] text-slate-400">
                нет
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
              Эталон spare
            </div>
            {refSpare ? (
              <img src={refSpare} alt="Эталон spare" className="aspect-video w-full object-cover" />
            ) : (
              <div className="flex aspect-video items-center justify-center text-[10px] text-slate-400">
                нет
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
