import { useEffect, useState, useCallback } from 'react';
import { DictionaryStorage, type DictionaryTable, type DictionaryEntry } from '@/lib/storage';
import type { DictionaryTable as DictionaryTableType, DictionaryEntry as DictionaryEntryType } from '@/lib/supabase';

export function useDictionary<T extends DictionaryTable>(table: T) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = DictionaryStorage.getTable(table);
      const normalized = data.map((row) => ({
        ...row,
        name: row.name || '',
      } as DictionaryEntry));
      setEntries(normalized);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [table]);

  useEffect(() => {
    load();
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
    await load();
    return entry;
  }, [table, load]);

  const update = useCallback(async (id: string, patch: Partial<DictionaryEntry>) => {
    DictionaryStorage.update(table, id, patch);
    await load();
  }, [table, load]);

  const remove = useCallback(async (id: string) => {
    DictionaryStorage.delete(table, id);
    await load();
  }, [table, load]);

  return { entries, loading, error, reload: load, add, update, remove };
}
