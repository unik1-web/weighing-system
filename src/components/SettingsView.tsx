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
  type Scale,
} from '@/lib/storage';
import { DRIVER_INPUT_MODE_LABELS, type DriverInputMode } from '@/lib/vehicle-resolve';
import {
  ADAPTER_LIST,
  SCALE_DEVICES,
  type ScaleDeviceId,
  type ScaleTransportKind,
  type ScaleConnectionProfile,
} from '@/lib/scales';
import {
  MANUAL_WEIGHT_REASON_MODE_LABELS,
  type ManualWeightReasonMode,
} from '@/lib/manual-weight-reason';
import {
  ensureSiteMigrated,
  getDefaultSite,
  getActiveScaleContext,
  listScalesForSite,
  updateSite,
  upsertScale,
  enableSpareScale,
  disableSpareScale,
  connectionFromDevice,
  listSwitchHistory,
  ACTIVE_SCALE_SET_LABELS,
  SWITCH_REASON_LABELS,
  SITE_RUNTIME_UPDATED_EVENT,
  DEFAULT_SPARE_SCALE_NAME,
  isSpareEnabled,
} from '@/lib/site-runtime';
import { SpareSwitchWizard } from '@/components/SpareSwitchWizard';
import { Settings, Building2, Printer, Save, CheckCircle2, Radio, AlertCircle, Database, Scale as ScaleIcon, Download, Upload, FolderOpen, Trash2, LayoutPanelTop, Server, ArrowLeftRight } from 'lucide-react';
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
const TRANSPORT_OPTIONS: { id: ScaleTransportKind; label: string }[] = [
  { id: 'web_serial', label: 'Web Serial (браузер)' },
  { id: 'tcp', label: 'TCP (сервер)' },
  { id: 'serial', label: 'Serial COM (сервер, задел)' },
];

