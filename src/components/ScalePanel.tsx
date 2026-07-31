import { useEffect, useRef } from 'react';
import { useScale } from '@/hooks/useScale';
import type { Scale } from '@/lib/storage';
import { isCaptureAllowed } from '@/lib/weighing-mode';
import { Usb, Power, Activity, AlertCircle } from 'lucide-react';

interface Props {
  onCapture: (weight: number, raw: string) => void;
  label: string;
  capturedWeight: number | null;
  activeScale: Scale | null;
  stableMode?: boolean;
  onUnstableCapture?: () => void;
  onUnstableBlocked?: () => void;
}

export function ScalePanel({
  onCapture,
  label,
  capturedWeight,
  activeScale,
  stableMode = false,
  onUnstableCapture,
  onUnstableBlocked,
}: Props) {
  const { reading, connected, error, connect, disconnect, manualOnly, transport, status } = useScale();
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const canCapture = !!reading && isCaptureAllowed(reading.stable, stableMode);
  const selectedTransport = transport ?? (activeScale?.connection.transport === 'serial_backend' ? 'backend_api' : 'web_serial');
  const sourceLabel = selectedTransport === 'backend_api' ? 'Backend API' : 'Browser Web Serial';
  const unstableBlocked = !!reading && !reading.stable && !stableMode;
  const unstableAllowed = !!reading && !reading.stable && stableMode;
  const blockedNotifiedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!unstableBlocked || !reading) {
      blockedNotifiedAtRef.current = null;
      return;
    }
    if (blockedNotifiedAtRef.current === reading.captured_at) return;
    blockedNotifiedAtRef.current = reading.captured_at;
    onUnstableBlocked?.();
  }, [unstableBlocked, reading, onUnstableBlocked]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-white">
            <Activity size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Весовой прибор</h3>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
          {connected ? 'Подключён' : 'Отключён'}
        </span>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">Активный комплект</label>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
          {activeScale ? `${activeScale.name || activeScale.role} · ${activeScale.adapter_id}` : 'Не выбран'}
          <div className="mt-1 text-xs text-slate-500">
            Источник: {sourceLabel}
          </div>
          <div className="mt-1 text-xs text-slate-500">Статус runtime: {status}</div>
        </div>
      </div>

      {/* Digital display */}
      <div className="mb-4 rounded-xl bg-slate-900 px-4 py-5 font-mono">
        <div className="flex items-end justify-between">
          <div className="text-4xl font-bold tabular-nums text-emerald-400">
            {reading ? reading.weight.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : '——'}
          </div>
          <div className="text-sm text-emerald-600/70">{reading?.unit ?? 'kg'}</div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className={`px-2 py-0.5 rounded ${reading?.stable ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
            {reading ? (reading.stable ? 'СТАБИЛЕН' : 'ДВИЖЕНИЕ') : 'НЕТ ДАННЫХ'}
          </span>
          {reading?.negative && (
            <span className="px-2 py-0.5 rounded text-red-400 bg-red-500/10">МИНУС</span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {manualOnly && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Автосъём недоступен для текущей конфигурации. Доступен ручной ввод.</span>
        </div>
      )}

      {unstableBlocked && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Вес нестабилен: фиксация заблокирована, дождитесь стабилизации или введите вручную.</span>
        </div>
      )}

      {unstableAllowed && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Вес нестабилен: фиксация разрешена по настройке `stable_mode`.</span>
        </div>
      )}

      {!supported && selectedTransport === 'web_serial' && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Браузер не поддерживает Web Serial. Используйте Chrome или Edge.</span>
        </div>
      )}

      <div className="flex gap-2">
        {!connected ? (
          <button
            onClick={() => activeScale && connect(activeScale)}
            disabled={!activeScale || (!supported && activeScale?.connection.transport === 'web_serial')}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Usb size={16} /> Подключить
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100"
          >
            <Power size={16} /> Отключить
          </button>
        )}
        <button
          onClick={() => {
            if (!reading) return;
            if (!reading.stable && stableMode) {
              onUnstableCapture?.();
            }
            onCapture(reading.weight, reading.raw);
          }}
          disabled={!canCapture}
          className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Зафиксировать вес
        </button>
      </div>

      {(manualOnly || !!error) && (
        <button
          onClick={() => activeScale && connect(activeScale)}
          disabled={!activeScale}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Повторить подключение
        </button>
      )}

      {capturedWeight !== null && (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
          Зафиксировано: <strong>{capturedWeight.toLocaleString('ru-RU')} кг</strong> с прибора
        </div>
      )}
    </div>
  );
}
