import { describe, expect, it } from 'vitest';
import { updateScaleDraftAdapter, validateScaleDraft, type ScaleDraft } from '@/components/SiteScalesSettingsSection';

describe('SiteScalesSettingsSection draft helpers', () => {
  it('TC-UNIT-03: keeps independent primary and spare drafts', () => {
    const primaryDraft: ScaleDraft = {
      adapter_id: 'cas',
      connection: {
        transport: 'web_serial',
        device_id: 'cas',
      },
    };
    const spareDraft: ScaleDraft = {
      adapter_id: 'newton',
      connection: {
        transport: 'serial_backend',
        device_id: 'newton',
      },
    };

    const nextPrimary = updateScaleDraftAdapter(primaryDraft, 'generic-regex');
    expect(nextPrimary.adapter_id).toBe('generic-regex');
    expect(nextPrimary.connection.transport).toBe('serial_backend');
    expect(nextPrimary.connection.device_id).toBeNull();

    expect(spareDraft.adapter_id).toBe('newton');
    expect(spareDraft.connection.transport).toBe('serial_backend');
    expect(validateScaleDraft(spareDraft)).toEqual([]);
  });
});
