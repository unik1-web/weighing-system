import { useEffect, useState, useCallback, useRef } from 'react';
import {
  scaleConnection,
  type ScaleReading,
  type ScaleDeviceId,
  type ScaleConnectionProfile,
} from '@/lib/scales';
import {
  getActiveScaleContext,
  SITE_RUNTIME_UPDATED_EVENT,
} from '@/lib/site-runtime';

export function useScale() {
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState(() => scaleConnection.getDeviceName());
  const reconnectHintRef = useRef(false);

  useEffect(() => {
    const offReading = scaleConnection.onReading((r) => setReading(r));
    const offStatus = scaleConnection.onStatusChange((c) => {
      setConnected(c);
      if (c) {
        setDeviceName(scaleConnection.getDeviceName());
        reconnectHintRef.current = false;
      }
    });
    const offError = scaleConnection.onError((message) => setError(message));
    return () => {
      offReading();
      offStatus();
      offError();
    };
  }, []);

  // After primary↔spare switch: disconnect and ask to reconnect under new profile.
  useEffect(() => {
    const onRuntimeUpdated = () => {
      if (!scaleConnection.isConnected()) return;
      void (async () => {
        await scaleConnection.disconnect();
        setReading(null);
        reconnectHintRef.current = true;
        setError('Подключите весы заново');
      })();
    };
    window.addEventListener(SITE_RUNTIME_UPDATED_EVENT, onRuntimeUpdated);
    return () => window.removeEventListener(SITE_RUNTIME_UPDATED_EVENT, onRuntimeUpdated);
  }, []);

  const connect = useCallback(
    async (adapterId?: ScaleDeviceId, connection?: ScaleConnectionProfile) => {
      setError(null);
      try {
        let id = adapterId;
        let conn = connection;
        if (id == null || conn == null) {
          const ctx = getActiveScaleContext();
          id = id ?? ctx.adapter_id;
          conn = conn ?? ctx.activeScale.connection;
        }
        await scaleConnection.connect(id, conn);
        setDeviceName(scaleConnection.getDeviceName());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    await scaleConnection.disconnect();
    setReading(null);
  }, []);

  return {
    reading,
    connected,
    error,
    connect,
    disconnect,
    deviceName,
  };
}
