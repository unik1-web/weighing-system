/**
 * Unit tests for camera registry client-side validation.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CAMERAS_PER_SITE,
  canAddCamera,
  createEmptyCameraDraft,
  validateCameraForm,
  validateCameraRoi,
} from '../cameras';

describe('camera registry validation', () => {
  it('TC-UNIT-01: client-side blocks 5th camera', () => {
    expect(MAX_CAMERAS_PER_SITE).toBe(4);
    expect(canAddCamera(0)).toBe(true);
    expect(canAddCamera(3)).toBe(true);
    expect(canAddCamera(4)).toBe(false);
    expect(canAddCamera(5)).toBe(false);
  });

  it('TC-UNIT-02: enabled requires URL', () => {
    const draft = createEmptyCameraDraft(0);
    draft.name = 'Въезд';
    draft.enabled = true;
    draft.http_snapshot_url = '';
    draft.rtsp_url = '';
    draft.http_url_dirty = true;
    draft.rtsp_url_dirty = true;

    const errors = validateCameraForm(draft);
    expect(errors.some((msg) => msg.includes('HTTP snapshot URL') || msg.includes('RTSP'))).toBe(
      true,
    );

    draft.http_snapshot_url = 'http://cam/snap';
    expect(validateCameraForm(draft)).toEqual([]);
  });

  it('TC-UNIT-03: ROI invalid (>1) rejected on UI', () => {
    const draft = createEmptyCameraDraft(0);
    draft.role = 'overview';
    draft.roi_x = '0';
    draft.roi_y = '0';
    draft.roi_w = '1.5';
    draft.roi_h = '0.5';

    const roiErrors = validateCameraRoi(draft);
    expect(roiErrors.some((msg) => msg.includes('roi_w') && msg.includes('[0..1]'))).toBe(true);

    draft.name = 'Обзор';
    draft.enabled = false;
    const formErrors = validateCameraForm(draft);
    expect(formErrors.some((msg) => msg.includes('roi_w'))).toBe(true);

    draft.roi_w = '0.4';
    expect(validateCameraRoi(draft)).toEqual([]);
  });

  it('ROI w/h must be > 0 when set', () => {
    const draft = createEmptyCameraDraft(0);
    draft.role = 'overview';
    draft.roi_w = '0';
    draft.roi_h = '0.2';
    const errors = validateCameraRoi(draft);
    expect(errors.some((msg) => msg.includes('roi_w') && msg.includes('> 0'))).toBe(true);
  });

  it('non-overview skips ROI validation', () => {
    const draft = createEmptyCameraDraft(0);
    draft.role = 'entry';
    draft.roi_x = '9';
    expect(validateCameraRoi(draft)).toEqual([]);
  });
});
