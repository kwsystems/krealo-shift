import { useQuery } from '@tanstack/react-query';

import { fetchBreakTimeByReason } from './api';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';

export const reportKeys = {
  breaks: (locationId: string, from: string, to: string) =>
    ['reports', 'breaks', locationId, from, to] as const,
};

export function useBreakTimeByReason(params: {
  locationId: string | null;
  from: string;
  to: string;
}) {
  return useQuery({
    queryKey: reportKeys.breaks(params.locationId ?? 'none', params.from, params.to),
    queryFn: () =>
      fetchBreakTimeByReason({
        locationId: params.locationId ?? '',
        from: params.from,
        to: params.to,
      }),
    enabled: params.locationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
  });
}
