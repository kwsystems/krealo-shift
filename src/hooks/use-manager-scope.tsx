import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { track } from '@/lib/analytics';
import { AdminError, ADMIN_LIST_STALE_MS, selectRows } from '@/hooks/use-admin-query';
import { getSupabase } from '@/lib/supabase/client';
import { useSessionStore, type AppRole } from '@/stores/session-store';
import type { TimeFormatPreference } from '@/utils/time';
import { TABLES } from '@/lib/supabase/types';

/**
 * Contexto del panel administrativo: organización, rol, ubicaciones y la
 * ubicación seleccionada (§11).
 *
 * Vive en un provider del layout de `(manager)` para que las cinco pestañas
 * compartan la misma ubicación elegida sin duplicar en Zustand los datos que ya
 * sirve Supabase (§4). Solo la elección del usuario —qué ubicación mira— es
 * estado local; el resto lo gobierna TanStack Query.
 */

export const DEFAULT_LOCATION_SETTINGS = {
  pinLength: 6,
  photoEnabled: false,
  photoRetentionDays: 30,
  earlyClockInMinutes: 10,
  lateGraceMinutes: 5,
  allowUnscheduledShifts: true,
  timeFormat: '24h' as TimeFormatPreference,
  requiredBreakMinutes: 0,
  dailyOvertimeThresholdMinutes: 480,
  weeklyOvertimeThresholdMinutes: 2880,
  /** Descanso mínimo entre dos turnos antes de advertir (§11.3). */
  minimumRestMinutes: 660,
  /**
   * Multiplicador de horas extra, SOLO INFORMATIVO (§13). En centésimas: 150 es 1.5×.
   *
   * §13 lo pide entre las políticas configurables de horas extra y no existía. Va en
   * centésimas y no como decimal porque el resto de ajustes de la ubicación son enteros
   * y comparten el mismo campo de texto numérico: un decimal ahí obliga a decidir si el
   * separador es coma o punto según el idioma, y esa es una fuente de errores que no
   * vale la pena por un número que no se usa para pagar.
   *
   * Por defecto 150, que es lo más común, y §13 es explícita en que NO se codifica la
   * legislación de ningún país como verdad universal: es un valor de partida que cada
   * ubicación cambia.
   *
   * INFORMATIVO significa informativo: la app resume tiempo y no calcula remuneraciones
   * (§13, §34). El número que produce se etiqueta como referencia en la pantalla.
   */
  overtimeMultiplierPercent: 150,
  /**
   * Cuánto puede pasar un reloj sin sincronizar antes de avisar al gerente (§19).
   * El razonamiento del valor está en
   * `supabase/migrations/20260827001100_manager_alerts.sql`, que es donde manda:
   * la alerta la calcula la base leyendo esta misma clave.
   */
  kioskSyncStaleMinutes: 120,
};

export type LocationSettings = typeof DEFAULT_LOCATION_SETTINGS;

const locationSettingsSchema = z
  .object({
    pinLength: z.number().int().min(4).max(6).default(DEFAULT_LOCATION_SETTINGS.pinLength),
    photoEnabled: z.boolean().default(DEFAULT_LOCATION_SETTINGS.photoEnabled),
    photoRetentionDays: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_LOCATION_SETTINGS.photoRetentionDays),
    earlyClockInMinutes: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_LOCATION_SETTINGS.earlyClockInMinutes),
    lateGraceMinutes: z.number().int().min(0).default(DEFAULT_LOCATION_SETTINGS.lateGraceMinutes),
    allowUnscheduledShifts: z.boolean().default(DEFAULT_LOCATION_SETTINGS.allowUnscheduledShifts),
    timeFormat: z.enum(['12h', '24h']).default(DEFAULT_LOCATION_SETTINGS.timeFormat),
    requiredBreakMinutes: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_LOCATION_SETTINGS.requiredBreakMinutes),
    dailyOvertimeThresholdMinutes: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_LOCATION_SETTINGS.dailyOvertimeThresholdMinutes),
    weeklyOvertimeThresholdMinutes: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_LOCATION_SETTINGS.weeklyOvertimeThresholdMinutes),
    minimumRestMinutes: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_LOCATION_SETTINGS.minimumRestMinutes),
    kioskSyncStaleMinutes: z
      .number()
      .int()
      .min(1)
      .default(DEFAULT_LOCATION_SETTINGS.kioskSyncStaleMinutes),
    // Mínimo 100: un multiplicador menor que 1 significaría pagar la hora extra MENOS
    // que la normal, que no es un ajuste, es un error de tecleo.
    overtimeMultiplierPercent: z
      .number()
      .int()
      .min(100)
      .max(1000)
      .default(DEFAULT_LOCATION_SETTINGS.overtimeMultiplierPercent),
  })
  // Una ubicación con `settings` incompleto o nulo no debe romper el panel: se
  // usan los valores por defecto de la especificación (§11.6).
  .catch(DEFAULT_LOCATION_SETTINGS);

const locationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string().default(''),
  timezone: z.string(),
  is_active: z.boolean(),
  settings: locationSettingsSchema,
});

export type ManagerLocation = z.infer<typeof locationSchema>;

const membershipSchema = z.object({
  organization_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'manager', 'employee']),
});

const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  default_locale: z.string(),
  default_timezone: z.string(),
  week_starts_on: z.number().int().min(0).max(6),
  /**
   * Ruta del logotipo dentro del bucket `organization-logos`, no una URL.
   *
   * Se guarda la ruta y la URL se compone al pintar: una URL guardada en la base
   * queda inservible si el proyecto de Supabase cambia de dominio, y ese es
   * exactamente lo que pasa al mover de un proyecto de pruebas a uno de verdad.
   */
  logo_path: z.string().nullable().default(null),
});

export type ManagerOrganization = z.infer<typeof organizationSchema>;

export type ManagerScopeData = {
  organization: ManagerOrganization;
  role: AppRole;
  locations: ManagerLocation[];
};

export const managerScopeKey = ['manager', 'scope'] as const;

async function fetchManagerScope(): Promise<ManagerScopeData> {
  const db = getSupabase();
  const userId = db === null ? null : ((await db.auth.getUser()).data.user?.id ?? null);

  const memberships = await selectRows(z.array(membershipSchema), (client) => {
    const query = client
      .from(TABLES.organizationMemberships)
      .select('organization_id, role')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    return userId === null ? query : query.eq('user_id', userId);
  });

  const membership = memberships[0];
  if (membership === undefined) {
    // Sin membresía activa no hay panel que mostrar. Se trata como acceso
    // denegado para que la pantalla diga qué hacer —pedir que te agreguen al
    // equipo— en lugar de quedarse cargando para siempre.
    throw new AdminError('forbidden', 'NO_MEMBERSHIP');
  }

  const organization = await selectRows(organizationSchema, (client) =>
    client
      .from(TABLES.organizations)
      .select('id, name, default_locale, default_timezone, week_starts_on, logo_path')
      .eq('id', membership.organization_id)
      .single(),
  );

  const locations = await selectRows(z.array(locationSchema), (client) =>
    client
      .from(TABLES.locations)
      .select('id, name, address, timezone, is_active, settings')
      .eq('organization_id', membership.organization_id)
      .order('name', { ascending: true }),
  );

  // La ruta de arranque decide por rol (§6.1) y este es el primer punto donde el
  // rol real se conoce: se publica en el store de sesión para que no haya dos
  // fuentes de verdad.
  useSessionStore
    .getState()
    .setMembership({ role: membership.role, organizationId: membership.organization_id });

  /*
   * `login_succeeded` de §31 se mide AQUÍ y no en la pantalla de acceso, porque el
   * evento lleva el rol y en la pantalla de acceso el rol todavía no se sabe: la sesión
   * de Supabase dice quién eres, no qué puedes hacer. Aquí es el primer punto donde se
   * conoce, y este es también el punto por el que pasa una sesión restaurada del
   * Keychain, que en la pantalla de acceso no se vería nunca.
   */
  track({ name: 'login_succeeded', role: membership.role });

  return { organization, role: membership.role, locations };
}

