import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  SettingsStorage,
  TicketStorage,
  type WeighingTicket,
} from '@/lib/storage';
import {
  apiGet,
  waImportKey,
  ticketImportKey,
  type WaWeighingItem,
} from '@/lib/api';
import {
  ACTIVE_WRITE_BLOCKED_EVENT,
  flushDatabaseSync,
  pauseDatabaseSync,
  resumeDatabaseSync,
} from '@/lib/storage-sync';
import { logger } from '@/lib/logger';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Server,
  Download,
  Loader2,
} from 'lucide-react';

interface Props {
  onImported: () => void;
}

interface ViewState {
  date: string;
  items: WaWeighingItem[];
  selectedKeys: string[];
  loading: boolean;
  importing: boolean;
  error: string | null;
  success: string | null;
  journalVersion: number;
}

type ViewAction =
  | { type: 'set_date'; date: string }
  | { type: 'load_start' }
  | { type: 'load_success'; items: WaWeighingItem[] }
  | { type: 'load_error'; error: string }
  | { type: 'toggle_all'; keys: string[] }
  | { type: 'toggle_item'; key: string; checked: boolean }
  | { type: 'import_start' }
  | { type: 'import_success'; count: number; journalVersion: number }
  | { type: 'import_error'; error: string }
  | { type: 'clear_messages' };

const initialState: ViewState = {
  date: new Date().toISOString().slice(0, 10),
  items: [],
  selectedKeys: [],
  loading: false,
  importing: false,
  error: null,
  success: null,
  journalVersion: 0,
};

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'set_date':
      return { ...state, date: action.date };
    case 'load_start':
      return { ...state, loading: true, error: null, success: null };
    case 'load_success':
      return {
        ...state,
        loading: false,
        items: action.items,
        selectedKeys: action.items.map(waImportKey),
      };
    case 'load_error':
      return {
        ...state,
        loading: false,
        items: [],
        selectedKeys: [],
        error: action.error,
      };
    case 'toggle_all':
      return { ...state, selectedKeys: action.keys };
    case 'toggle_item': {
      const selectedKeys = action.checked
        ? state.selectedKeys.includes(action.key)
          ? state.selectedKeys
          : [...state.selectedKeys, action.key]
        : state.selectedKeys.filter((key) => key !== action.key);
      return { ...state, selectedKeys };
    }
    case 'import_start':
      return { ...state, importing: true, error: null, success: null };
    case 'import_success':
      return {
        ...state,
        importing: false,
        journalVersion: action.journalVersion,
        success: `Импортировано записей: ${action.count}`,
      };
    case 'import_error':
      return { ...state, importing: false, error: action.error };
    case 'clear_messages':
      return { ...state, error: null, success: null };
    default:
      return state;
  }
}

function parseWaDateTime(value: string): string | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function waJournalKey(item: WaWeighingItem): string {
  return ticketImportKey({
    gross_datetime: parseWaDateTime(item.datetimebrutto),
    tare_datetime: parseWaDateTime(item.datetimetara),
    vehicle_number: item.vehicle_number,
  });
}

function buildTicketFromWa(item: WaWeighingItem): Omit<
  WeighingTicket,
  'id' | 'ticket_number' | 'created_at' | 'reo_status' | 'reo_sent_at'
> {
  const grossDatetime = parseWaDateTime(item.datetimebrutto);
  const tareDatetime = parseWaDateTime(item.datetimetara);
  const completedAt = tareDatetime ?? grossDatetime ?? new Date().toISOString();

  return {
    vehicle_number: item.vehicle_number,
    vehicle_brand: item.vehicle_brand || '',
    trailer_number: item.trailer_number || '',
    driver_name: item.driver_name || '—',
    cargo_name: item.cargo_name,
    shipper_name: item.shipper_name,
    receiver_name: item.receiver_name,
    carrier_name: item.carrier_name,
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
    scale_device: 'WA',
    operator_id: null,
    operator_name: item.operator_name || 'Импорт WA',
    status: 'completed',
    notes:
      item.wa_id != null
        ? `Импортировано из WA (ID: ${item.wa_id})`
        : 'Импортировано из WA',
    completed_at: completedAt,
  };
}

function normalizeItems(value: unknown): WaWeighingItem[] {
  return Array.isArray(value) ? value : [];
}

function formatWeight(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('ru-RU');
}

