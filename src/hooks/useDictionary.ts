import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { DictionaryTable, DictionaryEntry } from '@/lib/supabase';

export function useDictionary<T extends DictionaryTable>(table: T) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const orderColumn = table === 'vehicles' ? 'vehicle_number' : 'name';
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderColumn, { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      const normalized = (data ?? []).map((row: unknown) => {
        const item = row as unknown as DictionaryEntry;
        if (table === 'vehicles') {
          return {
            ...item,
            vehicle_number: item.vehicle_number,
            name: item.vehicle_number ?? '',
          } as DictionaryEntry;
        }
        return item;
      });
      setEntries(normalized);
    }
    setLoading(false);
  }, [table]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async (name: string, extra?: Partial<DictionaryEntry>) => {
    const ex = extra ?? {};
    const payload: Record<string, unknown> = {
      notes: ex.notes ?? '',
      ...(table === 'vehicles' ? { vehicle_number: name.trim() } : { name: name.trim() }),
    };
    if ('default_price' in ex || table === 'cargos') {
      payload.default_price = ex.default_price ?? null;
    }
    if ('default_tare_weight' in ex || table === 'vehicles') {
      payload.default_tare_weight = ex.default_tare_weight ?? null;
    }
    if ('vehicle_brand' in ex || table === 'vehicles') {
      payload.vehicle_brand = ex.vehicle_brand ?? '';
    }
    if ('inn' in ex || table === 'shippers' || table === 'receivers' || table === 'carriers') {
      payload.inn = ex.inn ?? '';
    }
    const { data, error } = await supabase.from(table).insert(payload).select('*').single();
    if (error) throw error;
    await load();
    return data as DictionaryEntry;
  }, [table, load]);

  const update = useCallback(async (id: string, patch: Partial<DictionaryEntry>) => {
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) throw error;
    await load();
  }, [table, load]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    await load();
  }, [table, load]);

  return { entries, loading, error, reload: load, add, update, remove };
}
