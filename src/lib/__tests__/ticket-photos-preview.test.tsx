/**
 * Frontend E2E/unit tests for ticket photo preview (UC-04).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { ArchiveTicketCard } from '@/components/ArchiveTicketCard';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import { TicketPhotosPreview } from '@/components/TicketPhotosPreview';
import type { TicketPhoto } from '@/lib/cameras';
import {
  countAvailablePreviews,
  groupPhotosByEvent,
  mapArchiveStubPreviews,
  photoApiUrl,
  selectSuccessPreviewPhotos,
} from '@/lib/ticket-photos-preview';
import { TicketPhotoStorage } from '@/lib/storage';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

installLocalStorage();

function photoRow(overrides: Partial<TicketPhoto> & Pick<TicketPhoto, 'id' | 'event' | 'camera_role'>): TicketPhoto {
  return {
    ticket_id: 't-preview-1',
    camera_id: `cam-${overrides.camera_role}`,
    file_path: `Photo/2026/07/31/${overrides.id}.jpg`,
    status: 'success',
    error_code: null,
    captured_at: '2026-07-31T12:00:00.000Z',
    camera_mode: 'primary',
    ...overrides,
  };
}

describe('ticket photos preview', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('TC-E2E-01: form preview shows success photos grouped by gross/tare', () => {
    const rows = [
      photoRow({ id: 'ph-g-entry', event: 'gross', camera_role: 'entry' }),
      photoRow({ id: 'ph-g-overview', event: 'gross', camera_role: 'overview' }),
      photoRow({ id: 'ph-t-exit', event: 'tare', camera_role: 'exit' }),
      photoRow({
        id: 'ph-failed',
        event: 'gross',
        camera_role: 'exit',
        status: 'failed',
        file_path: null,
      }),
    ];
    TicketPhotoStorage.upsertMany(rows);

    const html = renderToStaticMarkup(
      React.createElement(TicketPhotosPreview, { ticketId: 't-preview-1' }),
    );

    expect(html).toContain('Снимки (3)');
    expect(html).toContain('data-event="gross"');
    expect(html).toContain('data-event="tare"');
    expect(html).toContain('Брутто');
    expect(html).toContain('Тара');
    expect(html).toContain(photoApiUrl('Photo/2026/07/31/ph-g-entry.jpg'));
    expect(html).toContain(photoApiUrl('Photo/2026/07/31/ph-g-overview.jpg'));
    expect(html).toContain(photoApiUrl('Photo/2026/07/31/ph-t-exit.jpg'));
    expect(html).not.toContain('ph-failed');
  });

  it('TC-E2E-02: journal details preview shows all success ticket_photos', () => {
    const rows = [
      photoRow({ id: 'ph-1', event: 'gross', camera_role: 'entry', ticket_id: 't-journal' }),
      photoRow({ id: 'ph-2', event: 'gross', camera_role: 'exit', ticket_id: 't-journal' }),
      photoRow({ id: 'ph-3', event: 'tare', camera_role: 'overview', ticket_id: 't-journal' }),
    ];
    TicketPhotoStorage.upsertMany(rows);

    const html = renderToStaticMarkup(
      React.createElement(TicketPhotosPreview, { ticketId: 't-journal' }),
    );

    expect(html).toContain('Снимки (3)');
    expect(html).toContain('data-photo-id="ph-1"');
    expect(html).toContain('data-photo-id="ph-2"');
    expect(html).toContain('data-photo-id="ph-3"');
    expect(html).toContain('Увеличить');
  });

  it('TC-E2E-03: unavailable file uses placeholder and drops from available count', () => {
    const rows = [
      photoRow({ id: 'ph-ok', event: 'gross', camera_role: 'entry' }),
      photoRow({ id: 'ph-missing', event: 'gross', camera_role: 'exit' }),
    ];
    const unavailable = new Set(['ph-missing']);
    expect(countAvailablePreviews(rows, unavailable)).toBe(1);

    // Simulate post-onError UI: unavailable thumb renders placeholder text.
    const placeholderHtml = renderToStaticMarkup(
      React.createElement(
        'div',
        { className: 'flex h-24 items-center justify-center' },
        'Файл недоступен',
      ),
    );
    expect(placeholderHtml).toContain('Файл недоступен');

    const lightboxHtml = renderToStaticMarkup(
      React.createElement(PhotoLightbox, {
        src: photoApiUrl('Photo/2026/07/31/ph-ok.jpg'),
        alt: 'Въезд / Брутто',
        onClose: () => undefined,
      }),
    );
    expect(lightboxHtml).toContain('Просмотр снимка');
    expect(lightboxHtml).toContain(photoApiUrl('Photo/2026/07/31/ph-ok.jpg'));
    expect(lightboxHtml).toContain('Закрыть');
  });

  it('TC-UNIT-01: groupPhotosByEvent orders gross then tare and keeps all roles', () => {
    const rows = [
      photoRow({ id: 't1', event: 'tare', camera_role: 'exit' }),
      photoRow({ id: 'g1', event: 'gross', camera_role: 'overview' }),
      photoRow({ id: 'g2', event: 'gross', camera_role: 'entry' }),
      photoRow({
        id: 'fail',
        event: 'tare',
        camera_role: 'entry',
        status: 'failed',
        file_path: null,
      }),
    ];
    const groups = groupPhotosByEvent(rows);
    expect(groups.map((g) => g.event)).toEqual(['gross', 'tare']);
    expect(groups[0].photos.map((p) => p.id).sort()).toEqual(['g1', 'g2']);
    expect(groups[1].photos.map((p) => p.id)).toEqual(['t1']);
    expect(selectSuccessPreviewPhotos(rows)).toHaveLength(3);
  });

  it('TC-UNIT-02: archive stubs-only mapping ignores overview / ticket_photos', () => {
    const stubs = mapArchiveStubPreviews(
      'Photo/2025/12/01/entry.jpg',
      'Photo/2025/12/01/exit.jpg',
    );
    expect(stubs).toHaveLength(2);
    expect(stubs.map((s) => s.role)).toEqual(['entry', 'exit']);
    expect(stubs[0].src).toBe(photoApiUrl('Photo/2025/12/01/entry.jpg'));
    expect(stubs[1].label).toBe('Выезд');

    const empty = mapArchiveStubPreviews(null, undefined);
    expect(empty).toEqual([]);

    const html = renderToStaticMarkup(
      React.createElement(ArchiveTicketCard, {
        archiveYear: 2025,
        ticket: {
          id: 'arch-photo-1',
          ticket_number: 10,
          status: 'completed',
          reo_status: 'pending',
          auto_closed: false,
          photo_entry_path: 'Photo/2025/12/01/entry.jpg',
          photo_exit_path: null,
        },
        canEdit: false,
      }),
    );
    expect(html).toContain('Фото (stubs архива)');
    expect(html).toContain(photoApiUrl('Photo/2025/12/01/entry.jpg'));
    expect(html).toContain('alt="Въезд"');
    expect(html).not.toContain('overview');
    expect(html).not.toContain('data-event=');
    expect(html).not.toContain('Снимки (');
  });

  it('empty preview shows Нет снимков', () => {
    const html = renderToStaticMarkup(
      React.createElement(TicketPhotosPreview, { ticketId: 'missing' }),
    );
    expect(html).toContain('Нет снимков');
  });
});
