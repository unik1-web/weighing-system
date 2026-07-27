import { useMemo, useState } from 'react';
import {
  SettingsStorage,
  TicketStorage,
  type WeighingTicket,
} from '@/lib/storage';
import {
  apiGet,
  metraImportKey,
  ticketImportKey,
  type MetraWeighingItem,
} from '@/lib/api';
import { logger } from '@/lib/logger';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Scale,
  Download,
  Loader2,
} from 'lucide-react';

interface Props {
  onImported: () => void;
}

function parseMetraDateTime(value: string): string | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function metraJournalKey(item: MetraWeighingItem): string {
  return ticketImportKey({
    gross_datetime: parseMetraDateTime(item.datetimebrutto),
    tare_datetime: parseMetraDateTime(item.datetimetara),
    vehicle_number: item.vehicle_number,
  });
}

function buildTicketFromMetra(item: MetraWeighingItem): Omit<
  WeighingTicket,
  'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'
> {
  const grossDatetime = parseMetraDateTime(item.datetimebrutto);
  const tareDatetime = parseMetraDateTime(item.datetimetara);
  const completedAt = tareDatetime ?? grossDatetime ?? new Date().toISOString();

  return {
    vehicle_number: item.vehicle_number,
    vehicle_brand: '',
    trailer_number: '',
    driver_name: '—',
    cargo_name: item.cargo_name,
    shipper_name: '—',
    receiver_name: '—',
    carrier_name: '—',
    price: 0,
    vat_rate: 20,
    gross_weight: item.gross_weight,
    tare_weight: item.tare_weight,
    net_weight: item.net_weight,
    total_amount: null,
    gross_source: 'instrument',
    tare_source: 'instrument',
    gross_raw: null,
    tare_raw: null,
    gross_datetime: grossDatetime,
    tare_datetime: tareDatetime,
    scale_device: 'Metra',
    operator_id: null,
    operator_name: item.operator_name || 'Импорт Metra',
    status: 'completed',
    notes: `Импортировано из Metra (RecNo: ${item.rec_no})`,
    completed_at: completedAt,
  };
}

export function MetraImportView({ onImported }: Props) {
  const settings = SettingsStorage.getAppSettings();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<MetraWeighingItem[]>([]);
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
    () => items.filter((item) => !existingKeys.has(metraJournalKey(item))),
    [items, existingKeys],
  );

  const loadData = async () => {
    setError(null);
    setSuccess(null);

    if (!settings.metra_db_path.trim()) {
      setError('Укажите путь к базе Metra в настройках и сохраните их');
      return;
    }

    setLoading(true);
    try {
      const response = await apiGet<{ success: true; items: MetraWeighingItem[] }>(
        '/api/metra/weighing_data',
        {
          date,
          db_path: settings.metra_db_path.trim(),
        },
      );
      setItems(response.items);
      setSelectedKeys(new Set(response.items.map(metraImportKey)));
      logger.info('metra', `Загружено записей: ${response.items.length}`, { date });
    } catch (err: any) {
      setItems([]);
      setSelectedKeys(new Set());
      setError(err.message ?? 'Не удалось загрузить данные из Metra');
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(importableItems.map(metraImportKey)));
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
      (item) => selectedKeys.has(metraImportKey(item)) && !existingKeys.has(metraJournalKey(item)),
    );

    if (selectedItems.length === 0) {
      setError('Выберите записи для импорта');
      return;
    }

    setImporting(true);
    try {
      selectedItems.forEach((item) => {
        TicketStorage.create(buildTicketFromMetra(item));
      });
      setSuccess(`Импортировано записей: ${selectedItems.length}`);
      logger.info('metra', `Импортировано записей: ${selectedItems.length}`, { date });
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
        <Scale size={22} className="text-violet-600" />
        <div>
          <h2 className="text-lg font-bold text-slate-800">Импорт из Metra</h2>
          <p className="text-xs text-slate-500">
            Загрузка взвешиваний из базы ScaleData (TWeights.db) программы НПП «Метра».
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
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
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

      {!settings.metra_db_path.trim() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Укажите путь к базе Metra в разделе «Настройки» и запустите backend: <code>npm run dev:api</code>
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
                <th className="px-4 py-3 text-left font-medium">№</th>
                <th className="px-4 py-3 text-left font-medium">Дата брутто</th>
                <th className="px-4 py-3 text-left font-medium">Дата тары</th>
                <th className="px-4 py-3 text-left font-medium">Авто</th>
                <th className="px-4 py-3 text-right font-medium">Брутто</th>
                <th className="px-4 py-3 text-right font-medium">Тара</th>
                <th className="px-4 py-3 text-right font-medium">Нетто</th>
                <th className="px-4 py-3 text-left font-medium">Комментарий</th>
                <th className="px-4 py-3 text-left font-medium">Весовщик</th>
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
                  const key = metraImportKey(item);
                  const alreadyImported = existingKeys.has(metraJournalKey(item));
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
                      <td className="px-4 py-2.5 tabular-nums text-slate-500">{item.rec_no}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{item.datetimebrutto}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{item.datetimetara || '—'}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-700">{item.vehicle_number}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.gross_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.tare_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{item.net_weight?.toLocaleString('ru-RU') ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.cargo_name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{item.operator_name || '—'}</td>
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
