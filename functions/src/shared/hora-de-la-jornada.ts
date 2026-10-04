import { instanteLocal } from './zonas';

/**
 * LA PRIMERA VEZ QUE ES ESA HORA DESPUÉS DE LA ENTRADA (auditoría, 4-oct).
 *
 * «19:00» de una jornada que empezó el sábado a las 10:00 es el sábado a las 19:00, aunque
 * se cuente el lunes en el reloj. Antes era «hoy a esa hora, o ayer si todavía no llegó»,
 * y con la jornada del sábado abierta el lunes eso daba el domingo: una jornada de 34 h si
 * se aprobaba. La misma regla que `horaPropuestaComoInstante` del reloj
 * (`src/features/kiosk/hora-propuesta.ts`), con una prueba que compara las dos
 * (`src/features/kiosk/__tests__/hora-propuesta-frontera.test.ts`).
 *
 * `zona` tiene que venir ya comprobada (`zonaSegura`).
 */
export function deLaJornada(hora: string, desde: string, zona: string): string | null {
  const desdeMs = Date.parse(desde);
  if (Number.isNaN(desdeMs)) return null;
  for (let dias = 0; dias < 3; dias += 1) {
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(
      new Date(desdeMs + dias * 24 * 60 * 60 * 1000),
    );
    const candidato = instanteLocal(fecha, hora, zona);
    if (candidato !== null && Date.parse(candidato) > desdeMs) return candidato;
  }
  return null;
}
