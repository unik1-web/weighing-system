import { useState, useEffect, useCallback } from 'react';
import { useScale } from '@/hooks/useScale';
import {
  WebSerialTransport,
  fetchScaleReading,
  normalizeSerialPath,
  type ScaleConnectionProfile,
  type ScaleDeviceId,
  type ScaleTransportKind,
} from '@/lib/scales';
import { getActiveScaleContext, SITE_RUNTIME_UPDATED_EVENT } from '@/lib/site-runtime';
import { isCaptureAllowed } from '@/lib/weighing-mode';
import { Usb, Power, Activity, AlertCircle } from 'lucide-react';

interface Props {
  onCapture: (weight: number, raw: string) => void;
  label: string;
  capturedWeight: number | null;
  stableMode?: boolean;
  onUnstableCapture?: () => void;
  /** Live instrument weight for dual-mode threshold hints (null when disconnected). */
  onReadingChange?: (weight: number | null) => void;
}

function readActiveTransportAndPath(): {
  transport: ScaleTransportKind;
  serialPath: string;
  connection: ScaleConnectionProfile;
  adapter_id: ScaleDeviceId;
} {
  const ctx = getActiveScaleContext();
  const transport = (ctx.activeScale.connection.transport ?? 'web_serial') as ScaleTransportKind;
  return {
    transport,
    serialPath: normalizeSerialPath(ctx.activeScale.connection.serialPath),
    connection: ctx.activeScale.connection,
    adapter_id: ctx.adapter_id,
  };
}

export function ScalePanel({
  onCapture,
  label,
  capturedWeight,
  stableMode = false,
  onUnstableCapture,
  onReadingChange,
}: Props) {
  const { reading, connected, error, connect, disconnect } = useScale();
  const [webSerialSupported] = useState(() => WebSerialTransport.isSupported());
  const [transport, setTransport] = useState<ScaleTransportKind>(() => {
    try {
      return readActiveTransportAndPath().transport;
    } catch {
      return 'web_serial';
    }
  });
  const [ioHint, setIoHint] = useState<string | null>(null);
  const canCapture = !!reading && isCaptureAllowed(reading.stable, stableMode);

  const refreshTransport = useCallback(() => {
    try {
      setTransport(readActiveTransportAndPath().transport);
    } catch {
      setTransport('web_serial');
    }
  }, []);

  useEffect(() => {
    refreshTransport();
    window.addEventListener(SITE_RUNTIME_UPDATED_EVENT, refreshTransport);
    return () => window.removeEventListener(SITE_RUNTIME_UPDATED_EVENT, refreshTransport);
  }, [refreshTransport, connected]);

  useEffect(() => {
    if (!connected || reading) {
      setIoHint(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetchScaleReading();
          if (!res.connected || res.reading) return;
          const bytes = res.bytes_received ?? 0;
          if (bytes === 0) {
            setIoHint(
              'Порт открыт, но байты не приходят. Закройте другую программу на COM3. Для Микросим: PU.6=1 (копия индикатора) или оставьте команду запроса $. DTR должен быть включён (уже).',
            );
            return;
          }
          if (res.last_raw_line) {
            setIoHint(
              `Данные приходят (${bytes} байт), но вес не разобран. Последняя строка: «${res.last_raw_line.slice(0, 60)}». Для Микросим проверьте окончание строки \\r в настройках.`,
            );
            return;
          }
          setIoHint(`Порт открыт, получено ${bytes} байт — ожидание полной строки от весов.`);
        } catch {
          /* ignore */
        }
      })();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [connected, reading]);

  const needsWebSerial = transport === 'web_serial';
  const usesBackendSerial = transport === 'serial';

  let canConnect = true;
  if (needsWebSerial) {
    canConnect = webSerialSupported;
  } else if (usesBackendSerial) {
    try {
      canConnect = !!readActiveTransportAndPath().serialPath;
    } catch {
      canConnect = false;
    }
  }

  const handleConnect = useCallback(async () => {
    const { adapter_id, connection } = readActiveTransportAndPath();
    await connect(adapter_id, connection);
  }, [connect]);

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

      {ioHint && !error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{ioHint}</span>
        </div>
      )}

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
            onClick={() => void handleConnect()}
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

      {!connected && usesBackendSerial && !canConnect && (
        <p className="mt-2 text-xs text-slate-500">Укажите COM-порт в Настройках</p>
      )}

      {capturedWeight !== null && (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
          Зафиксировано: <strong>{capturedWeight.toLocaleString('ru-RU')} кг</strong> с прибора
        </div>
      )}
    </div>
  );
}
