import { useEffect } from 'react';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { parseAlertData, routeForAlertType } from './alerts';
import { savePushToken } from './api';
import { deviceLabel, pushAdapter, pushPlatform, type PushPermissionState } from './push-adapter';
import { pushRegistrationDecision, type PushRegistrationDecision } from './registration-policy';
import { useKioskStore } from '@/stores/kiosk-store';
import { canUseAdminPanel, useSessionStore } from '@/stores/session-store';

/**
 * Notificaciones del gerente en el cliente (§19).
 *
 * NADA DE `setState` DENTRO DE UN EFECTO. El estado asíncrono —el permiso del
 * sistema y el token registrado— lo gobierna TanStack Query, igual que el resto
 * del estado remoto del proyecto (§4). Un `useEffect` que consulta el permiso y
 * llama a `setState` es exactamente el patrón que la regla
 * `react-hooks/set-state-in-effect` prohíbe, y con razón: en el segundo render se
 * vuelve a consultar y la pantalla parpadea.
 */

const easExtraSchema = z.object({ eas: z.object({ projectId: z.string().min(1) }) });

/**
 * `projectId` de EAS. Sin él `getExpoPushTokenAsync` no puede pedir un token.
 *
 * Hoy `app.config.ts` lo deja sin definir hasta que alguien corra
 * `eas build:configure`, así que en un build de desarrollo esto devuelve `null` y
 * el panel lo dice en lugar de mostrar un botón que fallaría.
 */
export function easProjectId(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const parsed = easExtraSchema.safeParse(extra);
  return parsed.success ? parsed.data.eas.projectId : null;
}

export const pushKeys = {
  permission: ['push', 'permission'] as const,
  registration: (userId: string) => ['push', 'registration', userId] as const,
};

export type PushRegistration = {
  decision: PushRegistrationDecision;
  /** Permiso del sistema. `undefined` mientras se consulta. */
  permission: PushPermissionState | undefined;
  /** `true` si además del permiso hay un token guardado en `push_tokens`. */
  registered: boolean;
  isBusy: boolean;
  /** Falló al guardar el token. El permiso puede estar concedido igual. */
  error: unknown;
  /** Pide el permiso al sistema. Llamar SOLO tras mostrar la explicación (§25). */
  enable: () => void;
};

export function usePushRegistration(): PushRegistration {
  const queryClient = useQueryClient();

  const kioskHydrated = useKioskStore((state) => state.hydrated);
  const binding = useKioskStore((state) => state.binding);
  const phase = useSessionStore((state) => state.phase);
  const role = useSessionStore((state) => state.role);
  const userId = useSessionStore((state) => state.user?.userId ?? null);

  const projectId = easProjectId();

  const decision = pushRegistrationDecision({
    platform: pushPlatform(),
    kioskHydrated,
    isKioskDevice: binding !== null,
    sessionPhase: phase,
    role,
    hasProjectId: projectId !== null,
  });

  const permission = useQuery({
    queryKey: pushKeys.permission,
    queryFn: () => pushAdapter.getPermission(),
    enabled: decision.allowed,
    // El permiso lo puede cambiar la persona en Ajustes del sistema en cualquier
    // momento, así que no se cachea largo; pero tampoco se sondea, porque
    // preguntarlo no tiene efecto visible y no urge.
    staleTime: 30_000,
    retry: false,
  });

  const granted = permission.data === 'granted';

  /**
   * Registro del token.
   *
   * ES UNA CONSULTA Y NO UNA MUTACIÓN, aunque escriba: la pregunta que responde es
   * "¿está este dispositivo registrado?", y la respuesta se obtiene registrándolo.
   * `savePushToken` hace `upsert`, así que repetirlo no cambia nada. Con una
   * mutación habría que dispararla desde un efecto, y eso vuelve a traer el
   * problema del `setState` en efectos.
   */
  const registration = useQuery({
    queryKey: pushKeys.registration(userId ?? 'none'),
    queryFn: async (): Promise<string | null> => {
      if (projectId === null || userId === null) return null;
      const token = await pushAdapter.getExpoToken(projectId);
      if (token === null) return null;
      await savePushToken({
        userId,
        expoToken: token,
        platform: pushPlatform(),
        deviceName: deviceLabel(),
      });
      return token;
    },
    enabled: decision.allowed && granted && userId !== null,
    // Una hora: el token de Expo es estable para una instalación. Volver a
    // guardarlo en cada montaje solo gastaría una escritura.
    staleTime: 60 * 60_000,
    retry: 1,
  });

  const enable = useMutation({
    mutationFn: () => pushAdapter.requestPermission(),
    onSuccess: (state) => {
      // Se escribe el resultado en la caché en vez de invalidar: el sistema ya nos
      // dio la respuesta y volver a preguntarla no aporta nada.
      queryClient.setQueryData(pushKeys.permission, state);
    },
  });

  return {
    decision,
    permission: permission.data,
    registered: typeof registration.data === 'string',
    isBusy: enable.isPending || permission.isPending || registration.isPending,
    error: registration.error,
    enable: () => enable.mutate(),
  };
}

/**
 * Toque en una notificación → pantalla correcta (§19).
 *
 * LA GUARDA IMPORTA MÁS QUE LA NAVEGACIÓN. Solo se navega con sesión, con rol
 * administrativo y en un dispositivo que no es kiosco. Sin esa condición, un toque
 * podría llevar el iPad de una tienda al panel administrativo, y además la
 * redirección de arranque de `app/index.tsx` pisaría el destino: el arranque
 * decide a dónde va la app y este manejador solo debe actuar cuando ese destino ya
 * está resuelto.
 */
export function useNotificationRouter(): void {
  const kioskHydrated = useKioskStore((state) => state.hydrated);
  const binding = useKioskStore((state) => state.binding);
  const phase = useSessionStore((state) => state.phase);
  const role = useSessionStore((state) => state.role);

  const ready = kioskHydrated && binding === null && phase === 'signedIn' && canUseAdminPanel(role);

  useEffect(() => {
    pushAdapter.configureForeground();
  }, []);

  useEffect(() => {
    if (!ready) return;

    const navigate = (data: unknown) => {
      const alert = parseAlertData(data);
      // Una notificación de una versión anterior, o de otra app: se ignora en
      // silencio. Abrir una pantalla arbitraria sería peor que no hacer nada.
      if (alert === null) return;
      router.push(routeForAlertType(alert.alertType));
    };

    // App abierta desde cerrada por el toque. Se consume una sola vez.
    const initial = pushAdapter.takeInitialResponse();
    if (initial !== null) navigate(initial);

    return pushAdapter.addResponseListener(navigate);
  }, [ready]);
}
