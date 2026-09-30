import type { QueryClient } from '@tanstack/react-query';

/**
 * LO QUE CAMBIA UNA HORA SE REFRESCA EN TODAS LAS PANTALLAS QUE LA ENSEÑAN (30-sep).
 *
 * POR QUÉ EXISTE. Andree: «en todos lados, cuando se arregla algo, debería sincronizarse
 * para las otras vistas». Cada pantalla refrescaba su propia lista y alguna de las
 * vecinas, cada una con su criterio: publicar el horario refrescaba Horario e Inicio pero
 * no Horas ni Reportes —que usan el turno para decir «a tiempo», «sin turno» o «posible
 * hora extra»—, y corregir una hora en Horas no refrescaba Reportes. Se volvía a la otra
 * pantalla y seguía diciendo lo de antes hasta que caducaba su caché.
 *
 * UNA SOLA LISTA, y la usa todo lo que toca horarios, fichajes, correcciones, solicitudes u
 * horas extra: con una lista por módulo, el siguiente que añada una pantalla la añadirá en
 * uno y se le olvidará en los demás, que es exactamente lo que pasó.
 */
export const VISTAS_DE_HORAS = [
  'schedule',
  'timesheet',
  'reports',
  'dashboard',
  'requests',
] as const;

export function refrescarVistasDeHoras(queryClient: QueryClient): void {
  for (const vista of VISTAS_DE_HORAS) {
    void queryClient.invalidateQueries({ queryKey: [vista] });
  }
}
