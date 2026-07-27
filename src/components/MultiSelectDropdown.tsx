import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

interface Props {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = 'Выберите значения',
  emptyMessage = 'Список пуст',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru');
    if (!normalized) return options;
    return options.filter((option) => option.toLocaleLowerCase('ru').includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const toggleOption = (option: string) => {
    if (selectedSet.has(option)) {
      onChange(selected.filter((item) => item !== option));
      return;
    }
    onChange([...selected, option]);
  };

  const selectAllFiltered = () => {
    const merged = new Set(selected);
    filteredOptions.forEach((option) => merged.add(option));
    onChange(Array.from(merged));
  };

  const clearAllFiltered = () => {
    const filtered = new Set(filteredOptions);
    onChange(selected.filter((option) => !filtered.has(option)));
  };

  const triggerLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `Выбрано: ${selected.length}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-800 outline-none transition hover:border-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className={`truncate pr-2 ${selected.length === 0 ? 'text-slate-400' : ''}`}>{triggerLabel}</span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск..."
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            {filteredOptions.length > 0 && (
              <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Отметить все
                </button>
                <button
                  type="button"
                  onClick={clearAllFiltered}
                  className="font-medium text-slate-500 hover:text-slate-700"
                >
                  Снять все
                </button>
              </div>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500">{emptyMessage}</p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500">Ничего не найдено</p>
            ) : (
              filteredOptions.map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option)}
                    onChange={() => toggleOption(option)}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="min-w-0 flex-1 break-words text-slate-700">{option}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}

      {selected.length > 1 && (
        <p className="mt-2 text-xs text-slate-500">
          {selected.slice(0, 3).join('; ')}
          {selected.length > 3 ? ` и ещё ${selected.length - 3}` : ''}
        </p>
      )}
    </div>
  );
}
