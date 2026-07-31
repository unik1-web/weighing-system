import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SessionStorage,
  SettingsStorage,
  SiteRuntimeStorage,
  SiteStorage,
  ScaleStorage,
  ScaleSwitchJournalStorage,
  type ScaleConnectionJson,
  type ScaleSet,
} from '@/lib/storage';
import {
  ANPR_MODE_LABELS,
  DEFAULT_SITE_ID,
  SCALE_SET_LABELS,
  SITE_RUNTIME_CHANGED_EVENT,
  SWITCH_REASON_LABELS,
  ensureDefaultSiteAndScales,
  updateScaleConfiguration,
  getActiveScale,
} from '@/lib/site';
import { SCALE_ADAPTER_CATALOG, type ScaleTransport } from '@/lib/scale-adapters/contract';
import {
  previewScaleConnectionDraft,
  validateScaleConnectionDraft,
} from '@/lib/scale-adapters/registry';
import { ScaleConnectionFields } from '@/components/ScaleConnectionFields';
import { ScaleSetSwitchWizard } from '@/components/ScaleSetSwitchWizard';
import { Building2, Save, CheckCircle2 } from 'lucide-react';
import { scaleConnection } from '@/lib/scales';
import { logger } from '@/lib/logger';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600';

function formatAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU');
}

export type ScaleDraft = {
  adapter_id: string;
  connection: ScaleConnectionJson;
};

export type DraftErrors = {
  primary: string[];
  spare: string[];
};

function cloneConnection(connection: ScaleConnectionJson): ScaleConnectionJson {
  return {
    transport: connection.transport,
    device_id: connection.device_id,
    serial: connection.serial ? { ...connection.serial } : undefined,
    tcp: connection.tcp ? { ...connection.tcp } : undefined,
    parser: connection.parser ? { ...connection.parser } : undefined,
  };
}

function createDraft(adapterId: string, connection: ScaleConnectionJson): ScaleDraft {
  return {
    adapter_id: adapterId,
    connection: cloneConnection(connection),
  };
}

function buildConnectionForSave(draft: ScaleDraft): ScaleConnectionJson {
  const connection = cloneConnection(draft.connection);
  const preview = previewScaleConnectionDraft(
    draft.adapter_id,
    connection,
    connection.parser?.test_frame,
  );
  if (preview && connection.parser) {
    connection.parser.validation_status = preview.validation_status;
    connection.parser.validation_error_code = preview.validation_error_code;
    connection.parser.validation_error_message = preview.validation_error_message;
    connection.parser.last_validation_at = new Date().toISOString();
  }
  return connection;
}

export function validateScaleDraft(draft: ScaleDraft): string[] {
  const connection = cloneConnection(draft.connection);
  const errors: string[] = [...validateScaleConnectionDraft(draft.adapter_id, connection).errors];
  const preview = previewScaleConnectionDraft(
    draft.adapter_id,
    connection,
    connection.parser?.test_frame,
  );
  if (preview && !preview.valid) {
    if (preview.validation_error_code) {
      errors.push(preview.validation_error_code);
    }
    if (preview.validation_error_message) {
      errors.push(preview.validation_error_message);
    }
  }
  return errors;
}

function normalizeTransport(adapterId: string, transport: ScaleTransport): ScaleTransport {
  const adapter = SCALE_ADAPTER_CATALOG.adapters.find((item) => item.id === adapterId);
  if (!adapter) return transport;
  return adapter.transports.includes(transport) ? transport : adapter.transports[0];
}

export function updateScaleDraftAdapter(draft: ScaleDraft, nextAdapterId: string): ScaleDraft {
  const nextTransport = normalizeTransport(nextAdapterId, draft.connection.transport);
  const nextConnection: ScaleConnectionJson = {
    ...draft.connection,
    transport: nextTransport,
  };
  if (nextAdapterId === 'generic-regex') {
    nextConnection.device_id = null;
    nextConnection.parser = nextConnection.parser ?? {
      kind: 'regex',
      pattern: '',
      flags: 'i',
      weight_group: 1,
      stability_group: null,
      stable_values: ['ST'],
      unstable_values: ['US'],
      unit_group: null,
      validation_status: 'pending_runtime',
      last_validation_at: null,
      validation_error_code: null,
      validation_error_message: null,
    };
  }
  return { adapter_id: nextAdapterId, connection: nextConnection };
}

