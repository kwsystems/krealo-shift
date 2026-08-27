import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  commentRequest,
  fetchRequests,
  reviewRequest,
  type ReviewDecision,
  type TimeEditRequest,
} from './api';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';

/** Hooks de la bandeja de solicitudes (§11.5). */

export const requestKeys = {
  list: (organizationId: string, locationId: string) =>
    ['requests', 'list', organizationId, locationId] as const,
};

export function useRequests(params: { organizationId: string | null; locationId: string | null }) {
  return useQuery({
    queryKey: requestKeys.list(params.organizationId ?? 'none', params.locationId ?? 'none'),
    queryFn: () =>
      fetchRequests({
        organizationId: params.organizationId ?? '',
        locationId: params.locationId ?? '',
      }),
    enabled: params.organizationId !== null && params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

export function useRequestMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
    void queryClient.invalidateQueries({ queryKey: ['timesheet'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const review = useMutation({
    mutationFn: (variables: {
      request: TimeEditRequest;
      decision: ReviewDecision;
      comment: string | null;
    }) => reviewRequest(variables),
    onSuccess: invalidate,
  });

  const comment = useMutation({
    mutationFn: (variables: { requestId: string; comment: string }) => commentRequest(variables),
    onSuccess: invalidate,
  });

  return { review, comment };
}
