import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Users, Shield, User as UserIcon, Trash2, Pencil, Check, X, ShieldCheck } from 'lucide-react';

interface ProfileRow {
  user_id: string;
  username: string;
  display_name: string;
  role: 'user' | 'admin';
  created_at: string;
}

export function UserManagement() {
  const { isAdmin } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setProfiles((data ?? []) as ProfileRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveEdit = async () => {
    if (!editingId) return;
    setError(null);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: editName.trim(), role: editRole })
      .eq('user_id', editingId);
    if (error) {
      setError(error.message);
    } else {
      setEditingId(null);
      await load();
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Удалить пользователя? Это действие необратимо.')) return;
    setError(null);
    const { error } = await supabase.from('profiles').delete().eq('user_id', userId);
    if (error) {
      setError(error.message);
    } else {
      await load();
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <div className="text-center">
          <Shield size={40} className="mx-auto mb-3 text-slate-300" />
          <p>Доступ только для администраторов</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users size={22} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-800">Управление пользователями</h2>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Логин</th>
                <th className="px-5 py-3 text-left font-medium">ФИО</th>
                <th className="px-5 py-3 text-center font-medium">Роль</th>
                <th className="px-5 py-3 text-left font-medium">Создан</th>
                <th className="px-5 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Загрузка...</td></tr>
              ) : profiles.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Нет пользователей</td></tr>
              ) : (
                profiles.map((p) => (
                  <tr key={p.user_id} className="hover:bg-slate-50/50 transition">
                    {editingId === p.user_id ? (
                      <>
                        <td className="px-5 py-2.5 font-medium text-slate-700">{p.username}</td>
                        <td className="px-5 py-2.5">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                            autoFocus
                          />
                        </td>
                        <td className="px-5 py-2.5 text-center">
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as 'user' | 'admin')}
                            className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                          >
                            <option value="user">Пользователь</option>
                            <option value="admin">Администратор</option>
                          </select>
                        </td>
                        <td className="px-5 py-2.5 text-slate-500">{new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
                        <td className="px-5 py-2.5 text-right">
                          <button onClick={saveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={16} /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded ml-1"><X size={16} /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-5 py-2.5 font-medium text-slate-700">
                          <div className="flex items-center gap-2">
                            <UserIcon size={14} className="text-slate-400" />
                            {p.username}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-slate-700">{p.display_name || '—'}</td>
                        <td className="px-5 py-2.5 text-center">
                          {p.role === 'admin' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                              <ShieldCheck size={12} /> Администратор
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                              <UserIcon size={12} /> Пользователь
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-slate-500">{new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
                        <td className="px-5 py-2.5 text-right">
                          <button
                            onClick={() => { setEditingId(p.user_id); setEditName(p.display_name); setEditRole(p.role); }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(p.user_id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition ml-1"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-blue-50/50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700 mb-1">Подсказка</p>
        <p>Новые пользователи регистрируются самостоятельно через экран входа. Здесь администратор может изменить ФИО, назначить роль или удалить пользователя. Первый зарегистрированный пользователь должен быть назначен администратором вручную через базу данных.</p>
      </div>
    </div>
  );
}
