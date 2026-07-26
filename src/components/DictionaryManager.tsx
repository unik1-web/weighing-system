import { useState } from 'react';
import { useDictionary } from '@/hooks/useDictionary';
import { DICTIONARY_LABELS, type DictionaryTable, type DictionaryEntry } from '@/lib/storage';
import { Plus, Trash2, Pencil, Check, X, Package, Truck, User, Building2, Users } from 'lucide-react';


const TABLE_ICONS: Record<DictionaryTable, typeof Package> = {
  vehicles: Truck,
  drivers: User,
  cargos: Package,
  shippers: Building2,
  receivers: Building2,
  carriers: Users,
};

interface Props {
  table: DictionaryTable;
}

export function DictionaryManager({ table }: Props) {
  const { entries, loading, error, add, update, remove } = useDictionary(table);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newTare, setNewTare] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newInn, setNewInn] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editTare, setEditTare] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editInn, setEditInn] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const Icon = TABLE_ICONS[table];
  const showPrice = table === 'cargos';
  const showTare = table === 'vehicles';
  const showBrand = table === 'vehicles';
  const showInn = table === 'shippers' || table === 'receivers' || table === 'carriers';
  const isVehicleTable = table === 'vehicles';
  const inputLabel = isVehicleTable ? 'Номер ТС' : 'Наименование';
  const placeholderLabel = isVehicleTable ? 'Номер ТС...' : 'Новое значение...';

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setFormError(null);
    
    // Проверка ИНН если поле показывается
    if (showInn) {
      const innError = validateInn(newInn);
      if (innError) {
        setFormError(innError);
        return;
      }
    }
    
    try {
      await add(newName, {
        ...(isVehicleTable ? { vehicle_number: newName.trim() } : {}),
        default_price: showPrice ? (newPrice ? parseFloat(newPrice) : null) : undefined,
        default_tare_weight: showTare ? (newTare ? parseFloat(newTare) : null) : undefined,
        vehicle_brand: showBrand ? newBrand.trim() : undefined,
        inn: showInn ? newInn.trim() : undefined,
      });
      setNewName('');
      setNewPrice('');
      setNewTare('');
      setNewBrand('');
      setNewInn('');
    } catch (err) {
      setFormError(formatError(err));
    }
  };

  const formatError = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') return JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
    return String(err);
  };

  const validateInn = (inn: string): string | null => {
    if (!inn.trim()) return null; // ИНН не обязателен
    const cleanInn = inn.trim();
    if (!/^\d+$/.test(cleanInn)) {
      return 'ИНН должен содержать только цифры';
    }
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      return 'ИНН должен быть 10 или 12 цифр';
    }
    return null;
  };

  const startEdit = (e: DictionaryEntry) => {
    setEditingId(e.id);
    setEditName(isVehicleTable ? e.vehicle_number ?? '' : e.name);
    setEditPrice(e.default_price?.toString() ?? '');
    setEditTare(e.default_tare_weight?.toString() ?? '');
    setEditBrand(e.vehicle_brand ?? '');
    setEditInn(e.inn ?? '');
    setFormError(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setFormError(null);
    
    // Проверка ИНН если поле показывается
    if (showInn) {
      const innError = validateInn(editInn);
      if (innError) {
        setFormError(innError);
        return;
      }
    }
    
    try {
      await update(editingId, {
        ...(isVehicleTable ? { vehicle_number: editName.trim() } : { name: editName.trim() }),
        default_price: showPrice ? (editPrice ? parseFloat(editPrice) : null) : undefined,
        default_tare_weight: showTare ? (editTare ? parseFloat(editTare) : null) : undefined,
        vehicle_brand: showBrand ? editBrand.trim() : undefined,
        inn: showInn ? editInn.trim() : undefined,
      } as Partial<DictionaryEntry>);
      setEditingId(null);
    } catch (err) {
      setFormError(formatError(err));
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">{DICTIONARY_LABELS[table]}</h2>
          <p className="text-xs text-slate-500">Справочник для выбора в выпадающем меню</p>
        </div>
      </div>

      {/* Add form */}
      <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={placeholderLabel}
            className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
          />
          {showPrice && (
            <input
              type="number"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="Цена за т"
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          )}
          {showTare && (
            <input
              type="number"
              value={newTare}
              onChange={(e) => setNewTare(e.target.value)}
              placeholder="Тара, кг"
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          )}
          {showBrand && (
            <input
              type="text"
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              placeholder="Марка"
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          )}
          {showInn && (
            <input
              type="text"
              value={newInn}
              onChange={(e) => setNewInn(e.target.value)}
              placeholder="ИНН"
              maxLength={12}
              className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          )}
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Добавить
          </button>
        </div>
        {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
      </div>

      {/* List */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">Загрузка...</div>
        ) : error ? (
          <div className="px-5 py-8 text-center text-sm text-red-600">{error}</div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">Список пуст. Добавьте первое значение.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-slate-100 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">Наименование</th>
                {showPrice && <th className="px-3 py-2.5 text-right font-medium">Цена за т</th>}
                {showTare && <th className="px-3 py-2.5 text-right font-medium">Тара, кг</th>}
                {showBrand && <th className="px-3 py-2.5 text-left font-medium">Марка</th>}
                {showInn && <th className="px-3 py-2.5 text-left font-medium">ИНН</th>}
                <th className="px-5 py-2.5 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/50 transition">
                  {editingId === e.id ? (
                    <>
                      <td className="px-5 py-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(ev) => setEditName(ev.target.value)}
                          onKeyDown={(ev) => ev.key === 'Enter' && saveEdit()}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                          autoFocus
                        />
                      </td>
                      {showPrice && (
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={editPrice}
                            onChange={(ev) => setEditPrice(ev.target.value)}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm text-right outline-none focus:border-blue-500"
                          />
                        </td>
                      )}
                      {showTare && (
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={editTare}
                            onChange={(ev) => setEditTare(ev.target.value)}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm text-right outline-none focus:border-blue-500"
                          />
                        </td>
                      )}
                      {showBrand && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={editBrand}
                            onChange={(ev) => setEditBrand(ev.target.value)}
                            className="w-full min-w-[100px] rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                          />
                        </td>
                      )}
                      {showInn && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={editInn}
                            onChange={(ev) => setEditInn(ev.target.value)}
                            maxLength={12}
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                          />
                        </td>
                      )}
                      <td className="px-5 py-2 text-right">
                        <button onClick={saveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={16} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X size={16} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-2.5 font-medium text-slate-700">{isVehicleTable ? e.vehicle_number : e.name}</td>
                      {showPrice && <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{e.default_price != null ? `${e.default_price.toLocaleString('ru-RU')} ₽` : '—'}</td>}
                      {showTare && <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{e.default_tare_weight != null ? `${e.default_tare_weight.toLocaleString('ru-RU')} кг` : '—'}</td>}
                      {showBrand && <td className="px-3 py-2.5 text-slate-600">{e.vehicle_brand || '—'}</td>}
                      {showInn && <td className="px-3 py-2.5 text-slate-600 tabular-nums">{e.inn || '—'}</td>}
                      <td className="px-5 py-2.5 text-right">
                        <button onClick={() => startEdit(e)} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Pencil size={15} /></button>
                        <button onClick={() => remove(e.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition ml-1"><Trash2 size={15} /></button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
