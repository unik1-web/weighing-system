import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DictionaryStorage,
  normalizeVehicleDictionaryPlates,
  DICTIONARY_TABLES,
} from '../storage';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

installLocalStorage();

beforeEach(() => {
  localStorage.clear();
  let n = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `id-${++n}`,
  });
});

describe('DictionaryStorage normalization', () => {
  it('normalizes vehicle plates and brands on add', () => {
    const entry = DictionaryStorage.add('vehicles', {
      name: 'A123BC',
      vehicle_number: 'A123BC',
      vehicle_brand: 'камаз 65115',
    });

    expect(entry.name).toBe('А123ВС56');
    expect(entry.vehicle_number).toBe('А123ВС56');
    expect(entry.vehicle_brand).toBe('Камаз 65115');
    expect(DictionaryStorage.getTable('vehicles')).toHaveLength(1);
  });

  it('formats driver names on add and update', () => {
    const created = DictionaryStorage.add('drivers', { name: 'иванов и.и.' });
    expect(created.name).toBe('Иванов И.И.');

    const updated = DictionaryStorage.update('drivers', created.id, { name: 'петров п.п.' });
    expect(updated?.name).toBe('Петров П.П.');
  });

  it('updates vehicle plate from either name or vehicle_number', () => {
    const created = DictionaryStorage.add('vehicles', {
      name: 'А111АА56',
      vehicle_number: 'А111АА56',
      vehicle_brand: 'Маз',
    });

    const byName = DictionaryStorage.update('vehicles', created.id, { name: 'B222BB77' });
    expect(byName?.vehicle_number).toBe('В222ВВ77');
    expect(byName?.name).toBe('В222ВВ77');

    const byNumber = DictionaryStorage.update('vehicles', created.id, {
      vehicle_number: 'C333CC99',
      vehicle_brand: 'урал',
    });
    expect(byNumber?.vehicle_number).toBe('С333СС99');
    expect(byNumber?.vehicle_brand).toBe('Урал');
  });

  it('returns null when updating a missing id', () => {
    expect(DictionaryStorage.update('cargos', 'missing', { name: 'Песок' })).toBeNull();
  });

  it('deletes a single entry', () => {
    const a = DictionaryStorage.add('cargos', { name: 'Песок' });
    DictionaryStorage.add('cargos', { name: 'Щебень' });
    DictionaryStorage.delete('cargos', a.id);
    const names = DictionaryStorage.getTable('cargos').map((item) => item.name);
    expect(names).toEqual(['Щебень']);
  });

  it('clearAll empties every dictionary table', () => {
    for (const table of DICTIONARY_TABLES) {
      DictionaryStorage.add(table, { name: `item-${table}` });
    }
    DictionaryStorage.clearAll();
    for (const table of DICTIONARY_TABLES) {
      expect(DictionaryStorage.getTable(table)).toEqual([]);
    }
  });
});

describe('normalizeVehicleDictionaryPlates', () => {
  it('rewrites dirty plates and reports whether anything changed', () => {
    localStorage.setItem(
      'app_vehicles',
      JSON.stringify([
        {
          id: 'v1',
          name: 'A 123 BC',
          vehicle_number: 'A 123 BC',
          created_at: '2026-07-28T10:00:00.000Z',
        },
        {
          id: 'v2',
          name: 'А456ВС77',
          vehicle_number: 'А456ВС77',
          created_at: '2026-07-28T10:00:00.000Z',
        },
      ]),
    );

    expect(normalizeVehicleDictionaryPlates()).toBe(true);
    const items = DictionaryStorage.getTable('vehicles');
    expect(items.find((item) => item.id === 'v1')?.vehicle_number).toBe('А123ВС56');
    expect(items.find((item) => item.id === 'v2')?.vehicle_number).toBe('А456ВС77');
    expect(normalizeVehicleDictionaryPlates()).toBe(false);
  });

  it('returns false for empty vehicles table', () => {
    expect(normalizeVehicleDictionaryPlates()).toBe(false);
  });
});
