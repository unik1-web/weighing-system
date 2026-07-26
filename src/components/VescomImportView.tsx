import { useMemo, useState } from 'react';
import {
  SettingsStorage,
  TicketStorage,
  type WeighingTicket,
} from '@/lib/storage';
import {
  apiGet,
  ticketImportKey,
  vescomImportKey,
  type VescomWeighingItem,
} from '@/lib/api';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Database,
  Download,
  Loader2,
} from 'lucide-react';

interface Props {
  onImported: () => void;
}

function parseVescomDateTime(value: string): string | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildTicketFromVescom(item: VescomWeighingItem): Omit<
  WeighingTicket,
  'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'
> {
  const grossDatetime = parseVescomDateTime(item.datetimebrutto);
  const tareDatetime = parseVescomDateTime(item.datetimetara);
  const completedAt = tareDatetime ?? grossDatetime ?? new Date().toISOString();

  return {
    vehicle_number: item.vehicle_number,
    vehicle_brand: item.vehicle_brand,
    trailer_number: '',
    driver_name: '—',
    cargo_name: item.cargo_name,
    shipper_name: '—',
    receiver_name: item.receiver_name || '—',
    carrier_name: '—',
    price: 0,
    vat_rate: 20,
    gross_weight: item.gross_weight,
    tare_weight: item.tare_weight,
    net_weight: item.net_weight,
    total_amount: null,
    gross_source: 'manual',
    tare_source: 'manual',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: grossDatetime,
    tare_datetime: tareDatetime,
    scale_device: 'Vescom',
    operator_id: null,
    operator_name: 'Импорт Vescom',
    status: 'completed',
    notes: 'Импортировано из Vescom',
    completed_at: completedAt,
  };
}

export function VescomImportView({ onImported }: Props) {
  const settings = SettingsStorage.getAppSettings();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<VescomWeighingItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const existingKeys = useMemo(() => {
    return new Set(
      TicketStorage.getAll().map((ticket) =>
        ticketImportKey({
          gross_datetime: ticket.gross_datetime,
          tare_datetime: ticket.tare_datetime,
          vehicle_number: ticket.vehicle_number,
        }),
      ),
    );
  }, [items, importing, success]);

  const importableItems = useMemo(
    () => items.filter((item) => !existingKeys.has(vescomImportKey(item))),
    [items, existingKeys],
  );

  const loadData = async () => {
    setError(null);
    setSuccess(null);

    if (!settings.vescom_db_path.trim()) {
      setError('Укажите путь к базе Vescom в настройках и сохраните их');
      return;
    }

    setLoading(true);
    try {
      const response = await apiGet<{ success: true; items: VescomWeighingItem[] }>(
        '/api/vescom/weighing_data',
        {
          date,
          db_path: settings.vescom_db_path.trim(),
          user: settings.vescom_db_user.trim() || 'SYSDBA',
          password: settings.vescom_db_password || 'masterkey',
        },
      );
      setItems(response.items);
      setSelectedKeys(new Set(response.items.map(vescomImportKey)));
    } catch (err: any) {
      setItems([]);
      setSelectedKeys(new Set());
      setError(err.message ?? 'Не удалось загрузить данные из Vescom');
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(importableItems.map(vescomImportKey)));
  };

  const toggleItem = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleImport = async () => {
    setError(null);
    setSuccess(null);

    const selectedItems = items.filter(
      (item) => selectedKeys.has(vescomImportKey(item)) && !existingKeys.has(vescomImportKey(item)),
    );

    if (selectedItems.length === 0) {
      setError('Выберите записи для импорта');
      return;
    }

    setImporting(true);
    try {
      selectedItems.forEach((item) => {
        TicketStorage.create(buildTicketFromVescom(item));
      });
      setSuccess(`Импортировано записей: ${selectedItems.length}`);
      onImported();
      await loadData();
    } catch (err: any) {
      setError(err.message ?? 'Ошибка импорта');
    } finally {
      setImporting(false);
    }
  };

  const inputClass =
    'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database size={22} className="text-blue-600" />
        <div>
          <h2 className="text-lg font-bold text-slate-800">Импорт из Vescom</h2>
          <p className="text-xs text-slate-500">
            Загрузка завершённых взвешиваний из Firebird-базы Vescom через локальный API.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Дата</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Calendar size={16} />}
          Загрузить
        </button>
        <button
          onClick={handleImport}
          disabled={importing || importableItems.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Импортировать выбранные
        </button>
      </div>

      {!settings.vescom_db_path.trim() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Укажите путь к базе Vescom в разделе «Настройки» и запустите backend: <code>python server/app.py</code>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> {success}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={importableItems.length > 0 && selectedKeys.size === importableItems.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Дата брутто</th>
                <th className="px-4 py-3 text-left font-medium">Дата тары</th>
                <th className="px-4 py-3 text-left font-medium">Авто</th>
                <th className="px-4 py-3 text-left font-medium">Марка</th>
                <th className="px-4 py-3 text-left font-medium">Получатель</th>
                <th className="px-4 py-3 text-right font-medium">Брутто</th>
                <th className="px-4 py-3 text-right font-medium">Тара</th>
                <th className="px-4 py-3 text-right font-medium">Нетто</th>
                <th className="px-4 py-3 text-left font-medium">Груз</th>
                <th className="px-4 py-3 text-center font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">Загрузка...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">Нет данных за выбранную дату</td></tr>
              ) : (
                items.map((item) => {
                  const key = vescomImportKey(item);
                  const alreadyImported = existingKeys.has(key);
                  return (
                    <tr key={key} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          disabled={alreadyImported}
                          onChange={(e) => toggleItem(key, e.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{item.datetimebrutto}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{item.datetimetara}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-700">{item.vehicle_number}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.vehicle_brand}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.receiver_name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.gross_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.tare_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{item.net_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.cargo_name}</td>
                      <td className="px-4 py-2.5 text-center">
                        {alreadyImported ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Уже в журнале</span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Новая</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