interface Props {
  onDraftErrorsChange?: (errors: DraftErrors) => void;
}

export function SiteScalesSettingsSection({ onDraftErrorsChange }: Props) {
  const [siteName, setSiteName] = useState('');
  const [primaryDraft, setPrimaryDraft] = useState<ScaleDraft | null>(null);
  const [spareDraft, setSpareDraft] = useState<ScaleDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [wizardTarget, setWizardTarget] = useState<ScaleSet | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    ensureDefaultSiteAndScales(SettingsStorage.getAppSettings());
    const site = SiteStorage.getById(DEFAULT_SITE_ID);
    const primary = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'primary');
    const spare = ScaleStorage.getByRole(DEFAULT_SITE_ID, 'spare');
    setSiteName(site?.name ?? 'Площадка по умолчанию');
    if (primary) {
      setPrimaryDraft(createDraft(primary.adapter_id, primary.connection));
    }
    if (spare) {
      setSpareDraft(createDraft(spare.adapter_id, spare.connection));
    }
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
  const activeScale = useMemo(() => getActiveScale(DEFAULT_SITE_ID), [tick]);
  const isScaleConnected = useMemo(() => scaleConnection.isConnected(), [tick]);
  const draftErrors: DraftErrors = {
    primary: primaryDraft ? validateScaleDraft(primaryDraft) : [],
    spare: spareDraft ? validateScaleDraft(spareDraft) : [],
  };

  useEffect(() => {
    onDraftErrorsChange?.(draftErrors);
  }, [draftErrors, onDraftErrorsChange]);

  const handleSave = () => {
    if (draftErrors.primary.length > 0 || draftErrors.spare.length > 0) {
      logger.scaleRuntime.warn(
        'Сохранение конфигурации отклонено: невалидный draft адаптера',
        {
          site_id: DEFAULT_SITE_ID,
          scale_id: null,
          scale_role: null,
          adapter_id: null,
          transport: null,
          session_id: null,
          code: 'invalid_adapter_draft',
          phase: 'settings_save_validation',
        },
        draftErrors,
      );
      return;
    }

    const site = SiteStorage.getById(DEFAULT_SITE_ID);
    SiteStorage.upsert({
      id: DEFAULT_SITE_ID,
      name: siteName.trim() || 'Площадка по умолчанию',
      created_at: site?.created_at ?? new Date().toISOString(),
    });

    if (primary && primaryDraft) {
      updateScaleConfiguration(
        primary.id,
        {
          adapter_id: primaryDraft.adapter_id,
          connection: buildConnectionForSave(primaryDraft),
        },
        activeSet === 'primary',
      );
      logger.scaleRuntime.info(
        'Конфигурация primary сохранена',
        {
          site_id: primary.site_id,
          scale_id: primary.id,
          scale_role: primary.role,
          adapter_id: primaryDraft.adapter_id,
          transport: primaryDraft.connection.transport,
          session_id: null,
          code: null,
          phase: 'settings_save_success',
        },
      );
    }
    if (spare && spareDraft) {
      updateScaleConfiguration(
        spare.id,
        {
          adapter_id: spareDraft.adapter_id,
          connection: buildConnectionForSave(spareDraft),
        },
        activeSet === 'spare',
      );
      logger.scaleRuntime.info(
        'Конфигурация spare сохранена',
        {
          site_id: spare.site_id,
          scale_id: spare.id,
          scale_role: spare.role,
          adapter_id: spareDraft.adapter_id,
          transport: spareDraft.connection.transport,
          session_id: null,
          code: null,
          phase: 'settings_save_success',
        },
      );
    }

    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    refresh();
  };

  const session = SessionStorage.getSession();
  const operatorName = session?.profile.display_name || 'Оператор';
  const operatorId = session?.user.id ?? null;

  const adapterOptions = SCALE_ADAPTER_CATALOG.adapters;
  const transportOptions = Object.entries(SCALE_ADAPTER_CATALOG.transports);

  const renderDraft = (
    title: string,
    draft: ScaleDraft | null,
    setDraft: (next: ScaleDraft) => void,
    errors: string[],
  ) => {
    if (!draft) {
      return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
          <div className="text-xs text-slate-500">Нет данных комплекта</div>
        </div>
      );
    }
    const adapter = adapterOptions.find((item) => item.id === draft.adapter_id);
    const supportedTransports = adapter?.transports ?? ['web_serial'];
    const isBuiltin = adapter?.kind === 'builtin';
    const isGenericRegex = adapter?.id === 'generic-regex';
    const preview =
      draft.adapter_id === 'generic-regex'
        ? previewScaleConnectionDraft(
            draft.adapter_id,
            draft.connection,
            draft.connection.parser?.test_frame,
          )
        : null;
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-3">
        <div className="text-xs font-semibold text-slate-700">{title}</div>
        <div>
          <label className={labelClass}>adapter_id</label>
          <select
            value={draft.adapter_id}
            onChange={(event) => setDraft(updateScaleDraftAdapter(draft, event.target.value))}
            className={inputClass}
          >
            {adapterOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>transport</label>
          <select
            value={draft.connection.transport}
            onChange={(event) =>
              setDraft({
                ...draft,
                connection: {
                  ...draft.connection,
                  transport: event.target.value as ScaleTransport,
                },
              })
            }
            className={inputClass}
          >
            {transportOptions
              .filter(([transport]) => supportedTransports.includes(transport as ScaleTransport))
              .map(([transport, value]) => (
                <option key={transport} value={transport}>
                  {transport} ({value.label})
                </option>
              ))}
          </select>
        </div>
        {isBuiltin && (
          <div>
            <label className={labelClass}>device_id</label>
            <input
              value={draft.connection.device_id ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  connection: {
                    ...draft.connection,
                    device_id: event.target.value || null,
                  },
                })
              }
              placeholder="cas / newton / microsim-m0601 / midl-mi-vda"
              className={inputClass}
            />
          </div>
        )}
        <ScaleConnectionFields
          adapterId={draft.adapter_id}
          connection={draft.connection}
          onChange={(connection) =>
            setDraft({
              ...draft,
              connection,
            })
          }
        />
        {isGenericRegex && preview?.valid && preview.validation_status === 'pending_runtime' && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Статус: pending_runtime. Конфигурация синтаксически валидна, runtime будет подтверждён после живого чтения.
          </div>
        )}
        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {errors.join('; ')}
          </div>
        )}
      </div>
    );
  };

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
        {renderDraft('Основные (primary)', primaryDraft, setPrimaryDraft, draftErrors.primary)}
        {renderDraft('Резервные (spare)', spareDraft, setSpareDraft, draftErrors.spare)}
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
        <div>
          Активный adapter_id: {activeScale?.adapter_id ?? '—'}
        </div>
        <div>
          Активный transport: {activeScale?.connection.transport ?? '—'}
        </div>
        <div>
          Статус подключения: {isScaleConnected ? 'подключено' : 'отключено'}
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
          disabled={draftErrors.primary.length > 0 || draftErrors.spare.length > 0}
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
          const previousSet = activeSet;
          const nextSet = wizardTarget;
          if (nextSet) {
            logger.scaleRuntime.info(
              'Переключение active scale set выполнено',
              {
                site_id: DEFAULT_SITE_ID,
                scale_id: null,
                scale_role: nextSet,
                adapter_id: null,
                transport: null,
                session_id: null,
                code: null,
                phase: `switch_${previousSet}_to_${nextSet}`,
              },
            );
          }
          setWizardTarget(null);
          refresh();
        }}
      />
    </div>
  );
}
