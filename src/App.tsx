import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/components/LoginPage';
import { WeighingForm } from '@/components/WeighingForm';
import { WeighingJournal } from '@/components/WeighingJournal';
import { DictionariesView } from '@/components/DictionariesView';
import { ReportsView } from '@/components/ReportsView';
import { SettingsView } from '@/components/SettingsView';
import { ArchiveView } from '@/components/ArchiveView';
import { VescomImportView } from '@/components/VescomImportView';
import { MetraImportView } from '@/components/MetraImportView';
import { WaImportView } from '@/components/WaImportView';
import { ForceChangePasswordModal } from '@/components/ForceChangePasswordModal';
import { printTicket } from '@/components/PrintAct';
import { SettingsStorage } from '@/lib/storage';
import type { WeighingTicket } from '@/lib/storage';
import { Scale, BookOpen, Library, Truck, BarChart3, LogOut, Power, User, ShieldCheck, Settings, Database, HardDrive, Server, Archive } from 'lucide-react';
import { exitApplication } from '@/lib/api';
import { logger } from '@/lib/logger';

type Tab = 'weighing' | 'journal' | 'archive' | 'reports' | 'dictionaries' | 'vescom' | 'metra' | 'wa' | 'settings';

type HeaderDensity = {
  showBrandText: boolean;
  showUserName: boolean;
  showTabLabels: boolean;
};

const HEADER_FULL: HeaderDensity = {
  showBrandText: true,
  showUserName: true,
  showTabLabels: true,
};

