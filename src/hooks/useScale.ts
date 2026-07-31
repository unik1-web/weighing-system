import { useMemo, useState, useCallback } from 'react';
import type { Scale } from '@/lib/storage';
import { ScaleRuntimeClient } from '@/lib/scale-runtime-client';

export function useScale() {
  const runtimeClient = useMemo(() => new ScaleRuntimeClient(), []);
  const [reading, setReading] = useState<{
    weight: number;
    stable: boolean;
    raw: string;
    captured_at: string;
  } | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOnly, setManualOnly] = useState(false);
  const [status, setStatus] = useState<'connected' | 'reading' | 'manual_only' | 'error' | 'disconnected'>('disconnected');
  const [transport, setTransport] = useState<'web_serial' | 'backend_api' | null>(null);

  const connect = useCallback(async (activeScale: Scale) => {
    setError(null);
    setManualOnly(false);
    setStatus('disconnected');
    try {
      const result = await runtimeClient.connect(activeScale);
      setTransport(result.mode);
      if (result.status === 'manual_only') {
        setConnected(false);
        setManualOnly(true);
        setReading(null);
        setStatus('manual_only');
        setError(runtimeClient.getStatus().error ?? null);
        return;
      }
      if (result.status === 'error') {
        setConnected(false);
        setError(runtimeClient.getStatus().error ?? 'Не удалось подключиться');
        setStatus('error');
        return;
      }
      setConnected(true);
      setStatus('connected');
      const nextReading = await runtimeClient.read(1000);
      if (nextReading) {
        setReading({
          weight: nextReading.value,
          stable: nextReading.stable,
          raw: nextReading.raw,
          captured_at: nextReading.captured_at,
        });
        setStatus('reading');
      } else {
        const runtimeStatus = runtimeClient.getStatus();
        setStatus(runtimeStatus.status);
        setConnected(runtimeStatus.status === 'connected' || runtimeStatus.status === 'reading');
        setManualOnly(runtimeStatus.status === 'manual_only');
        setError(runtimeStatus.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [runtimeClient]);

  const disconnect = useCallback(async () => {
    await runtimeClient.disconnect();
    setConnected(false);
    setManualOnly(false);
    setStatus('disconnected');
    setTransport(null);
    setReading(null);
    setError(null);
  }, [runtimeClient]);

  return { reading, connected, error, connect, disconnect, manualOnly, transport, status };
}
