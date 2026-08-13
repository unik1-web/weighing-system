import { describe, expect, it } from 'vitest';
import { formatPrintDate, formatTicketPrintTitle, ticketPrintDate } from '../print-date';

describe('print-date', () => {
  it('prefers completed_at over created_at', () => {
    expect(
      ticketPrintDate({
        completed_at: '2026-03-15T12:00:00',
        created_at: '2026-03-14T08:00:00',
      }),
    ).toBe('2026-03-15T12:00:00');
  });

  it('falls back to created_at', () => {
    expect(
      ticketPrintDate({
        completed_at: null,
        created_at: '2026-03-14T08:00:00',
      }),
    ).toBe('2026-03-14T08:00:00');
  });

  it('formats title with date', () => {
    const title = formatTicketPrintTitle(
      {
        ticket_number: 7,
        completed_at: '2026-03-15T12:00:00',
        created_at: '2026-03-14T08:00:00',
      },
      'act',
    );
    expect(title).toContain('Акт взвешивания № 7 от');
    expect(title).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  it('formats receipt title', () => {
    const title = formatTicketPrintTitle(
      {
        ticket_number: 3,
        completed_at: null,
        created_at: '2026-01-02T00:00:00',
      },
      'receipt',
    );
    expect(title.startsWith('Талон № 3 от')).toBe(true);
  });

  it('formatPrintDate returns em dash for empty', () => {
    expect(formatPrintDate(null)).toBe('—');
  });
});
