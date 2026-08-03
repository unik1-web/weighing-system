import { useMemo } from 'react';
import {
  TicketAuditStorage,
  TicketRevisionStorage,
  type TicketAuditEvent,
  type TicketRevision,
} from '@/lib/storage';
import { History } from 'lucide-react';

const ACTION_LABELS: Record<TicketAuditEvent['action'], string> = {
  created: 'Создан',
  completed: 'Завершён',
  auto_closed: 'Авто-закрыт',
  updated: 'Обновлён',
};

interface Props {
  ticketId: string;
  /** Optional preloaded audit (e.g. archive year). */
  audit?: TicketAuditEvent[];
  /** Optional preloaded revisions (e.g. archive year). */
  revisions?: TicketRevision[];
}

export function TicketHistoryPanel({ ticketId, audit, revisions }: Props) {
  const events = useMemo(() => {
    const list = audit ?? TicketAuditStorage.getByTicketId(ticketId);
    return [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [ticketId, audit]);

  const fieldRevisions = useMemo(() => {
    const list = revisions ?? TicketRevisionStorage.getByTicketId(ticketId);
    return [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [ticketId, revisions]);

  const revisionsByAt = useMemo(() => {
    const map = new Map<string, TicketRevision[]>();
    for (const rev of fieldRevisions) {
      const key = rev.at;
      const bucket = map.get(key) ?? [];
      bucket.push(rev);
      map.set(key, bucket);
    }
    return map;
  }, [fieldRevisions]);

  if (events.length === 0 && fieldRevisions.length === 0) {
    return (
      <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-600">
          <History size={14} /> История изменений
        </div>
        История изменений отсутствует
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <History size={14} /> История изменений
      </div>
      <ul className="max-h-56 space-y-2 overflow-y-auto text-xs text-slate-700">
        {events.map((ev) => {
          const nested = revisionsByAt.get(ev.at) ?? [];
          return (
            <li key={ev.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-slate-800">
                  {ACTION_LABELS[ev.action] ?? ev.action}
                </span>
                <span className="tabular-nums text-slate-500">
                  {new Date(ev.at).toLocaleString('ru-RU')}
                </span>
              </div>
              <div className="mt-0.5 text-slate-500">
                {ev.operator_name || '—'}
              </div>
              {nested.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-slate-50 pt-2">
                  {nested.map((rev) => (
                    <li key={rev.id} className="text-slate-600">
                      <span className="font-medium text-slate-700">{rev.field}</span>:{' '}
                      <span className="text-slate-400">{rev.old_value ?? '∅'}</span>
                      {' → '}
                      <span>{rev.new_value ?? '∅'}</span>
                      {(rev.operator_name || rev.at !== ev.at) && (
                        <span className="ml-1 text-slate-400">
                          ({rev.operator_name || '—'},{' '}
                          {new Date(rev.at).toLocaleString('ru-RU')})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {/* Orphan revisions without matching audit timestamp */}
        {fieldRevisions
          .filter((rev) => !events.some((ev) => ev.at === rev.at))
          .map((rev) => (
            <li key={`orphan-${rev.id}`} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-slate-800">{rev.field}</span>
                <span className="tabular-nums text-slate-500">
                  {new Date(rev.at).toLocaleString('ru-RU')}
                </span>
              </div>
              <div className="text-slate-600">
                <span className="text-slate-400">{rev.old_value ?? '∅'}</span>
                {' → '}
                <span>{rev.new_value ?? '∅'}</span>
              </div>
              <div className="mt-0.5 text-slate-500">{rev.operator_name || '—'}</div>
            </li>
          ))}
      </ul>
    </div>
  );
}
