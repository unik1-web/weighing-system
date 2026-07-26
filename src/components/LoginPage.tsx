import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Truck, Lock, User, UserPlus, LogIn, AlertCircle, Hash } from 'lucide-react';

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    
    try {
      if (mode === 'login') {
        console.log('[LoginPage] Attempting login for:', username);
        const { error } = await signIn(username, password);
        if (error) {
          console.log('[LoginPage] Login failed:', error);
          setError(error);
        } else {
          console.log('[LoginPage] Login successful');
          // Clear form - will navigate via AuthGate automatically
          setUsername('');
          setPassword('');
        }
      } else {
        console.log('[LoginPage] Attempting signup for:', username);
        const { error } = await signUp(username, password, name);
        if (error) {
          console.log('[LoginPage] Signup failed:', error);
          setError(error);
        } else {
          console.log('[LoginPage] Signup successful');
          // Clear form
          setUsername('');
          setPassword('');
          setName('');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg">
            <Truck size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Автомобильные весы</h1>
          <p className="text-sm text-slate-400">Полигон отходов · Вход в систему</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <div className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold transition ${
                mode === 'login' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              <LogIn size={16} /> Вход
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold transition ${
                mode === 'register' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              <UserPlus size={16} /> Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">ФИО / Имя весовщика</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Иванов И.И."
                    required
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email или логин</label>
              <div className="relative">
                <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ivanov или ivanov@example.com"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Пароль</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
