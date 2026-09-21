import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createActivationCode,
  createLocation,
  fetchKioskDevices,
  fetchNotificationPreferences,
  revokeKioskDevice,
  saveNotificationPreferences,
  setLocationActive,
  updateLocation,
  updateOrganization,
  type NotificationPreferences,
  type OrganizationPatch,
} from './api';
import {
  cancelInvitation,
  fetchMembers,
  inviteMember,
  revokeMember,
  setMemberRole,
  type AppRoleName,
} from './members';
import { ADMIN_LIST_STALE_MS } from '@/hooks/use-admin-query';
import type { LocationSettings } from '@/hooks/use-manager-scope';
import { useSessionStore } from '@/stores/session-store';

/** Hooks de configuración (§11.6). */

export const settingsKeys = {
  kiosks: (organizationId: string) => ['settings', 'kiosks', organizationId] as const,
  notifications: (organizationId: string, userId: string) =>
    ['settings', 'notifications', organizationId, userId] as const,
  members: (organizationId: string) => ['settings', 'members', organizationId] as const,
};

export function useKioskDevices(organizationId: string | null) {
  return useQuery({
    queryKey: settingsKeys.kiosks(organizationId ?? 'none'),
    queryFn: () => fetchKioskDevices(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    // Sin permiso no hay nada que reintentar: el error es estable. Sigue valiendo
    // aunque ahora se lea la vista, porque quien no administra ninguna tienda ve
    // cero filas y quien no tiene sesión ve "permiso denegado" siempre igual.
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

  const addLocation = useMutation({
    mutationFn: (variables: {
      name: string;
      address: string;
      timezone: string;
      settings: LocationSettings;
    }) => createLocation({ organizationId: organizationId ?? '', ...variables }),
    onSuccess: invalidateScope,
  });

  /** Cerrar o reabrir. Borrar no existe: el porqué está en `setLocationActive`. */
  const toggleLocation = useMutation({
    mutationFn: (variables: { locationId: string; isActive: boolean }) =>
      setLocationActive(variables),
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

  return {
    saveOrganization,
    saveLocation,
    addLocation,
    toggleLocation,
    generateCode,
    revokeKiosk,
    saveNotifications,
  };
}

/**
 * Quién tiene acceso a la organización (§7).
 *
 * `retry: false` por el mismo motivo que los kioscos: sin permiso el error es
 * estable, y reintentar tres veces solo retrasa el mensaje que explica por qué.
 */
export function useMembers(organizationId: string | null) {
  return useQuery({
    queryKey: settingsKeys.members(organizationId ?? 'none'),
    queryFn: () => fetchMembers(organizationId ?? ''),
    enabled: organizationId !== null,
    staleTime: ADMIN_LIST_STALE_MS,
    retry: false,
  });
}

export function useMemberMutations(organizationId: string | null) {
  const queryClient = useQueryClient();
  const invalidar = () => {
    void queryClient.invalidateQueries({
      queryKey: settingsKeys.members(organizationId ?? 'none'),
    });
  };

  const invite = useMutation({
    mutationFn: (params: { email: string; role: AppRoleName }) =>
      inviteMember({ organizationId: organizationId ?? '', ...params }),
    onSuccess: invalidar,
  });

  const changeRole = useMutation({
    mutationFn: (params: { userId: string; role: AppRoleName }) =>
      setMemberRole({ organizationId: organizationId ?? '', ...params }),
    onSuccess: invalidar,
  });

  const revoke = useMutation({
    mutationFn: (params: { userId: string }) =>
      revokeMember({ organizationId: organizationId ?? '', ...params }),
    onSuccess: invalidar,
  });

  const cancelInvite = useMutation({
    mutationFn: (params: { email: string }) =>
      cancelInvitation({ organizationId: organizationId ?? '', ...params }),
    onSuccess: invalidar,
  });

  return { invite, changeRole, revoke, cancelInvite };
}
