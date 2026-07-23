import { useEffect, useState, useCallback } from 'react';
import { scaleConnection, type ScaleReading, type ScaleDeviceId } from '@/lib/scales';

export function useScale() {
  const [reading, setReading] = useState<ScaleReading | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offReading = scaleConnection.onReading((r) => setReading(r));
    const offStatus = scaleConnection.onStatusChange((c) => setConnected(c));
    return () => { offReading(); offStatus(); };
  }, []);

  const connect = useCallback(async (deviceId: ScaleDeviceId) => {
    setError(null);
    try {
      await scaleConnection.connect(deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const disconnect = useCallback(async () => {
    await scaleConnection.disconnect();
    setReading(null);
  }, []);

  return { reading, connected, error, connect, disconnect, deviceName: scaleConnection.getDeviceName() };
}
