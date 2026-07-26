import { useState } from 'react';
import { DictionaryManager } from './DictionaryManager';
import { UserManagement } from './UserManagement';
import { DICTIONARY_LABELS, type DictionaryTable } from '@/lib/storage';
import { useAuth } from '@/hooks/useAuth';
import { Truck, User, Package, Building2, Users, ChevronRight, ShieldCheck } from 'lucide-react';

const TABLES: DictionaryTable[] = ['vehicles', 'drivers', 'cargos', 'shippers', 'receivers', 'carriers'];

const ICONS: Record<DictionaryTable, typeof Truck> = {
  vehicles: Truck,
  drivers: User,
  cargos: Package,
  shippers: Building2,
  receivers: Building2,
  carriers: Users,
};

type DictionarySection = DictionaryTable | 'users';

export function DictionariesView() {
  const { isAdmin } = useAuth();
  const [active, setActive] = useState<DictionarySection>('vehicles');

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm h-fit">
        <h2 className="px-3 py-2 text-xs font-semibold uppercase text-slate-400">Справочники</h2>
        <nav className="space-y-1">
          {TABLES.map((t) => {
            const Icon = ICONS[t];
            return (
              <button
                key={t}
                onClick={() => setActive(t)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active === t ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={18} className={active === t ? 'text-blue-600' : 'text-slate-400'} />
                {DICTIONARY_LABELS[t]}
                <ChevronRight size={16} className={`ml-auto ${active === t ? 'text-blue-400' : 'text-slate-300'}`} />
              </button>
            );
          })}
          {isAdmin && (
            <>
              <div className="my-2 border-t border-slate-100" />
              <button
                onClick={() => setActive('users')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active === 'users' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ShieldCheck size={18} className={active === 'users' ? 'text-blue-600' : 'text-slate-400'} />
                Пользователи
                <ChevronRight size={16} className={`ml-auto ${active === 'users' ? 'text-blue-400' : 'text-slate-300'}`} />
              </button>
            </>
          )}
        </nav>
      </div>

      {active === 'users' ? <UserManagement /> : <DictionaryManager table={active} />}
    </div>
  );
}
