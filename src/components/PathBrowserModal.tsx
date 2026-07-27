import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { ChevronUp, Folder, FolderOpen, HardDrive, X, FileText } from 'lucide-react';

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  current: string;
  parent: string;
  roots: BrowseEntry[];
  directories: BrowseEntry[];
  files: BrowseEntry[];
  mode: 'file' | 'directory';
}

interface Props {
  open: boolean;
  mode: 'file' | 'directory';
  title: string;
  extensions?: string[];
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function PathBrowserModal({
  open,
  mode,
  title,
  extensions,
  initialPath,
  onClose,
  onSelect,
}: Props) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [roots, setRoots] = useState<BrowseEntry[]>([]);
  const [directories, setDirectories] = useState<BrowseEntry[]>([]);
  const [files, setFiles] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPath = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { mode };
      if (path) params.path = path;
      if (extensions?.length) params.extensions = extensions.join(',');

      const result = await apiGet<BrowseResult & { success: true }>('/api/browse', params);
      setCurrentPath(result.current);
      setParentPath(result.parent);
      setRoots(result.roots);
      setDirectories(result.directories);
      setFiles(result.files);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось открыть каталог';
      if (message.includes('API endpoint not found') || message.includes('Конечная точка API')) {
        setError('Backend устарел или не перезапущен. Остановите и запустите снова: npm run dev:api или npm start');
      } else if (message.includes('Backend не отвечает')) {
        setError('Backend не запущен. Выполните: npm run dev:api или npm start');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [extensions, mode]);

  useEffect(() => {
    if (!open) return;
    void loadPath(initialPath?.trim() || undefined);
  }, [open, initialPath, loadPath]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <p className="mt-1 text-xs text-slate-500 break-all">{currentPath || 'Загрузка...'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
          {roots.map((root) => (
            <button
              key={root.path}
              type="button"
              onClick={() => void loadPath(root.path)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <HardDrive size={14} /> {root.name}
            </button>
          ))}
          {parentPath && (
            <button
              type="button"
              onClick={() => void loadPath(parentPath)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <ChevronUp size={14} /> Вверх
            </button>
          )}
        </div>

        <div className="min-h-[280px] flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Загрузка...</p>
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : (
            <div className="space-y-1">
              {directories.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void loadPath(entry.path)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Folder size={16} className="shrink-0 text-amber-500" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
              {mode === 'file' && files.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => onSelect(entry.path)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50"
                >
                  <FileText size={16} className="shrink-0 text-blue-500" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
              {!loading && directories.length === 0 && (mode === 'directory' || files.length === 0) && (
                <p className="py-8 text-center text-sm text-slate-400">Каталог пуст</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Отмена
          </button>
          {mode === 'directory' && currentPath && (
            <button
              type="button"
              onClick={() => onSelect(currentPath)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              <FolderOpen size={16} /> Выбрать каталог
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
