import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SessionStorage,
  SettingsStorage,
  SiteRuntimeStorage,
  SiteStorage,
  ScaleStorage,
  ScaleSwitchJournalStorage,
  type ScaleSet,
} from '@/lib/storage';
import {
  ANPR_MODE_LABELS,
  DEFAULT_SITE_ID,
  SCALE_SET_LABELS,
  SITE_RUNTIME_CHANGED_EVENT,
  SWITCH_REASON_LABELS,
  WEB_SERIAL_ADAPTER_ID,
  ensureDefaultSiteAndScales,
  updateScaleConnectionDevice,
} from '@/lib/site';
import { SCALE_DEVICE_LIST, normalizeScaleDeviceId } from '@/lib/scales';
import { ScaleSetSwitchWizard } from '@/components/ScaleSetSwitchWizard';
import { Building2, Save, CheckCircle2 } from 'lucide-react';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600';

function formatAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU');
}

export function SiteScalesSettingsSection() {
  const [siteName, setSiteName] = useState('');
  const [primaryDevice, setPrimaryDevice] = useState<string>('');
  const [spareDevice, setSpareDevice] = useState<string>('');
  const [saved, setSaved] = useState(false);
  const [wizardTarget, setWizardTarget] = useState<ScaleSet | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    ensureDefaultSiteAndScales(SettingsStorage.getAppSettings());
    const site = SiteStorage.getById(DEFAULT_SITE_ID);
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare');
    setSiteName(site?.name ?? 'Площадка по умолчанию');
    setPrimaryDevice(primary?.connection.device_id ?? '');
    setSpareDevice(spare?.connection.device_id ?? '');
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    refresh();
    const onRuntime = () => refresh();
    window.addEventListener(SITE_RUNTIME_CHANGED_EVENT, onRuntime);
    return () => window.removeEventListener(SITE_RUNTIME_CHANGED_EVENT, onRuntime);
  }, [refresh]);

  const runtime = useMemo(() => SiteRuntimeStorage.get(DEFAULT_SITE_ID), [tick]);
  const journal = useMemo(
    () => ScaleSwitchJournalStorage.getAll(DEFAULT_SITE_ID),
    [tick],
  );
  const primary = useMemo(
    () => ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary'),
    [tick],
  );
  const spare = useMemo(
    () => ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare'),
    [tick],
  );

  const activeSet = runtime?.active_scale_set ?? 'primary';

  const handleSave = () => {
    const site = SiteStorage.getById(DEFAULT_SITE_ID);
    SiteStorage.upsert({
      id: DEFAULT_SITE_ID,
      name: siteName.trim() || 'Площадка по умолчанию',
      created_at: site?.created_at ?? new Date().toISOString(),
    });

    if (primary) {
      const device =
        primaryDevice === '' ? null : normalizeScaleDeviceId(primaryDevice);
      updateScaleConnectionDevice(primary.id, device, activeSet === 'primary');
    }
    if (spare) {
      const device = spareDevice === '' ? null : normalizeScaleDeviceId(spareDevice);
      updateScaleConnectionDevice(spare.id, device, activeSet === 'spare');
    }

    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    refresh();
  };

  const session = SessionStorage.getSession();
  const operatorName = session?.profile.display_name || 'Оператор';
  const operatorId = session?.user.id ?? null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <Building2 size={18} className="text-teal-600" />
        <h3 className="text-sm font-semibold text-slate-800">Площадка и комплекты весов</h3>
      </div>
      <p className="text-xs text-slate-500">
        Основные и резервные весы. Переключение комплекта — только из этой секции.
      </p>

      <div>
        <label className={labelClass}>Название площадки</label>
        <input
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-700">Основные (primary)</div>
          <div className="text-xs text-slate-500">Адаптер: {WEB_SERIAL_ADAPTER_ID}</div>
          <label className={labelClass}>Модель терминала</label>
          <select
            value={primaryDevice}
            onChange={(e) => setPrimaryDevice(e.target.value)}
            className={inputClass}
          >
            {SCALE_DEVICE_LIST.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-700">Резервные (spare)</div>
          <div className="text-xs text-slate-500">Адаптер: {WEB_SERIAL_ADAPTER_ID}</div>
          <label className={labelClass}>Модель терминала</label>
          <select
            value={spareDevice}
            onChange={(e) => setSpareDevice(e.target.value)}
            className={inputClass}
          >
            <option value="">Не задано</option>
            {SCALE_DEVICE_LIST.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-1 text-sm text-slate-700">
        <div>
          Активный комплект:{' '}
          <span className="font-semibold">
            {SCALE_SET_LABELS[activeSet]}
          </span>
        </div>
        <div>
          Режим камер: {runtime ? SCALE_SET_LABELS[runtime.camera_mode] : '—'}
        </div>
        <div>
          ANPR:{' '}
          {runtime ? ANPR_MODE_LABELS[runtime.anpr_mode] : '—'}
        </div>
        <div className="text-xs text-slate-500 pt-1">
          Последнее переключение:{' '}
          {runtime?.last_switch_at
            ? `${runtime.last_switch_reason ? SWITCH_REASON_LABELS[runtime.last_switch_reason] : '—'}; ${runtime.last_switch_operator_name || '—'}; ${formatAt(runtime.last_switch_at)}${runtime.last_switch_comment ? `; ${runtime.last_switch_comment}` : ''}`
            : 'ещё не было'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={activeSet === 'primary'}
          onClick={() => setWizardTarget('primary')}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Основные
        </button>
        <button
          type="button"
          disabled={activeSet === 'spare'}
          onClick={() => setWizardTarget('spare')}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Резервные
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
        >
          <Save size={16} />
          Сохранить площадку
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
            <CheckCircle2 size={16} /> Сохранено
          </span>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Журнал переключений
        </h4>
        {journal.length === 0 ? (
          <p className="text-sm text-slate-500">Записей пока нет</p>
        ) : (
          <ul className="max-h-48 space-y-2 overflow-y-auto text-sm text-slate-700">
            {journal.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-slate-100 bg-white px-3 py-2"
              >
                <div className="font-medium">
                  {SCALE_SET_LABELS[entry.from_set]} → {SCALE_SET_LABELS[entry.to_set]}
                  {' · '}
                  {SWITCH_REASON_LABELS[entry.reason]}
                </div>
                <div className="text-xs text-slate-500">
                  {entry.operator_name || '—'} · {formatAt(entry.switched_at)}
                  {entry.comment ? ` · ${entry.comment}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ScaleSetSwitchWizard
        open={wizardTarget !== null}
        targetSet={wizardTarget}
        operatorName={operatorName}
        operatorId={operatorId}
        onClose={() => setWizardTarget(null)}
        onApplied={() => {
          setWizardTarget(null);
          refresh();
        }}
      />
    </div>
  );
}