function patchScaleConnection(
  scale: Scale,
  patch: Partial<ScaleConnectionProfile>,
): Scale {
  return {
    ...scale,
    connection: {
      ...connectionFromDevice(scale.adapter_id),
      ...scale.connection,
      ...patch,
    },
  };
}

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
  const [waTestMessage, setWaTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [waTesting, setWaTesting] = useState(false);
  const [waImportingDict, setWaImportingDict] = useState(false);
  const [storagePaths, setStoragePaths] = useState<StoragePaths | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dictClearMessage, setDictClearMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dictClearBusy, setDictClearBusy] = useState(false);
  const [pathPicker, setPathPicker] = useState<'vescom' | 'metra' | 'wa' | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [siteName, setSiteName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [primaryScale, setPrimaryScale] = useState<Scale | null>(null);
  const [spareScale, setSpareScale] = useState<Scale | null>(null);
  const [activeSetLabel, setActiveSetLabel] = useState(ACTIVE_SCALE_SET_LABELS.primary);
  const [spareEnabled, setSpareEnabled] = useState(false);
  const [switchHistory, setSwitchHistory] = useState<
    ReturnType<typeof listSwitchHistory>
  >([]);
  const [wizardDirection, setWizardDirection] = useState<'to_spare' | 'to_primary' | null>(null);
  const [siteMessage, setSiteMessage] = useState<string | null>(null);
  const [activeOnSpare, setActiveOnSpare] = useState(false);

  const reloadSiteState = () => {
    ensureSiteMigrated();
    const site = getDefaultSite();
    setSiteId(site.id);
    setSiteName(site.name);
    const scales = listScalesForSite(site.id);
    setPrimaryScale(scales.find((s) => s.role === 'primary') ?? null);
    setSpareScale(scales.find((s) => s.role === 'spare') ?? null);
    const ctx = getActiveScaleContext();
    setActiveSetLabel(ACTIVE_SCALE_SET_LABELS[ctx.runtime.active_scale_set]);
    setActiveOnSpare(ctx.runtime.active_scale_set === 'spare');
    setSpareEnabled(isSpareEnabled(site.id));
    setSwitchHistory(listSwitchHistory(site.id).slice().reverse().slice(0, 10));
    setSettings(SettingsStorage.getAppSettings());
  };

  useEffect(() => {
    setSettings(SettingsStorage.getAppSettings());
    reloadSiteState();
    const cargosFromDictionary = DictionaryStorage.getTable('cargos').map((item) => item.name);
    const cargosFromTickets = TicketStorage.getAll().map((ticket) => ticket.cargo_name);
    setCargoOptions(
      Array.from(new Set([...cargosFromDictionary, ...cargosFromTickets].filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    );
    void fetchStoragePaths().then(setStoragePaths);

    const onRuntime = () => reloadSiteState();
    window.addEventListener(SITE_RUNTIME_UPDATED_EVENT, onRuntime);
    return () => window.removeEventListener(SITE_RUNTIME_UPDATED_EVENT, onRuntime);
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
    setSettingsError(null);
    if (
      settings.tara_threshold < 0 ||
      settings.max_time_between < 0 ||
      settings.tara_default < 0 ||
      Number.isNaN(settings.tara_threshold) ||
      Number.isNaN(settings.max_time_between) ||
      Number.isNaN(settings.tara_default)
    ) {
      setSettingsError('Порог тары, интервал и тара по умолчанию должны быть ≥ 0.');
      return;
    }
    SettingsStorage.updateAppSettings(settings);
    try {
      if (siteId) {
        updateSite({ id: siteId, name: siteName });
      }
      if (primaryScale) {
        upsertScale({
          ...primaryScale,
          adapter_id: primaryScale.adapter_id,
          connection: primaryScale.connection ?? connectionFromDevice(primaryScale.adapter_id),
          name:
            primaryScale.adapter_id === 'custom'
              ? primaryScale.name || 'Произвольный разбор'
              : (SCALE_DEVICES[primaryScale.adapter_id]?.name ?? primaryScale.name),
        });
      }
      if (spareScale) {
        // Persist spare connection/adapter before enable/disable toggles
        upsertScale({
          ...spareScale,
          adapter_id: spareScale.adapter_id,
          connection: spareScale.connection ?? connectionFromDevice(spareScale.adapter_id),
          name: spareScale.name || DEFAULT_SPARE_SCALE_NAME,
          enabled: spareEnabled,
        });
        if (spareEnabled) {
          enableSpareScale({
            adapter_id: spareScale.adapter_id,
            name: spareScale.name || DEFAULT_SPARE_SCALE_NAME,
          });
        } else {
          disableSpareScale({
            adapter_id: spareScale.adapter_id,
            name: spareScale.name || DEFAULT_SPARE_SCALE_NAME,
          });
        }
      }
      // Keep settings cache in sync with active scale adapter
      const ctx = getActiveScaleContext();
      SettingsStorage.updateAppSettings({
        scale_device_id: ctx.adapter_id,
        manual_weight_reason_mode: settings.manual_weight_reason_mode,
      });
      setSettings((prev) => ({
        ...prev,
        scale_device_id: ctx.adapter_id,
      }));
      reloadSiteState();
    } catch (err: unknown) {
      setSettingsError(err instanceof Error ? err.message : 'Ошибка сохранения площадки');
      return;
    }
    logger.info('settings', 'Сохранены настройки режимов взвешивания', {
      weighing_mode_default: settings.weighing_mode_default,
      stable_mode: settings.stable_mode,
      tara_threshold: settings.tara_threshold,
      max_time_between: settings.max_time_between,
      tara_default: settings.tara_default,
      driver_input_mode: settings.driver_input_mode,
      scale_device_id: settings.scale_device_id,
      manual_weight_reason_mode: settings.manual_weight_reason_mode,
    });
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

  const handleTestWa = async () => {
    setWaTestMessage(null);
    if (!settings.wa_db_path.trim()) {
      setWaTestMessage({ type: 'error', text: 'Укажите путь к базе WA' });
      return;
    }

    setWaTesting(true);
    try {
      const response = await apiPost<{ success: true; message: string; count?: number }>('/api/wa/test', {
        db_path: settings.wa_db_path.trim(),
        user: settings.wa_db_user.trim() || 'SYSDBA',
        password: settings.wa_db_password || 'masterkey',
      });
      setWaTestMessage({ type: 'success', text: response.message ?? 'Подключение к WA успешно' });
    } catch (err: unknown) {
      setWaTestMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка подключения к WA',
      });
    } finally {
      setWaTesting(false);
    }
  };

  const handleImportWaDictionaries = async () => {
    setWaTestMessage(null);
    if (!settings.wa_db_path.trim()) {
      setWaTestMessage({ type: 'error', text: 'Укажите путь к базе WA' });
      return;
    }

    setWaImportingDict(true);
    try {
      const result = await importExternalDictionaries('wa', {
        db_path: settings.wa_db_path.trim(),
        user: settings.wa_db_user.trim() || 'SYSDBA',
        password: settings.wa_db_password || 'masterkey',
      });
      reloadCargoOptions();
      setWaTestMessage({ type: 'success', text: result.message });
    } catch (err: unknown) {
      setWaTestMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Ошибка импорта справочников WA',
      });
    } finally {
      setWaImportingDict(false);
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
          <ArrowLeftRight size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Площадка и весы</h3>
        </div>
        <p className="text-xs text-slate-500">
          Основные и резервные весы одной площадки. Активный комплект:{' '}
          <span className="font-semibold text-slate-700">{activeSetLabel}</span>
          {spareEnabled ? '' : ' (резерв ещё не включён)'}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Название площадки</label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => {
                setSiteName(e.target.value);
                setSaved(false);
              }}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Основные весы — адаптер</label>
            <select
              value={primaryScale?.adapter_id ?? settings.scale_device_id}
              onChange={(e) => {
                const id = e.target.value as ScaleDeviceId;
                setPrimaryScale((prev) =>
                  prev
                    ? {
                        ...prev,
                        adapter_id: id,
                        name: SCALE_DEVICES[id].name,
                        connection: connectionFromDevice(id),
                      }
                    : prev,
                );
                setSaved(false);
              }}
              className={inputClass}
            >
              {ADAPTER_LIST.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Резервные весы — адаптер</label>
            <select
              value={spareScale?.adapter_id ?? 'microsim-m0601'}
              onChange={(e) => {
                const id = e.target.value as ScaleDeviceId;
                setSpareScale((prev) =>
                  prev
                    ? {
                        ...prev,
                        adapter_id: id,
                        connection: connectionFromDevice(id),
                      }
                    : prev,
                );
                setSaved(false);
              }}
              className={inputClass}
            >
              {ADAPTER_LIST.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Имя резервных весов</label>
            <input
              type="text"
              value={spareScale?.name ?? DEFAULT_SPARE_SCALE_NAME}
              onChange={(e) => {
                setSpareScale((prev) => (prev ? { ...prev, name: e.target.value } : prev));
                setSaved(false);
              }}
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={spareEnabled}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (!next && activeOnSpare) {
                    setSiteMessage(
                      'Сначала вернитесь на основные весы, затем отключите резервный комплект.',
                    );
                    return;
                  }
                  setSpareEnabled(next);
                  setSaved(false);
                }}
                className="mt-0.5"
              />
              <span>Резервные весы включены (можно переключаться на резерв)</span>
            </label>
            {activeOnSpare && (
              <p className="mt-1 text-xs text-amber-700">
                Чтобы отключить резерв, сначала вернитесь на основные весы.
              </p>
            )}
          </div>

          {primaryScale && (
            <div className="sm:col-span-2 space-y-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Подключение основных весов
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Транспорт</label>
                  <select
                    value={primaryScale.connection?.transport ?? 'web_serial'}
                    onChange={(e) => {
                      const transport = e.target.value as ScaleTransportKind;
                      setPrimaryScale((prev) =>
                        prev ? patchScaleConnection(prev, { transport }) : prev,
                      );
                      setSaved(false);
                    }}
                    className={inputClass}
                  >
                    {TRANSPORT_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Скорость (baud)</label>
                  <input
                    type="number"
                    value={primaryScale.connection?.baudRate ?? 9600}
                    onChange={(e) => {
                      const baudRate = Number(e.target.value) || 9600;
                      setPrimaryScale((prev) =>
                        prev ? patchScaleConnection(prev, { baudRate }) : prev,
                      );
                      setSaved(false);
                    }}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Parity</label>
                  <select
                    value={primaryScale.connection?.parity ?? 'none'}
                    onChange={(e) => {
                      const parity = e.target.value as ScaleConnectionProfile['parity'];
                      setPrimaryScale((prev) =>
                        prev ? patchScaleConnection(prev, { parity }) : prev,
                      );
                      setSaved(false);
                    }}
                    className={inputClass}
                  >
                    <option value="none">none</option>
                    <option value="even">even</option>
                    <option value="odd">odd</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Data / Stop bits</label>
                  <div className="flex gap-2">
                    <select
                      value={primaryScale.connection?.dataBits ?? 8}
                      onChange={(e) => {
                        const dataBits = Number(e.target.value) === 7 ? 7 : 8;
                        setPrimaryScale((prev) =>
                          prev ? patchScaleConnection(prev, { dataBits }) : prev,
                        );
                        setSaved(false);
                      }}
                      className={inputClass}
                    >
                      <option value={7}>7</option>
                      <option value={8}>8</option>
                    </select>
                    <select
                      value={primaryScale.connection?.stopBits ?? 1}
                      onChange={(e) => {
                        const stopBits = Number(e.target.value) === 2 ? 2 : 1;
                        setPrimaryScale((prev) =>
                          prev ? patchScaleConnection(prev, { stopBits }) : prev,
                        );
                        setSaved(false);
                      }}
                      className={inputClass}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Окончание строки (escape: \\r \\n)</label>
                  <input
                    type="text"
                    value={(primaryScale.connection?.lineTerminator ?? '\r')
                      .replace(/\r/g, '\\r')
                      .replace(/\n/g, '\\n')}
                    onChange={(e) => {
                      const lineTerminator = e.target.value
                        .replace(/\\r/g, '\r')
                        .replace(/\\n/g, '\n');
                      setPrimaryScale((prev) =>
                        prev ? patchScaleConnection(prev, { lineTerminator }) : prev,
                      );
                      setSaved(false);
                    }}
                    className={inputClass}
                  />
                </div>
                {(primaryScale.connection?.transport ?? 'web_serial') === 'tcp' && (
                  <>
                    <div>
                      <label className={labelClass}>TCP host</label>
                      <input
                        type="text"
                        value={primaryScale.connection?.host ?? '127.0.0.1'}
                        onChange={(e) => {
                          setPrimaryScale((prev) =>
                            prev ? patchScaleConnection(prev, { host: e.target.value }) : prev,
                          );
                          setSaved(false);
                        }}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>TCP port</label>
                      <input
                        type="number"
                        value={primaryScale.connection?.tcpPort ?? 9001}
                        onChange={(e) => {
                          const tcpPort = Number(e.target.value) || 9001;
                          setPrimaryScale((prev) =>
                            prev ? patchScaleConnection(prev, { tcpPort }) : prev,
                          );
                          setSaved(false);
                        }}
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
                {(primaryScale.connection?.transport ?? 'web_serial') === 'serial' && (
                  <div className="sm:col-span-2">
                    <label className={labelClass}>COM-порт (только локально / exe)</label>
                    <input
                      type="text"
                      value={primaryScale.connection?.serialPath ?? ''}
                      onChange={(e) => {
                        setPrimaryScale((prev) =>
                          prev ? patchScaleConnection(prev, { serialPath: e.target.value }) : prev,
                        );
                        setSaved(false);
                      }}
                      placeholder="COM3"
                      className={inputClass}
                    />
                    <p className="mt-1 text-xs text-amber-700">
                      Транспорт serial пока не реализован на сервере (ответ 501).
                    </p>
                  </div>
                )}
                {primaryScale.adapter_id === 'custom' && (
                  <>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Regex разбора (группа weight)</label>
                      <textarea
                        value={primaryScale.connection?.parseRegex ?? ''}
                        onChange={(e) => {
                          setPrimaryScale((prev) =>
                            prev ? patchScaleConnection(prev, { parseRegex: e.target.value }) : prev,
                          );
                          setSaved(false);
                        }}
                        rows={2}
                        placeholder={'(?<stable>ST|US),(?<weight>-?\\d+(?:[.,]\\d+)?)\\s*(?<unit>kg)?'}
                        className={inputClass}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Маска (если regex пуст): # = цифра</label>
                      <input
                        type="text"
                        value={primaryScale.connection?.parseMask ?? ''}
                        onChange={(e) => {
                          setPrimaryScale((prev) =>
                            prev ? patchScaleConnection(prev, { parseMask: e.target.value }) : prev,
                          );
                          setSaved(false);
                        }}
                        placeholder="ST,######.#kg"
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {spareScale && spareEnabled && (
            <div className="sm:col-span-2 space-y-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Подключение резервных весов
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Транспорт</label>
                  <select
                    value={spareScale.connection?.transport ?? 'web_serial'}
                    onChange={(e) => {
                      const transport = e.target.value as ScaleTransportKind;
                      setSpareScale((prev) =>
                        prev ? patchScaleConnection(prev, { transport }) : prev,
                      );
                      setSaved(false);
                    }}
                    className={inputClass}
                  >
                    {TRANSPORT_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Скорость (baud)</label>
                  <input
                    type="number"
                    value={spareScale.connection?.baudRate ?? 9600}
                    onChange={(e) => {
                      const baudRate = Number(e.target.value) || 9600;
                      setSpareScale((prev) =>
                        prev ? patchScaleConnection(prev, { baudRate }) : prev,
                      );
                      setSaved(false);
                    }}
                    className={inputClass}
                  />
                </div>
                {(spareScale.connection?.transport ?? 'web_serial') === 'tcp' && (
                  <>
                    <div>
                      <label className={labelClass}>TCP host</label>
                      <input
                        type="text"
                        value={spareScale.connection?.host ?? '127.0.0.1'}
                        onChange={(e) => {
                          setSpareScale((prev) =>
                            prev ? patchScaleConnection(prev, { host: e.target.value }) : prev,
                          );
                          setSaved(false);
                        }}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>TCP port</label>
                      <input
                        type="number"
                        value={spareScale.connection?.tcpPort ?? 9001}
                        onChange={(e) => {
                          const tcpPort = Number(e.target.value) || 9001;
                          setSpareScale((prev) =>
                            prev ? patchScaleConnection(prev, { tcpPort }) : prev,
                          );
                          setSaved(false);
                        }}
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
                {spareScale.adapter_id === 'custom' && (
                  <>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Regex разбора (группа weight)</label>
                      <textarea
                        value={spareScale.connection?.parseRegex ?? ''}
                        onChange={(e) => {
                          setSpareScale((prev) =>
                            prev ? patchScaleConnection(prev, { parseRegex: e.target.value }) : prev,
                          );
                          setSaved(false);
                        }}
                        rows={2}
                        className={inputClass}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Маска (если regex пуст)</label>
                      <input
                        type="text"
                        value={spareScale.connection?.parseMask ?? ''}
                        onChange={(e) => {
                          setSpareScale((prev) =>
                            prev ? patchScaleConnection(prev, { parseMask: e.target.value }) : prev,
                          );
                          setSaved(false);
                        }}
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSiteMessage(null);
              if (activeSetLabel === ACTIVE_SCALE_SET_LABELS.primary) {
                if (!spareEnabled) {
                  setSiteMessage(
                    'Сначала включите и сохраните резервные весы, затем переключайтесь.',
                  );
                  return;
                }
                setWizardDirection('to_spare');
              } else {
                setWizardDirection('to_primary');
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <ArrowLeftRight size={16} />
            {activeSetLabel === ACTIVE_SCALE_SET_LABELS.primary
              ? 'Переключить на резервные'
              : 'Вернуться на основные'}
          </button>
          {siteMessage && <span className="text-sm text-amber-700">{siteMessage}</span>}
        </div>

        {switchHistory.length > 0 && (
          <div className="space-y-1 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Журнал переключений
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600">
              {switchHistory.map((ev) => (
                <li key={ev.id}>
                  {new Date(ev.at).toLocaleString('ru-RU')} —{' '}
                  {ACTIVE_SCALE_SET_LABELS[ev.from_set]} → {ACTIVE_SCALE_SET_LABELS[ev.to_set]},{' '}
                  {SWITCH_REASON_LABELS[ev.reason]}, {ev.operator_name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <ScaleIcon size={18} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Режимы взвешивания</h3>
        </div>
        <p className="text-xs text-slate-500">
          Параметры одиночного и двойного режимов. Значение тары по умолчанию 0 означает «не задано».
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Режим по умолчанию</label>
            <select
              value={settings.weighing_mode_default}
              onChange={(e) =>
                updateField('weighing_mode_default', e.target.value === 'dual' ? 'dual' : 'single')
              }
              className={inputClass}
            >
              <option value="single">Одиночное</option>
              <option value="dual">Двойное</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.stable_mode}
                onChange={(e) => updateField('stable_mode', e.target.checked)}
              />
              <span className="text-sm text-slate-700">Разрешить фиксацию при нестабильном весе</span>
            </label>
          </div>
          <div>
            <label className={labelClass}>Порог тары, кг</label>
            <input
              type="number"
              min={0}
              value={settings.tara_threshold}
              onChange={(e) => updateField('tara_threshold', Number(e.target.value))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Макс. интервал между проходами, ч</label>
            <input
              type="number"
              min={0}
              value={settings.max_time_between}
              onChange={(e) => updateField('max_time_between', Number(e.target.value))}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Тара по умолчанию, кг</label>
            <input
              type="number"
              min={0}
              value={settings.tara_default}
              onChange={(e) => updateField('tara_default', Number(e.target.value))}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">
              0 = не задано (автоподстановка в одиночном режиме не выполняется).
            </p>
          </div>
          <div>
            <label className={labelClass}>Режим ввода водителя</label>
            <select
              value={settings.driver_input_mode}
              onChange={(e) =>
                updateField('driver_input_mode', e.target.value as DriverInputMode)
              }
              className={inputClass}
            >
              {(Object.keys(DRIVER_INPUT_MODE_LABELS) as DriverInputMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {DRIVER_INPUT_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Причина ручного ввода веса</label>
            <select
              value={settings.manual_weight_reason_mode}
              onChange={(e) =>
                updateField(
                  'manual_weight_reason_mode',
                  e.target.value as ManualWeightReasonMode,
                )
              }
              className={inputClass}
            >
              {(Object.keys(MANUAL_WEIGHT_REASON_MODE_LABELS) as ManualWeightReasonMode[]).map(
                (mode) => (
                  <option key={mode} value={mode}>
                    {MANUAL_WEIGHT_REASON_MODE_LABELS[mode]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label className={labelClass}>Модель весов активного комплекта</label>
            <select
              value={settings.scale_device_id}
              onChange={(e) => {
                const id = e.target.value as ScaleDeviceId;
                updateField('scale_device_id', id);
                const ctx = getActiveScaleContext();
                if (ctx.scale_role === 'primary') {
                  setPrimaryScale((prev) =>
                    prev
                      ? {
                          ...prev,
                          adapter_id: id,
                          name: SCALE_DEVICES[id].name,
                          connection: connectionFromDevice(id),
                        }
                      : prev,
                  );
                } else {
                  setSpareScale((prev) =>
                    prev
                      ? {
                          ...prev,
                          adapter_id: id,
                          connection: connectionFromDevice(id),
                        }
                      : prev,
                  );
                }
              }}
              className={inputClass}
            >
              {ADAPTER_LIST.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Синхронизируется с профилем активного комплекта (основные/резервные).
            </p>
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
          <ScaleIcon size={18} className="text-violet-600" />
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
          <Server size={18} className="text-teal-600" />
          <h3 className="text-sm font-semibold text-slate-800">База WA («Весы Авто»)</h3>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.wa_enabled}
            onChange={(e) => updateField('wa_enabled', e.target.checked)}
            className="rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Включить импорт из WA</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Каталог или файл базы WA</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.wa_db_path}
                onChange={(e) => updateField('wa_db_path', e.target.value)}
                placeholder="C:\\Program Files (x86)\\WA"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setPathPicker('wa')}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Обзор...
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Обычно <code>C:\Program Files (x86)\WA</code>. Ищется файл <code>VESYEVENT.GDB</code> / <code>*.fdb</code> в каталоге или в подпапке <code>DataBase</code>.
            </p>
          </div>
          <div>
            <label className={labelClass}>Пользователь Firebird</label>
            <input
              type="text"
              value={settings.wa_db_user}
              onChange={(e) => updateField('wa_db_user', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Пароль Firebird</label>
            <input
              type="password"
              value={settings.wa_db_password}
              onChange={(e) => updateField('wa_db_password', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleTestWa()}
            disabled={waTesting || waImportingDict}
            className="rounded-lg border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
          >
            {waTesting ? 'Проверка...' : 'Проверка WA'}
          </button>
          <button
            type="button"
            onClick={() => void handleImportWaDictionaries()}
            disabled={waTesting || waImportingDict}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {waImportingDict ? 'Импорт...' : 'Импорт справочников'}
          </button>
          {waTestMessage && (
            <span className={`flex items-center gap-1.5 text-sm ${waTestMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {waTestMessage.type === 'error' && <AlertCircle size={16} />}
              {waTestMessage.type === 'success' && <CheckCircle2 size={16} />}
              {waTestMessage.text}
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

      <PathBrowserModal
        open={pathPicker === 'wa'}
        mode="directory"
        title="Выбор каталога базы WA"
        initialPath={settings.wa_db_path}
        onClose={() => setPathPicker(null)}
        onSelect={(path) => {
          updateField('wa_db_path', path);
          setPathPicker(null);
        }}
      />

      {wizardDirection && (
        <SpareSwitchWizard
          direction={wizardDirection}
          onCancel={() => setWizardDirection(null)}
          onDone={() => {
            setWizardDirection(null);
            reloadSiteState();
            setSiteMessage('Комплект переключён.');
          }}
        />
      )}

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
        {settingsError && (
          <span className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle size={16} /> {settingsError}
          </span>
        )}
      </div>
    </div>
  );
}
