import { useState, useCallback, useEffect, useMemo } from 'react';
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

  const compactTabs = appSettings.nav_tab_mode === 'compact';

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-sm">
                <Truck size={22} />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-800 leading-tight">Автомобильные весы</h1>
                <p className="text-xs text-slate-500">
                  Полигон отходов
                  {appSettings.org_name && appSettings.org_name !== 'Полигон отходов' && (
                    <> · {appSettings.org_name}</>
                  )}
                </p>
              </div>
            </div>

            <nav className="flex gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto">
              {tabs.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={compactTabs ? t.label : undefined}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center rounded-lg py-2 text-sm font-semibold transition whitespace-nowrap ${
                      compactTabs ? 'justify-center gap-0 px-2.5' : 'gap-2 px-3 sm:px-4'
                    } ${tab === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                  >
                    <Icon size={16} />
                    {!compactTabs && <span>{t.label}</span>}
                  </button>
                );
              })}
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5">
                <User size={15} className="text-slate-500" />
                <span className="text-sm font-medium text-slate-700">{displayName}</span>
                {isAdmin && (
                  <span className="flex items-center gap-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <ShieldCheck size={10} /> АДМ
                  </span>
                )}
              </div>
              <button
                type="button"
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
