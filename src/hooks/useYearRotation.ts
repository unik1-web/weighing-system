import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ApiRequestError,
  commitYearRotation,
  getYearRotationPreview,
  type RotationCommitResponse,
  type RotationPreviewResponse,
} from '@/lib/api';
import { beginRotationCommitSyncPause, endRotationCommitSyncPause } from '@/lib/storage-sync';

export interface YearRotationState {
  preview: RotationPreviewResponse | null;
  blockingTickets: Array<Record<string, unknown>>;
  pendingReoCount: number;
  submitting: boolean;
  completed: boolean;
  rotationRequired: boolean;
  result: RotationCommitResponse | null;
  error: string | null;
  error_code: string | null;
}

function isRotationRequired(preview: RotationPreviewResponse): boolean {
  if (typeof preview.rotation_required === 'boolean') {
    return preview.rotation_required;
  }
  if (preview.source_year !== preview.target_year) return true;
  if (preview.open_candidates.length > 0) return true;
  if (preview.pending_reo_count > 0) return true;
  if (preview.blocking_tickets.length > 0) return true;
  return !!preview.preview_token;
}

export function useYearRotation(onCompleted?: () => Promise<void> | void) {
  const previewRef = useRef<RotationPreviewResponse | null>(null);
  const [state, setState] = useState<YearRotationState>({
    preview: null,
    blockingTickets: [],
    pendingReoCount: 0,
    submitting: false,
    completed: false,
    rotationRequired: false,
    result: null,
    error: null,
    error_code: null,
  });

  const requestPreview = useCallback(
    async (assertion?: { source_year?: number; target_year?: number }): Promise<RotationPreviewResponse> => {
      try {
        const preview = await getYearRotationPreview(assertion);
        const required = isRotationRequired(preview);
        previewRef.current = preview;
        setState({
          preview,
          blockingTickets: preview.blocking_tickets,
          pendingReoCount: preview.pending_reo_count,
          submitting: false,
          completed: false,
          rotationRequired: required,
          result: null,
          error: null,
          error_code: null,
        });
        return preview;
      } catch (error) {
        const apiError = error instanceof ApiRequestError ? error : null;
        setState((prev) => ({
          ...prev,
          submitting: false,
          completed: false,
          rotationRequired: false,
          error: error instanceof Error ? error.message : 'Не удалось получить preview ротации',
          error_code: apiError?.code ?? null,
        }));
        throw error;
      }
    },
    [],
  );

  const commit = useCallback(
    async (acknowledgePendingReo = true): Promise<RotationCommitResponse> => {
      const preview = previewRef.current;
      if (!preview) {
        const err = new Error('Preview ротации отсутствует');
        setState((prev) => ({
          ...prev,
          submitting: false,
          error: err.message,
        }));
        throw err;
      }

      setState((prev) => ({
        ...prev,
        submitting: true,
        completed: false,
        error: null,
        error_code: null,
      }));

      beginRotationCommitSyncPause();
      try {
        const result = await commitYearRotation({
          source_year: preview.source_year,
          target_year: preview.target_year,
          preview_token: preview.preview_token,
          acknowledge_pending_reo: acknowledgePendingReo,
        });
        setState((prev) => ({
          ...prev,
          submitting: false,
          completed: true,
          rotationRequired: false,
          result,
          error: null,
          error_code: null,
        }));
        if (onCompleted) {
          await onCompleted();
        }
        return result;
      } catch (error) {
        const apiError = error instanceof ApiRequestError ? error : null;
        setState((prev) => ({
          ...prev,
          submitting: false,
          completed: false,
          error: error instanceof Error ? error.message : 'Не удалось выполнить ротацию',
          error_code: apiError?.code ?? null,
        }));
        throw error;
      } finally {
        endRotationCommitSyncPause();
      }
    },
    [onCompleted],
  );

  const reset = useCallback(() => {
    previewRef.current = null;
    setState({
      preview: null,
      blockingTickets: [],
      pendingReoCount: 0,
      submitting: false,
      completed: false,
      rotationRequired: false,
      result: null,
      error: null,
      error_code: null,
    });
  }, []);

  return useMemo(
    () => ({
      ...state,
      requestPreview,
      commit,
      reset,
    }),
    [commit, requestPreview, reset, state],
  );
}

