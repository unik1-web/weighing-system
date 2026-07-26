import { useState, useCallback, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/components/LoginPage';
import { WeighingForm } from '@/components/WeighingForm';
import { WeighingJournal } from '@/components/WeighingJournal';
import { DictionariesView } from '@/components/DictionariesView';
import { ReportsView } from '@/components/ReportsView';
import { UserManagement } from '@/components/UserManagement';
import { SettingsView } from '@/components/SettingsView';
import { printTicket } from '@/components/PrintAct';
import type { WeighingTicket } from '@/lib/storage';
import { Scale, BookOpen, Library, Truck, BarChart3, LogOut, User, Users, ShieldCheck, Settings } from 'lucide-react';

type Tab = 'weighing' | 'journal' | 'reports' | 'dictionaries' | 'users' | 'settings';

function MainApp() {
  const { displayName, signOut, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('weighing');
  const [journalKey, setJournalKey] = useState(0);

  const handleSaved = useCallback((ticket: WeighingTicket) => {
    setJournalKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ticket = (e as CustomEvent<WeighingTicket>).detail;
      printTicket(ticket);
    };
    window.addEventListener('print-ticket', handler);
    return () => window.removeEventListener('print-ticket', handler);
  }, []);

  const tabs: { id: Tab; label: string; icon: typeof Scale; adminOnly?: boolean }[] = [
    { id: 'weighing', label: 'Взвешивание', icon: Scale },
    { id: 'journal', label: 'Журнал', icon: BookOpen },
    { id: 'reports', label: 'Отчёты', icon: BarChart3 },
    { id: 'dictionaries', label: 'Справочники', icon: Library },
    { id: 'settings', label: 'Настройки', icon: Settings },
    { id: 'users', label: 'Пользователи', icon: Users, adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

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
                <p className="text-xs text-slate-500">Полигон отходов</p>
              </div>
            </div>

            <nav className="flex gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto">
              {visibleTabs.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-semibold transition whitespace-nowrap ${tab === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                    <Icon size={16} />
                    <span className="hidden sm:inline">{t.label}</span>
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
              <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                <LogOut size={15} /> <span className="hidden sm:inline">Выйти</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {tab === 'weighing' && <WeighingForm onSaved={handleSaved} />}
        {tab === 'journal' && <WeighingJournal refreshKey={journalKey} />}
        {tab === 'reports' && <ReportsView />}
        {tab === 'dictionaries' && <DictionariesView />}
        {tab === 'settings' && <SettingsView />}
        {tab === 'users' && isAdmin && <UserManagement />}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-slate-400">
          Система учёта взвешивания · Полигон отходов
        </div>
      </footer>
    </div>
  );
}

function AuthGate() {
  const { session, loading } = useAuth();

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

  return <MainApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
