/**
 * QUIÉN YA NO ESTÁ EN EL EQUIPO UN DÍA DADO (26-oct).
 *
 * «Copiar semana anterior» copiaba los turnos de todos los que trabajaron la semana pasada,
 * también de quien se dio de baja después: la semana nueva salía con turnos de alguien que
 * ya no viene, y al publicarla figuraba «no ha llegado» y faltas a su nombre. Pegar un
 * horario ya dejaba fuera a las personas inactivas (`locationMembers` en Horario); copiar
 * tiene que decir lo mismo, así que la pregunta vive aquí y no en cada pantalla.
 *
 * Fuera del equipo es: inactiva —la baja la deja así en el acto, aunque su último día sea
 * de la semana que viene—, o con un último día (`end_date`) anterior al día del turno.
 * Una persona invitada que aún no entró a la app SÍ está en el equipo: se le hacen turnos.
 * Una ficha que no se encuentra no se da por fuera: sin saberlo, se copia como antes.
 */
export function fueraDelEquipoEl(
  persona: { status: string; end_date?: string | null } | undefined,
  dateKey: string,
): boolean {
  if (persona === undefined) return false;
  if (persona.status === 'inactive') return true;
  const ultimoDia = persona.end_date ?? null;
  return ultimoDia !== null && ultimoDia < dateKey;
}
