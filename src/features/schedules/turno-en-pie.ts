/**
 * UN TURNO QUE CUENTA (8-oct): el publicado, y también el que ya se publicó y quien gestiona
 * editó sin volver a publicar —el «Cambiado» de Horario—.
 *
 * El servidor mide la jornada contra ese turno editado (`turnoDeLaJornada`), y las pantallas
 * lo ignoraban: editar un turno publicado sin republicarlo dejaba el día como «posible hora
 * extra» de 8 h en Horas, con 0 h programadas en Reportes y sin casos si se fue antes. Ahora
 * las horas —lo planificado, la extra, Por resolver, lo programado de Reportes— lo cuentan con
 * sus horas nuevas, igual que el servidor. Un borrador NUNCA publicado sigue sin contar.
 *
 * Las FALTAS no (4-oct, sigue en pie): mientras se está cambiando, la persona puede no saber
 * la hora nueva, y no venir no es faltar. Por eso faltas, «no ha llegado», el bono e Inicio
 * siguen mirando solo `status === 'published'`.
 */
export function turnoEnPie(turno: {
  status: string;
  publication_version?: number | null;
}): boolean {
  return (
    turno.status === 'published' ||
    (turno.status === 'draft' && (turno.publication_version ?? 0) > 0)
  );
}
