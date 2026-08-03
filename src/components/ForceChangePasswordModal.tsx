import { useState, FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { KeyRound, Loader2 } from 'lucide-react';

const DEFAULT_PASSWORD = 'admin123';

/** Blocking modal: cannot dismiss until password is changed. */
export function ForceChangePasswordModal() {
  const { changePassword, username } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!currentPassword) {
      setError('Введите текущий пароль');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен быть не короче 6 символов');
      return;
    }
    if (password === DEFAULT_PASSWORD) {
      setError('Нельзя использовать пароль по умолчанию');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    const result = await changePassword({
      newPassword: password,
      currentPassword,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="force-change-password-title"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-amber-600" />
            <h2 id="force-change-password-title" className="text-sm font-semibold text-slate-800">
              Смените пароль
            </h2>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Учётная запись <span className="font-medium">{username || 'admin'}</span> использует
            пароль по умолчанию. Продолжение работы возможно только после смены пароля.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Текущий пароль</label>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Новый пароль</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Подтверждение</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            Сохранить новый пароль
          </button>
        </form>
      </div>
    </div>
  );
}
