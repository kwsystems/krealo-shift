import { z } from 'zod';

/**
 * Tipos de alerta administrativa y a dónde lleva cada una al tocarla (§19).
 *
 * §19 pide "navegar a la pantalla correcta al tocarla". La correspondencia vive
 * aquí, en una función pura, y no repartida por el manejador de notificaciones:
 * una alerta que abre la pantalla equivocada es peor que ninguna alerta, porque
 * el gerente busca el problema donde no está.
 *
 * El servidor manda solo el tipo y la ubicación en `data`. No manda una ruta:
 * si lo hiciera, renombrar una pantalla rompería las notificaciones que ya están
 * en el centro de notificaciones de un teléfono, y no hay forma de arreglarlas.
 */

export const managerAlertTypes = [
  'late',
  'noShow',
  'earlyClockIn',
  'incompleteEntry',
  'nearOvertime',
  'newRequest',
  'scheduleChange',
  'kioskNotSyncing',
  'wrongKiosk',
] as const;

export type ManagerAlertType = (typeof managerAlertTypes)[number];

/**
 * `data` de la notificación, validado (§22: Zod al recibir, no solo al enviar).
 *
 * Llega desde el sistema operativo, que la guardó cuando la notificación se
 * entregó: puede ser de una versión anterior de la app, o de otra app si alguien
 * se equivoca. `passthrough` no: cualquier campo extra se descarta.
 */
export const alertDataSchema = z.object({
  alertType: z.enum(managerAlertTypes),
  locationId: z.string().uuid().optional(),
});

export type AlertData = z.infer<typeof alertDataSchema>;

export function parseAlertData(value: unknown): AlertData | null {
  const parsed = alertDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Pantalla del panel a la que lleva cada alerta.
 *
 * Las rutas del grupo `(manager)` se escriben con el grupo delante, como hacen
 * `app/(manager)/index.tsx` y `schedule.tsx` al navegar entre pestañas: `/team`
 * a secas también resuelve, pero `/` colisiona con la ruta de arranque.
 */
export function routeForAlertType(type: ManagerAlertType): string {
  switch (type) {
    // Tardanza y ausencia son "quién falta ahora": eso es el inicio del panel.
    case 'late':
    case 'noShow':
      return '/(manager)';
    // Un fichaje sin salida y las horas extra se arreglan en la hoja de horas. La
    // entrada temprana también: es informativa, y lo que se quiere ver es cuántos
    // minutos suma, que es una columna de esa pantalla y no un hecho aislado.
    case 'incompleteEntry':
    case 'nearOvertime':
    case 'earlyClockIn':
      return '/(manager)/hours';
    // Un cambio de horario lleva al horario, no a la lista de quién falta.
    case 'scheduleChange':
      return '/(manager)/schedule';
    // Las solicitudes viven en Más, junto a la bandeja.
    case 'newRequest':
      return '/(manager)/more';
    // Los relojes y su estado están en la configuración, dentro de Más.
    case 'kioskNotSyncing':
    case 'wrongKiosk':
      return '/(manager)/more';
  }
}
