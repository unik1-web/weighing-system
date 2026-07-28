import { useState, useEffect, type ChangeEvent } from 'react';
import {
  SettingsStorage,
  DictionaryStorage,
  TicketStorage,
  PRINT_LAYOUT_LABELS,
  NAV_TAB_MODE_LABELS,
  clearAllDictionaries,
  type AppSettings,
  type NavTabMode,
  type PrintLayout,
} from '@/lib/storage';
import { Settings, Building2, Printer, Save, CheckCircle2, Radio, AlertCircle, Database, Scale, Download, Upload, FolderOpen, Trash2, LayoutPanelTop } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { logger } from '@/lib/logger';
import {
  exportStorageBackup,
  fetchStoragePaths,
  importExternalDictionaries,
  importStorageBackup,
  type StoragePaths,
} from '@/lib/storage-sync';
import { PathBrowserModal } from '@/components/PathBrowserModal';
import { MultiSelectDropdown } from '@/components/MultiSelectDropdown';

const LAYOUT_OPTIONS: PrintLayout[] = ['act', 'receipt'];
const NAV_TAB_OPTIONS: NavTabMode[] = ['full', 'compact'];

interface Props {
  onSaved?: () => void;
}

export function SettingsView({ onSaved }: Props) {
  const [settings, setSettings] = useState<AppSettings>(() => SettingsStorage.getAppSettings());
  const [cargoOptions, setCargoOptions] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [reoTestMessage, setReoTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reoTesting, setReoTesting] = useState(false);
  const [vescomTestMessage, setVescomTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [vescomTesting, setVescomTesting] = useState(false);
  const [vescomImportingDict, setVescomImportingDict] = useState(false);
  const [metraTestMessage, setMetraTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [metraTesting, setMetraTesting] = useState(false);
  const [metraImportingDict, setMetraImportingDict] = useState(false);
  const [storagePaths, setStoragePaths] = useState<StoragePaths | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dictClearMessage, setDictClearMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dictClearBusy, setDictClearBusy] = useState(false);
  const [pathPicker, setPathPicker] = useState<'vescom' | 'metra' | null>(null);

  useEffect(() => {
    setSettings(SettingsStorage.getAppSettings());
    const cargosFromDictionary = DictionaryStorage.getTable('cargos').map((item) => item.name);
    const cargosFromTickets = TicketStorage.getAll().map((ticket) => ticket.cargo_name);
    setCargoOptions(
      Array.from(new Set([...cargosFromDictionary, ...cargosFromTickets].filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    );
    void fetchStoragePaths().then(setStoragePaths);
  }, []);

  const reloadCargoOptions = () => {
    const cargosFromDictionary = DictionaryStorage.getTable('cargos').map((item) => item.name);
    const cargosFromTickets = TicketStorage.getAll().map((ticket) => ticket.cargo_name);
    setCargoOptions(
      Array.from(new Set([...cargosFromDictionary, ...cargosFromTickets].filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    );
  };

  const handleReoCargoChange = (selected: string[]) => {
    setSettings((prev) => ({ ...prev, reo_cargo_names: selected }));
    setSaved(false);
  };

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    SettingsStorage.updateAppSettings(settings);
    logger.info('settings', 'Настройки сохранены');
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2500);
  };

  const handleExportBackup = async () => {
    setBackupMessage(null);
    setBackupBusy(true);
    try {
      await exportStorageBackup();
      setBackupMessage({ type: 'success', text: 'Резервная копия сохранена в файл' });
    } catch (err: unknown) {
      setBackupMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка экспорта',
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!confirm('Импорт заменит текущие данные и настройки. Продолжить?')) {
      return;
    }

    setBackupMessage(null);
    setBackupBusy(true);
    try {
      await importStorageBackup(file);
      setBackupMessage({ type: 'success', text: 'Импорт выполнен. Страница будет перезагружена.' });
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      setBackupMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка импорта',
      });
      setBackupBusy(false);
    }
  };

  const handleClearDictionaries = async () => {
    if (
      !confirm(
        'Удалить все записи из справочников?\n\n' +
          'Будут очищены: автомобили, водители, грузы, грузоотправители, грузополучатели, перевозчики.\n\n' +
          'Журнал взвешиваний, пользователи и настройки не изменятся.',
      )
    ) {
      return;
    }

    setDictClearMessage(null);
    setDictClearBusy(true);
    try {
      await clearAllDictionaries();
      const nextSettings = { ...settings, reo_cargo_names: [] };
      setSettings(nextSettings);
      SettingsStorage.updateAppSettings(nextSettings);
      reloadCargoOptions();
      setDictClearMessage({ type: 'success', text: 'Справочники очищены' });
      logger.info('settings', 'Справочники очищены');
      onSaved?.();
    } catch (err: unknown) {
      setDictClearMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка очистки справочников',
      });
    } finally {
      setDictClearBusy(false);
    }
  };

  const handleTestReo = async () => {
    setReoTestMessage(null);
    if (!settings.reo_object_url.trim() || !settings.reo_access_key.trim()) {
      setReoTestMessage({ type: 'error', text: 'Укажите URL сервиса и ключ доступа' });
      return;
    }

    setReoTesting(true);
    try {
      await apiPost<{ success: true; message: string }>('/api/reo/test', {
        object_id: settings.reo_object_id.trim() || 'test',
        access_key: settings.reo_access_key.trim(),
        object_url: settings.reo_object_url.trim(),
      });
      setReoTestMessage({ type: 'success', text: 'Подключение к РЭО успешно' });
    } catch (err: any) {
      setReoTestMessage({ type: 'error', text: err.message ?? 'Ошибка подключения к РЭО' });
    } finally {
      setReoTesting(false);
    }
  };

  const handleTestVescom = async () => {
    setVescomTestMessage(null);
    if (!settings.vescom_db_path.trim()) {
      setVescomTestMessage({ type: 'error', text: 'Укажите путь к базе Vescom' });
      return;
    }

    setVescomTesting(true);
    try {
      await apiPost<{ success: true; message: string }>('/api/vescom/test', {
        db_path: settings.vescom_db_path.trim(),
        user: settings.vescom_db_user.trim() || 'SYSDBA',
        password: settings.vescom_db_password || 'masterkey',
      });
      setVescomTestMessage({ type: 'success', text: 'Подключение к Vescom успешно' });
    } catch (err: any) {
      setVescomTestMessage({ type: 'error', text: err.message ?? 'Ошибка подключения к Vescom' });
    } finally {
      setVescomTesting(false);
    }
  };

  const handleTestMetra = async () => {
    setMetraTestMessage(null);
    if (!settings.metra_db_path.trim()) {
      setMetraTestMessage({ type: 'error', text: 'Укажите путь к базе Metra' });
      return;
    }

    setMetraTesting(true);
    try {
      const response = await apiPost<{ success: true; message: string; count?: number }>('/api/metra/test', {
        db_path: settings.metra_db_path.trim(),
      });
      setMetraTestMessage({ type: 'success', text: response.message ?? 'Подключение к Metra успешно' });
    } catch (err: any) {
      setMetraTestMessage({ type: 'error', text: err.message ?? 'Ошибка подключения к Metra' });
    } finally {
      setMetraTesting(false);
    }
  };

  const handleImportVescomDictionaries = async () => {
    setVescomTestMessage(null);
    if (!settings.vescom_db_path.trim()) {
      setVescomTestMessage({ type: 'error', text: 'Укажите путь к базе Vescom' });
      return;
    }

    setVescomImportingDict(true);
    try {
      const result = await importExternalDictionaries('vescom', {
        db_path: settings.vescom_db_path.trim(),
        user: settings.vescom_db_user.trim() || 'SYSDBA',
        password: settings.vescom_db_password || 'masterkey',
      });
      reloadCargoOptions();
      setVescomTestMessage({ type: 'success', text: result.message });
    } catch (err: unknown) {
      setVescomTestMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка импорта справочников Vescom',
      });
    } finally {
      setVescomImportingDict(false);
    }
  };

  const handleImportMetraDictionaries = async () => {
    setMetraTestMessage(null);
    if (!settings.metra_db_path.trim()) {
      setMetraTestMessage({ type: 'error', text: 'Укажите путь к базе Metra' });
      return;
    }

    setMetraImportingDict(true);
    try {
      const result = await importExternalDictionaries('metra', {
        db_path: settings.metra_db_path.trim(),
      });
      reloadCargoOptions();
      setMetraTestMessage({ type: 'success', text: result.message });
    } catch (err: unknown) {
      setMetraTestMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка импорта справочников Metra',
      });
    } finally {
      setMetraImportingDict(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition';
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Settings size={22} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-800">Настройки</h2>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Building2 size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Реквизиты организации</h3>
        </div>
        <p className="text-xs text-slate-500">
          Используются в шапке талона (макет «Квитанция») и в актах взвешивания.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Наименование организации</label>
            <input
              type="text"
              value={settings.org_name}
              onChange={(e) => updateField('org_name', e.target.value)}
              placeholder="ООО Мечта"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Адрес</label>
            <input
              type="text"
              value={settings.org_address}
              onChange={(e) => updateField('org_address', e.target.value)}
              placeholder="г. Медногорск, ул. Чапаева, 1А"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Телефон</label>
            <input
              type="text"
              value={settings.org_phone}
              onChange={(e) => updateField('org_phone', e.target.value)}
              placeholder="+7 (xxx) xxx-xx-xx"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>ИНН</label>
            <input
              type="text"
              value={settings.org_inn}
              onChange={(e) => updateField('org_inn', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>КПП</label>
            <input
              type="text"
              value={settings.org_kpp}
              onChange={(e) => updateField('org_kpp', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>ОГРН</label>
            <input
              type="text"
              value={settings.org_ogrn}
              onChange={(e) => updateField('org_ogrn', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>БИК</label>
            <input
              type="text"
              value={settings.org_bik}
              onChange={(e) => updateField('org_bik', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <LayoutPanelTop size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Вкладки меню</h3>
        </div>
        <p className="text-xs text-slate-500">
          Как отображать пункты навигации в верхней панели.
        </p>

        <div className="space-y-3">
          {NAV_TAB_OPTIONS.map((mode) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                settings.nav_tab_mode === mode
                  ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/30'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="nav_tab_mode"
                value={mode}
                checked={settings.nav_tab_mode === mode}
                onChange={() => updateField('nav_tab_mode', mode)}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-semibold text-slate-800">
                  {mode === 'full' ? 'Полное' : 'Сжатое'}
                </div>
                <div className="text-xs text-slate-500">{NAV_TAB_MODE_LABELS[mode]}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Printer size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Макет печати</h3>
        </div>

        <div className="space-y-3">
          {LAYOUT_OPTIONS.map((layout) => (
            <label
              key={layout}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                settings.print_layout === layout
                  ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/30'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="print_layout"
                value={layout}
                checked={settings.print_layout === layout}
                onChange={() => updateField('print_layout', layout)}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-semibold text-slate-800">
                  {PRINT_LAYOUT_LABELS[layout]}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {layout === 'act'
                    ? 'Классический акт с полными реквизитами, НДС и двумя экземплярами на листе.'
                    : 'Талон по образцу: шапка организации, таблица взвешиваний, три экземпляра на листе.'}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Radio size={18} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-800">Интеграция с РЭО</h3>
        </div>
        <p className="text-xs text-slate-500">
          Параметры подключения к сервису РЭО и виды груза для массовой отправки из журнала.
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.reo_enabled}
            onChange={(e) => updateField('reo_enabled', e.target.checked)}
            className="rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Включить интеграцию с РЭО</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>URL сервиса РЭО</label>
            <input
              type="url"
              value={settings.reo_object_url}
              onChange={(e) => updateField('reo_object_url', e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Идентификатор объекта</label>
            <input
              type="text"
              value={settings.reo_object_id}
              onChange={(e) => updateField('reo_object_id', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Ключ доступа</label>
            <input
              type="password"
              value={settings.reo_access_key}
              onChange={(e) => updateField('reo_access_key', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Виды груза для отправки в РЭО</label>
          <p className="text-xs text-slate-500 mb-2">
            В журнале отправляются только завершённые записи с выбранным видом груза.
          </p>
          <MultiSelectDropdown
            options={cargoOptions}
            selected={settings.reo_cargo_names}
            onChange={handleReoCargoChange}
            placeholder="Выберите виды груза"
            emptyMessage="Справочник грузов пуст. Добавьте грузы в разделе «Справочники»."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTestReo}
            disabled={reoTesting}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          >
            {reoTesting ? 'Проверка...' : 'Проверка РЭО'}
          </button>
          {reoTestMessage && (
            <span className={`flex items-center gap-1.5 text-sm ${reoTestMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {reoTestMessage.type === 'error' && <AlertCircle size={16} />}
              {reoTestMessage.type === 'success' && <CheckCircle2 size={16} />}
              {reoTestMessage.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Database size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">База Vescom (Firebird)</h3>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.vescom_enabled}
            onChange={(e) => updateField('vescom_enabled', e.target.checked)}
            className="rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Включить импорт из Vescom</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Путь к базе данных</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.vescom_db_path}
                onChange={(e) => updateField('vescom_db_path', e.target.value)}
                placeholder="C:\\Path\\To\\VESCOM.GDB"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setPathPicker('vescom')}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Обзор...
              </button>
            </div>
          </div>
          <div>
            <label className={labelClass}>Пользователь Firebird</label>
            <input
              type="text"
              value={settings.vescom_db_user}
              onChange={(e) => updateField('vescom_db_user', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Пароль Firebird</label>
            <input
              type="password"
              value={settings.vescom_db_password}
              onChange={(e) => updateField('vescom_db_password', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTestVescom}
            disabled={vescomTesting || vescomImportingDict}
            className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
          >
            {vescomTesting ? 'Проверка...' : 'Проверка Vescom'}
          </button>
          <button
            type="button"
            onClick={() => void handleImportVescomDictionaries()}
            disabled={vescomTesting || vescomImportingDict}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {vescomImportingDict ? 'Импорт...' : 'Импорт справочников'}
          </button>
          {vescomTestMessage && (
            <span className={`flex items-center gap-1.5 text-sm ${vescomTestMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {vescomTestMessage.type === 'error' && <AlertCircle size={16} />}
              {vescomTestMessage.type === 'success' && <CheckCircle2 size={16} />}
              {vescomTestMessage.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Scale size={18} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-slate-800">База Metra (TWeights.db)</h3>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.metra_enabled}
            onChange={(e) => updateField('metra_enabled', e.target.checked)}
            className="rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Включить импорт из Metra</span>
        </label>

        <div>
          <label className={labelClass}>Каталог базы Metra</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.metra_db_path}
              onChange={(e) => updateField('metra_db_path', e.target.value)}
              placeholder="C:\\Path\\To\\Metra"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setPathPicker('metra')}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Обзор...
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Выберите каталог, в котором лежит файл <code>TWeights.db</code>.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTestMetra}
            disabled={metraTesting || metraImportingDict}
            className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
          >
            {metraTesting ? 'Проверка...' : 'Проверка Metra'}
          </button>
          <button
            type="button"
            onClick={() => void handleImportMetraDictionaries()}
            disabled={metraTesting || metraImportingDict}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {metraImportingDict ? 'Импорт...' : 'Импорт справочников'}
          </button>
          {metraTestMessage && (
            <span className={`flex items-center gap-1.5 text-sm ${metraTestMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {metraTestMessage.type === 'error' && <AlertCircle size={16} />}
              {metraTestMessage.type === 'success' && <CheckCircle2 size={16} />}
              {metraTestMessage.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <FolderOpen size={18} className="text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-800">Данные и резервное копирование</h3>
        </div>
        <p className="text-xs text-slate-500">
          Настройки сохраняются в <code>config.ini</code>, журнал и справочники — в SQLite-базе <code>BD/weighing.db</code> рядом с приложением. Резервная копия — файл <code>.ini</code>.
        </p>
        {storagePaths && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
            <div><span className="font-medium">Конфиг:</span> {storagePaths.config_file}</div>
            <div><span className="font-medium">База:</span> {storagePaths.database_file}</div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={backupBusy}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={16} /> Экспорт
          </button>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
            <Upload size={16} /> Импорт
            <input
              type="file"
              accept=".ini,text/plain,application/json,.json"
              className="hidden"
              disabled={backupBusy}
              onChange={handleImportBackup}
            />
          </label>
          <button
            type="button"
            onClick={handleClearDictionaries}
            disabled={backupBusy || dictClearBusy}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 size={16} /> Очистить справочники
          </button>
          {backupMessage && (
            <span className={`flex items-center gap-1.5 text-sm ${backupMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {backupMessage.type === 'error' && <AlertCircle size={16} />}
              {backupMessage.type === 'success' && <CheckCircle2 size={16} />}
              {backupMessage.text}
            </span>
          )}
          {dictClearMessage && (
            <span className={`flex items-center gap-1.5 text-sm ${dictClearMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {dictClearMessage.type === 'error' && <AlertCircle size={16} />}
              {dictClearMessage.type === 'success' && <CheckCircle2 size={16} />}
              {dictClearMessage.text}
            </span>
          )}
        </div>
      </div>

      <PathBrowserModal
        open={pathPicker === 'vescom'}
        mode="file"
        title="Выбор файла базы Vescom"
        extensions={['.fdb', '.gdb']}
        initialPath={settings.vescom_db_path}
        onClose={() => setPathPicker(null)}
        onSelect={(path) => {
          updateField('vescom_db_path', path);
          setPathPicker(null);
        }}
      />

      <PathBrowserModal
        open={pathPicker === 'metra'}
        mode="directory"
        title="Выбор каталога базы Metra"
        initialPath={settings.metra_db_path}
        onClose={() => setPathPicker(null)}
        onSelect={(path) => {
          updateField('metra_db_path', path);
          setPathPicker(null);
        }}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500"
        >
          <Save size={16} /> Сохранить настройки
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 size={16} /> Сохранено
          </span>
        )}
      </div>
    </div>
  );
}
