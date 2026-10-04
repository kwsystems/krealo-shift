/**
 * FIRESTORE NO ACEPTA MÁS DE 30 VALORES EN UN `in` (auditoría, 4-oct). Con 31 fichas
 * —contando las inactivas— la consulta de puestos fallaba en producción, todos salían sin
 * puesto, y editar a alguien le borraba los suyos. El emulador no tiene ese límite, por
 * eso no lo vio ninguna prueba. Se parte en trozos de 30 y se juntan las respuestas.
 *
 * Vive aquí y no en Equipo porque la usan también las notas privadas de los turnos.
 */
export const MAXIMO_DE_UN_IN = 30;

export function enTrozos<T>(lista: readonly T[], tamano = MAXIMO_DE_UN_IN): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}