export function WaImportView({ onImported }: Props) {
  const settings = SettingsStorage.getAppSettings();
  const [state, dispatch] = useReducer(viewReducer, initialState);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleWriteBlocked = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string; message?: string }>).detail;
      dispatch({
        type: 'import_error',
        error:
          detail?.message
          || 'Смена года не завершена: импорт данных недоступен до завершения ротации.',
      });
    };
    window.addEventListener(ACTIVE_WRITE_BLOCKED_EVENT, handleWriteBlocked as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_WRITE_BLOCKED_EVENT, handleWriteBlocked as EventListener);
    };
  }, []);

  const selectedKeySet = useMemo(() => new Set(state.selectedKeys), [state.selectedKeys]);

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
  }, [state.journalVersion]);

  const importableItems = useMemo(
    () => state.items.filter((item) => !existingKeys.has(waJournalKey(item))),
    [state.items, existingKeys],
  );

  const loadData = useCallback(async () => {
    const requestId = ++requestRef.current;
    dispatch({ type: 'clear_messages' });

    if (!settings.wa_db_path.trim()) {
      dispatch({ type: 'load_error', error: 'Укажите путь к базе WA в настройках и сохраните их' });
      return;
    }

    dispatch({ type: 'load_start' });
    try {
      const response = await apiGet<{ success: true; items: WaWeighingItem[] }>(
        '/api/wa/weighing_data',
        {
          date: state.date,
          db_path: settings.wa_db_path.trim(),
          user: settings.wa_db_user.trim() || 'SYSDBA',
          password: settings.wa_db_password || 'masterkey',
        },
      );

      if (!mountedRef.current || requestId !== requestRef.current) return;

      const loadedItems = normalizeItems(response.items);
      dispatch({ type: 'load_success', items: loadedItems });
      logger.info('wa', `Загружено записей: ${loadedItems.length}`, { date: state.date });
    } catch (err: unknown) {
      if (!mountedRef.current || requestId !== requestRef.current) return;
      dispatch({
        type: 'load_error',
        error: err instanceof Error ? err.message : 'Не удалось загрузить данные из WA',
      });
    }
  }, [state.date, settings.wa_db_path, settings.wa_db_password, settings.wa_db_user]);

  const toggleAll = (checked: boolean) => {
    dispatch({
      type: 'toggle_all',
      keys: checked ? importableItems.map(waImportKey) : [],
    });
  };

  const toggleItem = (key: string, checked: boolean) => {
    dispatch({ type: 'toggle_item', key, checked });
  };

  const handleImport = async () => {
    const selectedItems = state.items.filter(
      (item) => selectedKeySet.has(waImportKey(item)) && !existingKeys.has(waJournalKey(item)),
    );

    if (selectedItems.length === 0) {
      dispatch({ type: 'import_error', error: 'Выберите записи для импорта' });
      return;
    }

    dispatch({ type: 'import_start' });
    pauseDatabaseSync();
    try {
      TicketStorage.createMany(selectedItems.map(buildTicketFromWa));

      if (!mountedRef.current) return;

      dispatch({
        type: 'import_success',
        count: selectedItems.length,
        journalVersion: state.journalVersion + 1,
      });
      logger.info('wa', `Импортировано записей: ${selectedItems.length}`, { date: state.date });

      window.setTimeout(() => {
        if (mountedRef.current) onImported();
      }, 0);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      dispatch({
        type: 'import_error',
        error: err instanceof Error ? err.message : 'Ошибка импорта',
      });
    } finally {
      resumeDatabaseSync();
      void flushDatabaseSync();
    }
  };

  const inputClass =
    'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition';

  const allSelected = importableItems.length > 0 && state.selectedKeys.length === importableItems.length;
  const busy = state.loading || state.importing;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Server size={22} className="text-teal-600" />
        <div>
          <h2 className="text-lg font-bold text-slate-800">Импорт из WA</h2>
          <p className="text-xs text-slate-500">
            Загрузка взвешиваний из SQL-базы программы «Весы Авто» (WA), обычно{' '}
            <code>C:\Program Files (x86)\WA</code>.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Дата</label>
          <input
            type="date"
            value={state.date}
            onChange={(e) => dispatch({ type: 'set_date', date: e.target.value })}
            className={inputClass}
          />
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-50"
        >
          <span className="inline-flex w-4 justify-center">
            {state.loading ? <Loader2 size={16} className="animate-spin" /> : <Calendar size={16} />}
          </span>
          Загрузить
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={busy || importableItems.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          <span className="inline-flex w-4 justify-center">
            {state.importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </span>
          Импортировать выбранные
        </button>
      </div>

      {!settings.wa_db_path.trim() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Укажите путь к каталогу или файлу базы WA в разделе «Настройки» и сохраните их.
        </div>
      )}

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state.success && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{state.success}</span>
        </div>
      )}

      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 text-xs text-slate-500">
          <input
            type="checkbox"
            disabled={importableItems.length === 0 || state.loading}
            checked={allSelected}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span>Выбрать все новые ({importableItems.length})</span>
        </div>

        <div className="min-h-[120px]">
          {state.items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              {state.loading ? 'Загрузка...' : 'Нет данных за выбранную дату'}
            </div>
          ) : (
            <div>
              {state.items.map((item) => {
                const key = waImportKey(item);
                const alreadyImported = existingKeys.has(waJournalKey(item));
                return (
                  <div
                    key={key}
                    className="border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedKeySet.has(key)}
                        disabled={alreadyImported}
                        onChange={(e) => toggleItem(key, e.target.checked)}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {item.wa_id != null ? (
                            <span className="font-semibold text-slate-800">ID {item.wa_id}</span>
                          ) : null}
                          <span className="font-medium text-slate-700">{item.vehicle_number}</span>
                          <span className="text-slate-500">{item.datetimebrutto}</span>
                          {item.datetimetara ? (
                            <span className="text-slate-400">тара: {item.datetimetara}</span>
                          ) : null}
                        </div>
                        <div className="text-slate-600">
                          {item.cargo_name} · {item.shipper_name} → {item.receiver_name} · {item.carrier_name}
                        </div>
                        <div className="text-slate-500">
                          Водитель: {item.driver_name}
                          {item.trailer_number ? ` · Прицеп: ${item.trailer_number}` : ''}
                          {item.vehicle_brand ? ` · ${item.vehicle_brand}` : ''}
                        </div>
                        <div className="text-slate-500">
                          Брутто {formatWeight(item.gross_weight)} / Тара {formatWeight(item.tare_weight)} / Нетто{' '}
                          {formatWeight(item.net_weight)} · {item.operator_name}
                        </div>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        {alreadyImported ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            Уже в журнале
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Новая
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {state.loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/75 text-sm text-slate-500">
            <Loader2 size={20} className="mr-2 animate-spin" />
            Загрузка...
          </div>
        )}
      </div>
    </div>
  );
}
