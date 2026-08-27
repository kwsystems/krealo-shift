import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createActivationCode,
  fetchKioskDevices,
  fetchNotificationPreferences,
  revokeKioskDevice,
  saveNotificationPreferences,
  updateLocation,
  updateOrganization,
  type NotificationPreferences,
  type OrganizationPatch,
} from './api';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';
import type { LocationSettings } from '@/hooks/use-manager-scope';
import { useSessionStore } from '@/stores/session-store';

/** Hooks de configuración (§11.6). */

export const settingsKeys = {
  kiosks: (organizationId: string) => ['settings', 'kiosks', organizationId] as const,
  notifications: (organizationId: string, userId: string) =>
    ['settings', 'notifications', organizationId, userId] as const,
};

export function useKioskDevices(organizationId: string | null) {
  return useQuery({
    queryKey: settingsKeys.kiosks(organizationId ?? 'none'),
    queryFn: () => fetchKioskDevices(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    // Sin permiso de lectura no hay nada que reintentar: el error es estable.
    retry: false,
  });
}

export function useNotificationPreferences(organizationId: string | null) {
  const userId = useSessionStore((state) => state.user?.userId ?? null);

  return useQuery({
    queryKey: settingsKeys.notifications(organizationId ?? 'none', userId ?? 'none'),
    queryFn: () =>
      fetchNotificationPreferences({
        userId: userId ?? '',
        organizationId: organizationId ?? '',
      }),
    enabled: organizationId !== null && userId !== null,
    staleTime: 5 * ADMIN_LIST_STALE_MS,
  });
}

export function useSettingsMutations(organizationId: string | null) {
  const queryClient = useQueryClient();
  const userId = useSessionStore((state) => state.user?.userId ?? null);

  const invalidateScope = () => {
    void queryClient.invalidateQueries({ queryKey: ['manager', 'scope'] });
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  const saveOrganization = useMutation({
    mutationFn: (patch: OrganizationPatch) =>
      updateOrganization({ organizationId: organizationId ?? '', patch }),
    onSuccess: invalidateScope,
  });

  const saveLocation = useMutation({
    mutationFn: (variables: {
      locationId: string;
      name: string;
      address: string;
      settings: LocationSettings;
    }) => updateLocation(variables),
    onSuccess: invalidateScope,
  });

  const generateCode = useMutation({
    mutationFn: (variables: { locationId: string; validMinutes: number }) =>
      createActivationCode(variables),
  });

  const revokeKiosk = useMutation({
    mutationFn: (variables: { deviceId: string }) => revokeKioskDevice(variables.deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'kiosks'] });
    },
  });

  const saveNotifications = useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      saveNotificationPreferences({
        userId: userId ?? '',
        organizationId: organizationId ?? '',
        preferences,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'notifications'] });
    },
  });

  return { saveOrganization, saveLocation, generateCode, revokeKiosk, saveNotifications };
}
