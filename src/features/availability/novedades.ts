import { dateKeyOf, type DateKey } from '@/features/schedules/week';
import { useTeam, type TeamMember } from '@/features/team/hooks';
import { useManagerScope } from '@/hooks/use-manager-scope';

import { useDisponibilidad } from './api';
import type { Disponibilidad } from './disponibilidad';

/**
 * LO NUEVO DE DISPONIBILIDAD, contado UNA vez (2-oct) para el menú y para la pantalla.
 *
 * El número del menú contaba toda la empresa —todas las sedes, y también a quien ya no
 * trabaja— y la pantalla solo la sede elegida y su gente activa. Así el menú decía «2»
 * y la pantalla «1 novedad», y «Marcar todas como vistas» dejaba el menú en 1 para
 * siempre. Ahora los dos preguntan aquí.
 *
 * Y UNA FECHA QUE YA PASÓ NO ES NOVEDAD: la pantalla no la enseña, así que contarla sería
 * pedir que se mire algo que no hay dónde mirar.
 */

/** Las personas de la sede que se mira, activas: las mismas que Equipo enseña. */
export function personasDeLaSede(
  miembros: readonly TeamMember[],
  locationId: string | null,
): TeamMember[] {
  return miembros
    .filter(
      (persona) =>
        persona.status === 'active' &&
        (locationId === null || persona.locationIds.includes(locationId)),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function esNovedad(fila: Disponibilidad, hoy: DateKey): boolean {
  if (fila.status !== 'new') return false;
  return fila.kind !== 'date' || (fila.date ?? '') >= hoy;
}

/** Cuántas novedades sin ver hay en la sede elegida: el número del menú. */
export function useNovedadesDeDisponibilidad(): number {
  const scope = useManagerScope();
  const organizationId = scope.organization?.id ?? null;
  const team = useTeam({
    organizationId,
    locationIds: scope.allLocations.map((location) => location.id),
  });
  const consulta = useDisponibilidad(organizationId);
  const deLaSede = new Set(
    personasDeLaSede(team.members, scope.locationId).map((persona) => persona.id),
  );
  const hoy = dateKeyOf(new Date().toISOString(), scope.timezone);
  return (consulta.data ?? []).filter(
    (fila) => deLaSede.has(fila.employee_id) && esNovedad(fila, hoy),
  ).length;
}
