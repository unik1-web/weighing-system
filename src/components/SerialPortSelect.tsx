import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { fetchSerialPorts, type SerialPortInfo } from '@/lib/scales/backend-client';
import { normalizeSerialPath } from '@/lib/scales/serial-path';

interface Props {
  value: string;
  onChange: (port: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  allowManual?: boolean;
}

export function SerialPortSelect({
  value,
  onChange,
  disabled = false,
  className = '',
  inputClassName = '',
  allowManual = true,
}: Props) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchSerialPorts();
      setPorts(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Не удалось получить список портов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const normalizedValue = normalizeSerialPath(value);
  const hasKnownPort = ports.some((p) => p.device === normalizedValue);
  const selectValue = hasKnownPort ? normalizedValue : allowManual && normalizedValue ? '__manual__' : normalizedValue;

  return (
    <div className={className}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <select
            value={selectValue}
            disabled={disabled || loading}
            onChange={(e) => {
              const next = e.target.value;
              if (next === '__manual__') return;
              onChange(next);
            }}
            className={
              inputClassName ||
              'w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60'
            }
          >
            <option value="">— выберите COM-порт —</option>
            {ports.map((port) => (
              <option key={port.device} value={port.device}>
                {port.description ? `${port.device} — ${port.description}` : port.device}
              </option>
            ))}
            {allowManual && normalizedValue && !hasKnownPort && (
              <option value="__manual__">{normalizedValue} (вручную)</option>
            )}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void refresh()}
          title="Обновить список портов"
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {allowManual && (
        <input
          type="text"
          value={normalizedValue}
          disabled={disabled}
          onChange={(e) => onChange(normalizeSerialPath(e.target.value))}
          placeholder="COM3"
          className={
            inputClassName ||
            'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60'
          }
        />
      )}
      {loadError && <p className="mt-1 text-xs text-amber-700">{loadError}</p>}
      {!loadError && ports.length === 0 && !loading && (
        <p className="mt-1 text-xs text-slate-500">
          Порты не найдены. Проверьте кабель и драйвер USB‑RS232, затем нажмите обновить.
        </p>
      )}
    </div>
  );
}
