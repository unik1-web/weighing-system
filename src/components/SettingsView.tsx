import { useState, useEffect } from 'react';
import {
  SettingsStorage,
  PRINT_LAYOUT_LABELS,
  type AppSettings,
  type PrintLayout,
} from '@/lib/storage';
import { Settings, Building2, Printer, Save, CheckCircle2 } from 'lucide-react';

const LAYOUT_OPTIONS: PrintLayout[] = ['act', 'receipt'];

export function SettingsView() {
  const [settings, setSettings] = useState<AppSettings>(() => SettingsStorage.getAppSettings());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(SettingsStorage.getAppSettings());
  }, []);

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    SettingsStorage.updateAppSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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
