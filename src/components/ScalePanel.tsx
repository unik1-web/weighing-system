import { useState, useEffect, useMemo } from 'react';
import { useScale } from '@/hooks/useScale';
import { ADAPTER_LIST, WebSerialTransport, type ScaleDeviceId } from '@/lib/scales';
import { getActiveScaleContext } from '@/lib/site-runtime';
import { isCaptureAllowed } from '@/lib/weighing-mode';
import { Usb, Power, Activity, AlertCircle, ChevronDown } from 'lucide-react';

interface Props {
  onCapture: (weight: number, raw: string) => void;
  label: string;
  capturedWeight: number | null;
  deviceId: ScaleDeviceId;
  onDeviceChange: (id: ScaleDeviceId) => void;
  stableMode?: boolean;
  onUnstableCapture?: () => void;
  /** Live instrument weight for dual-mode threshold hints (null when disconnected). */
  onReadingChange?: (weight: number | null) => void;
}

export function ScalePanel({
  onCapture,
  label,
  capturedWeight,
  deviceId,
  onDeviceChange,
  stableMode = false,
  onUnstableCapture,
  onReadingChange,
}: Props) {
  const { reading, connected, error, connect, disconnect } = useScale();
  const [webSerialSupported] = useState(() => WebSerialTransport.isSupported());
  const canCapture = !!reading && isCaptureAllowed(reading.stable, stableMode);

  const transport = useMemo(() => {
    try {
      return getActiveScaleContext().activeScale.connection.transport ?? 'web_serial';
    } catch {
      return 'web_serial' as const;
    }
  }, [deviceId, connected]);

  const needsWebSerial = transport === 'web_serial';
  const canConnect = needsWebSerial ? webSerialSupported : true;

  useEffect(() => {
    onReadingChange?.(reading ? reading.weight : null);
  }, [reading, onReadingChange]);

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
        <label className="block text-xs font-medium text-slate-600 mb-1">Модель прибора</label>
        <div className="relative">
          <select
            value={deviceId}
            onChange={(e) => onDeviceChange(e.target.value as ScaleDeviceId)}
            disabled={connected}
            className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
          >
            {ADAPTER_LIST.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

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

      {needsWebSerial && !webSerialSupported && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>Браузер не поддерживает Web Serial. Используйте Chrome или Edge, либо транспорт TCP в настройках комплекта.</span>
        </div>
      )}

      <div className="flex gap-2">
        {!connected ? (
          <button
            onClick={() => connect()}
            disabled={!canConnect}
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

      {capturedWeight !== null && (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
          Зафиксировано: <strong>{capturedWeight.toLocaleString('ru-RU')} кг</strong> с прибора
        </div>
      )}
    </div>
  );
}