type ScopeContextValue = {
  query: ReturnType<typeof useManagerScopeQuery>;
  locationId: string | null;
  setLocationId: (id: string) => void;
};

function useManagerScopeQuery() {
  return useQuery({
    queryKey: managerScopeKey,
    queryFn: fetchManagerScope,
    staleTime: 5 * ADMIN_LIST_STALE_MS,
  });
}

/**
 * Resolución de la membresía para la guarda de rol del layout (§6.3, §7).
 *
 * Comparte `queryKey` con el provider, así que la consulta se hace UNA vez: el
 * layout la usa para saber el rol antes de montar las pestañas, y el provider
 * lee el mismo resultado desde la caché.
 *
 * Existe porque el rol no se conoce en el arranque: la sesión de Supabase dice
 * quién eres, no qué puedes hacer. Sin resolverlo aquí, el panel se queda
 * esperando un rol que nadie va a poner.
 */
export function useManagerMembership(enabled: boolean) {
  return useQuery({
    queryKey: managerScopeKey,
    queryFn: fetchManagerScope,
    staleTime: 5 * ADMIN_LIST_STALE_MS,
    enabled,
    // Sin membresía o sin permiso, reintentar da el mismo resultado.
    retry: false,
  });
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ManagerScopeProvider({ children }: { children: ReactNode }) {
  const query = useManagerScopeQuery();
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);

  const value = useMemo<ScopeContextValue>(() => {
    const locations = query.data?.locations ?? [];
    // La elección se deriva, no se escribe en un efecto: la primera ubicación
    // activa es el valor por defecto hasta que el usuario elija otra.
    const fallback = locations.find((location) => location.is_active) ?? locations[0];
    const isChosenValid =
      chosenLocationId !== null && locations.some((location) => location.id === chosenLocationId);

    return {
      query,
      locationId: isChosenValid ? chosenLocationId : (fallback?.id ?? null),
      setLocationId: setChosenLocationId,
    };
  }, [query, chosenLocationId]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export type ManagerScope = {
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  organization: ManagerOrganization | null;
  role: AppRole | null;
  /** Propietario y administrador: pueden cambiar configuración y semanas pasadas. */
  isAdmin: boolean;
  locations: ManagerLocation[];
  locationId: string | null;
  location: ManagerLocation | null;
  setLocationId: (id: string) => void;
  /** Zona horaria efectiva: la de la ubicación, o la de la organización. */
  timezone: string;
  timeFormat: TimeFormatPreference;
  settings: LocationSettings;
  weekStartsOn: number;
};

export function useManagerScope(): ManagerScope {
  const context = useContext(ScopeContext);

  if (context === null) {
    // Fuera del provider devolvemos un contexto vacío en lugar de lanzar: una
    // pantalla suelta debe poder renderizar su estado de carga.
    return {
      isLoading: true,
      error: null,
      refetch: () => undefined,
      organization: null,
      role: null,
      isAdmin: false,
      locations: [],
      locationId: null,
      location: null,
      setLocationId: () => undefined,
      timezone: 'America/Lima',
      timeFormat: DEFAULT_LOCATION_SETTINGS.timeFormat,
      settings: DEFAULT_LOCATION_SETTINGS,
      weekStartsOn: 1,
    };
  }

  const { query, locationId, setLocationId } = context;
  const organization = query.data?.organization ?? null;
  const locations = query.data?.locations ?? [];
  const location = locations.find((item) => item.id === locationId) ?? null;
  const role = query.data?.role ?? null;

  return {
    isLoading: query.isPending,
    error: query.error,
    refetch: () => void query.refetch(),
    organization,
    role,
    isAdmin: role === 'owner' || role === 'admin',
    locations,
    locationId,
    location,
    setLocationId,
    timezone: location?.timezone ?? organization?.default_timezone ?? 'America/Lima',
    timeFormat: location?.settings.timeFormat ?? DEFAULT_LOCATION_SETTINGS.timeFormat,
    settings: location?.settings ?? DEFAULT_LOCATION_SETTINGS,
    weekStartsOn: organization?.week_starts_on ?? 1,
  };
}