function MainApp() {
  const { displayName, signOut, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('weighing');
  const [journalKey, setJournalKey] = useState(0);
  const [settingsKey, setSettingsKey] = useState(0);
  const [completionTicketId, setCompletionTicketId] = useState<string | null>(null);

  const [exiting, setExiting] = useState(false);

  const handleExitApplication = useCallback(async () => {
    if (exiting) return;
    if (!window.confirm('Закрыть программу? Несохранённые данные будут записаны на диск.')) {
      return;
    }

    setExiting(true);
    try {
      await exitApplication();
      logger.info('app', 'Завершение работы приложения');
      window.close();
    } catch (err: unknown) {
      setExiting(false);
      const message = err instanceof Error ? err.message : 'Не удалось закрыть программу';
      window.alert(message);
    }
  }, [exiting]);

  const handleImported = useCallback(() => {
    setJournalKey((k) => k + 1);
  }, []);

  const appSettings = useMemo(() => SettingsStorage.getAppSettings(), [settingsKey]);

  const handleSaved = useCallback(() => {
    setJournalKey((k) => k + 1);
  }, []);

  const handleCompleteOpen = useCallback((ticketId: string) => {
    setCompletionTicketId(ticketId);
    setTab('weighing');
  }, []);

  const handleCompletionHandled = useCallback(() => {
    setCompletionTicketId(null);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ticket = (e as CustomEvent<WeighingTicket>).detail;
      printTicket(ticket);
    };
    window.addEventListener('print-ticket', handler);
    return () => window.removeEventListener('print-ticket', handler);
  }, []);

  useEffect(() => {
    if (tab === 'vescom' && !appSettings.vescom_enabled) {
      setTab('weighing');
    }
    if (tab === 'metra' && !appSettings.metra_enabled) {
      setTab('weighing');
    }
    if (tab === 'wa' && !appSettings.wa_enabled) {
      setTab('weighing');
    }
  }, [tab, appSettings.vescom_enabled, appSettings.metra_enabled, appSettings.wa_enabled]);

  const tabs: { id: Tab; label: string; icon: typeof Scale }[] = [
    { id: 'weighing', label: 'Взвешивание', icon: Scale },
    { id: 'journal', label: 'Журнал', icon: BookOpen },
    { id: 'archive', label: 'Архив', icon: Archive },
    { id: 'reports', label: 'Отчёты', icon: BarChart3 },
    { id: 'dictionaries', label: 'Справочники', icon: Library },
    ...(appSettings.vescom_enabled
      ? [{ id: 'vescom' as const, label: 'Импорт Vescom', icon: Database }]
      : []),
    ...(appSettings.metra_enabled
      ? [{ id: 'metra' as const, label: 'Импорт Metra', icon: HardDrive }]
      : []),
    ...(appSettings.wa_enabled
      ? [{ id: 'wa' as const, label: 'Импорт WA', icon: Server }]
      : []),
    { id: 'settings', label: 'Настройки', icon: Settings },
  ];

  // Fit-based density: keep full tab labels whenever they fit; collapse brand/user first.
  const [density, setDensity] = useState<HeaderDensity>(HEADER_FULL);
  const headerRowRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const tabsMeasureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const row = headerRowRef.current;
    const brand = brandRef.current;
    const actions = actionsRef.current;
    const measure = tabsMeasureRef.current;
    if (!row || !brand || !actions || !measure) return;

    const GAP = 12;
    const update = () => {
      const rowWidth = row.clientWidth;
      const tabsNeeded = measure.scrollWidth;

      // Brand icon-only ≈ truck button; full brand measured via data attributes on children.
      const brandIconEl = brand.querySelector('[data-brand-icon]') as HTMLElement | null;
      const brandTextEl = brand.querySelector('[data-brand-text]') as HTMLElement | null;
      const brandIconWidth = brandIconEl?.offsetWidth ?? 40;
      // text node stays measurable even when visually collapsed (invisible/absolute).
      const brandTextWidth = Math.max(brandTextEl?.scrollWidth ?? 0, 120);
      const brandFullWidth = brandIconWidth + GAP + brandTextWidth;

      const userNameEl = actions.querySelector('[data-user-name]') as HTMLElement | null;
      const userChipEl = actions.querySelector('[data-user-chip]') as HTMLElement | null;
      const powerBtn = actions.querySelector('[data-action-power]') as HTMLElement | null;
      const logoutBtn = actions.querySelector('[data-action-logout]') as HTMLElement | null;
      const userNameWidth = Math.max(userNameEl?.scrollWidth ?? 0, 48);
      const userChipPad = 16;
      const userChipIcon = 15 + (isAdmin ? 18 : 0);
      const userChipFull = userChipPad + userChipIcon + 8 + userNameWidth + (isAdmin ? 28 : 0);
      const userChipCompact = userChipPad + userChipIcon + (isAdmin ? 8 : 0);
      const sideBtns =
        (powerBtn?.offsetWidth ?? 36) + (logoutBtn?.offsetWidth ?? 36) + 8;
      const actionsFullWidth = userChipFull + sideBtns + 8;
      const actionsIconWidth = userChipCompact + sideBtns + 8;
      // Prefer live actions width when currently expanded (more accurate padding).
      const actionsWidthLive = Math.max(actions.offsetWidth, actionsIconWidth);

      const fits = (brandW: number, actionsW: number) =>
        tabsNeeded + brandW + actionsW + GAP * 2 <= rowWidth + 0.5;

      if (fits(brandFullWidth, Math.max(actionsFullWidth, actionsWidthLive))) {
        setDensity((prev) =>
          prev.showBrandText && prev.showUserName && prev.showTabLabels
            ? prev
            : { showBrandText: true, showUserName: true, showTabLabels: true },
        );
        return;
      }
      if (fits(brandIconWidth, Math.max(actionsFullWidth, actionsWidthLive))) {
        setDensity((prev) =>
          !prev.showBrandText && prev.showUserName && prev.showTabLabels
            ? prev
            : { showBrandText: false, showUserName: true, showTabLabels: true },
        );
        return;
      }
      if (fits(brandIconWidth, actionsIconWidth)) {
        setDensity((prev) =>
          !prev.showBrandText && !prev.showUserName && prev.showTabLabels
            ? prev
            : { showBrandText: false, showUserName: false, showTabLabels: true },
        );
        return;
      }
      setDensity((prev) =>
        !prev.showBrandText && !prev.showUserName && !prev.showTabLabels
          ? prev
          : { showBrandText: false, showUserName: false, showTabLabels: false },
      );
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(row);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [tabs.length, displayName, isAdmin]);

  const brandTitle = 'Автомобильные весы';
  const brandSubtitle =
    appSettings.org_name && appSettings.org_name !== 'Полигон отходов'
      ? `Полигон отходов · ${appSettings.org_name}`
      : 'Полигон отходов';

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 sm:px-6">
          <div ref={headerRowRef} className="relative flex h-14 items-center gap-2 sm:h-16 sm:gap-3">
            {/* Invisible full-size tab strip for measuring label fit */}
            <div
              ref={tabsMeasureRef}
              className="pointer-events-none invisible absolute left-0 top-0 -z-10 flex gap-1 p-1"
              aria-hidden
            >
              {tabs.map((t) => {
                const Icon = t.icon;
                return (
                  <div
                    key={`m-${t.id}`}
                    className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap"
                  >
                    <Icon size={16} />
                    <span>{t.label}</span>
                  </div>
                );
              })}
            </div>

            <div
              ref={brandRef}
              className="flex shrink-0 items-center gap-2 sm:gap-3"
              title={`${brandTitle} — ${brandSubtitle}`}
            >
              <div
                data-brand-icon
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-sm sm:h-10 sm:w-10"
              >
                <Truck size={22} aria-hidden />
              </div>
              <div
                data-brand-text
                className={
                  density.showBrandText
                    ? 'min-w-0 max-w-[14rem]'
                    : 'pointer-events-none invisible absolute left-0 top-0 -z-10 min-w-0 max-w-[14rem]'
                }
              >
                <h1 className="text-base font-bold leading-tight text-slate-800">{brandTitle}</h1>
                <p className="truncate text-xs text-slate-500">{brandSubtitle}</p>
              </div>
            </div>

            <nav
              className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-100 p-1"
              aria-label="Разделы"
            >
              <div className="flex w-max min-w-full justify-start gap-0.5 sm:gap-1">
                {tabs.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      title={t.label}
                      aria-label={t.label}
                      aria-current={tab === t.id ? 'page' : undefined}
                      onClick={() => setTab(t.id)}
                      className={`flex shrink-0 items-center justify-center rounded-lg py-2 text-sm font-semibold transition whitespace-nowrap ${
                        density.showTabLabels ? 'gap-2 px-3' : 'gap-0 px-2.5'
                      } ${
                        tab === t.id
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      <Icon size={16} aria-hidden />
                      {density.showTabLabels ? <span>{t.label}</span> : null}
                    </button>
                  );
                })}
              </div>
            </nav>

            <div ref={actionsRef} className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <div
                data-user-chip
                className={`flex items-center gap-2 rounded-lg bg-slate-100 ${
                  density.showUserName ? 'px-3 py-1.5' : 'p-2'
                }`}
                title={displayName}
                aria-label={displayName}
              >
                <User size={15} className="text-slate-500" aria-hidden />
                <span
                  data-user-name
                  className={
                    density.showUserName
                      ? 'inline max-w-[8rem] truncate text-sm font-medium text-slate-700'
                      : 'pointer-events-none invisible absolute -z-10 max-w-[8rem] truncate text-sm font-medium text-slate-700'
                  }
                >
                  {displayName}
                </span>
                {isAdmin && (
                  <span
                    className={`flex items-center gap-0.5 rounded-full bg-blue-600 text-[10px] font-bold text-white ${
                      density.showUserName ? 'px-1.5 py-0.5' : 'p-1'
                    }`}
                    title="Администратор"
                  >
                    <ShieldCheck size={10} aria-hidden />
                    {density.showUserName ? <span>АДМ</span> : null}
                  </span>
                )}
              </div>
              <button
                type="button"
                data-action-power
                onClick={handleExitApplication}
                disabled={exiting}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                title={exiting ? 'Выход...' : 'Выход'}
                aria-label={exiting ? 'Выход...' : 'Выход'}
              >
                <Power size={15} />
              </button>
              <button
                type="button"
                data-action-logout
                onClick={signOut}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                title="Сменить пользователя"
                aria-label="Сменить пользователя"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {tab === 'weighing' && (
          <WeighingForm
            onSaved={handleSaved}
            completionTicketId={completionTicketId}
            onCompletionHandled={handleCompletionHandled}
          />
        )}
        {tab === 'journal' && (
          <WeighingJournal refreshKey={journalKey} onCompleteOpen={handleCompleteOpen} />
        )}
        {tab === 'archive' && <ArchiveView />}
        {tab === 'reports' && <ReportsView />}
        {tab === 'dictionaries' && <DictionariesView />}
        {tab === 'vescom' && appSettings.vescom_enabled && (
          <VescomImportView onImported={handleImported} />
        )}
        {tab === 'metra' && appSettings.metra_enabled && (
          <MetraImportView onImported={handleImported} />
        )}
        {tab === 'wa' && appSettings.wa_enabled && (
          <WaImportView onImported={handleImported} />
        )}
        {tab === 'settings' && <SettingsView onSaved={() => setSettingsKey((k) => k + 1)} />}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-slate-400">
          Система учёта взвешивания · Полигон отходов
          <span className="ml-2 text-slate-300">· сборка {__APP_BUILD_ID__}</span>
        </div>
      </footer>
    </div>
  );
}

function AuthGate() {
  const { session, loading, mustChangePassword } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-slate-400 text-sm">Загрузка...</div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  return (
    <>
      <MainApp />
      {mustChangePassword ? <ForceChangePasswordModal /> : null}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
