import { useEffect, useState, useCallback, useRef } from 'react';
import { DictionaryStorage, type DictionaryTable, type DictionaryEntry } from '@/lib/storage';
import { DICTIONARIES_UPDATED_EVENT } from '@/lib/storage-sync';

type LoadOptions = {
  silent?: boolean;
};

export function useDictionary<T extends DictionaryTable>(table: T) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef(table);

  tableRef.current = table;

  const load = useCallback(async (options?: LoadOptions) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = DictionaryStorage.getTable(tableRef.current);
      const normalized = data.map((row) => ({
        ...row,
        name: row.name || '',
      } as DictionaryEntry));
      setEntries(normalized);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    if (!silent) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, table]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load({ silent: true });
      }, 100);
    };

    window.addEventListener(DICTIONARIES_UPDATED_EVENT, handler);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(DICTIONARIES_UPDATED_EVENT, handler);
    };
  }, [load]);

  const add = useCallback(async (name: string, extra?: Partial<DictionaryEntry>) => {
    const ex = extra ?? {};
    const entry = DictionaryStorage.add(table, {
      name: name.trim(),
      notes: ex.notes ?? '',
      default_price: ex.default_price ?? undefined,
      default_tare_weight: ex.default_tare_weight ?? undefined,
      vehicle_brand: ex.vehicle_brand ?? undefined,
      vehicle_number: ex.vehicle_number ?? undefined,
      inn: ex.inn ?? undefined,
    });
    await load({ silent: true });
    return entry;
  }, [table, load]);

  const update = useCallback(async (id: string, patch: Partial<DictionaryEntry>) => {
    DictionaryStorage.update(table, id, patch);
    await load({ silent: true });
  }, [table, load]);

  const remove = useCallback(async (id: string) => {
    DictionaryStorage.delete(table, id);
    await load({ silent: true });
  }, [table, load]);

  return { entries, loading, error, reload: load, add, update, remove };
}
