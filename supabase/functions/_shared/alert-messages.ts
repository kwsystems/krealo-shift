/**
 * Textos de las notificaciones al gerente (§18, §19).
 *
 * POR QUÉ ESTE CATÁLOGO NO ESTÁ EN `src/i18n/locales/*.json`
 * Porque quien compone el texto es el servidor, no la app: el destinatario puede
 * tener el teléfono apagado y la notificación se escribe en el momento del envío.
 * Los JSON de la app no se pueden importar desde aquí con garantías —`supabase
 * functions deploy` empaqueta lo que hay bajo `supabase/functions/`, y un import
 * relativo fuera de esa carpeta puede quedarse fuera del bundle— así que este
 * archivo es la fuente para el lado servidor.
 *
 * COSTO ASUMIDO: hay dos sitios donde viven textos de producto, y la prueba de
 * paridad de `src/i18n` no ve este archivo. Se compensa con
 * `src/features/notifications/__tests__/alert-messages.test.ts`, que importa este
 * módulo y exige la misma paridad más la regla de datos sensibles.
 *
 * LA REGLA DE DATOS SENSIBLES, HECHA MECÁNICA
 * Los únicos marcadores permitidos son `{{count}}` y `{{location}}`. No hay
 * ninguno para un nombre, así que ningún nombre puede entrar en el texto ni por
 * descuido: `composeAlert` solo sabe sustituir esos dos. Un nombre propio en la
 * pantalla de bloqueo es información laboral de un tercero, legible por cualquiera
 * que pase cerca del teléfono; el gerente lo ve un toque después, dentro de la app.
 */

export const managerAlertTypes = [
  'late',
  'noShow',
  'incompleteEntry',
  'nearOvertime',
  'newRequest',
  'kioskNotSyncing',
  'wrongKiosk',
] as const;

export type ManagerAlertType = (typeof managerAlertTypes)[number];

export const alertLocales = ['es-PE', 'en'] as const;
export type AlertLocale = (typeof alertLocales)[number];

/** Marcadores que `composeAlert` sabe sustituir. Cualquier otro es un error. */
export const ALLOWED_PLACEHOLDERS = ['count', 'location'] as const;

type AlertCopy = {
  title: string;
  /** Un solo hecho. Sin `{{count}}`: "1 persona" se lee peor que "Alguien". */
  one: string;
  other: string;
};

export const ALERT_COPY: Record<AlertLocale, Record<ManagerAlertType, AlertCopy>> = {
  'es-PE': {
    late: {
      title: 'Tardanza',
      one: 'Alguien no ha fichado su entrada en {{location}}.',
      other: '{{count}} personas no han fichado su entrada en {{location}}.',
    },
    noShow: {
      title: 'Turno sin fichaje',
      one: 'Un turno terminó sin ningún fichaje en {{location}}.',
      other: '{{count}} turnos terminaron sin ningún fichaje en {{location}}.',
    },
    incompleteEntry: {
      title: 'Fichaje sin salida',
      one: 'Un registro quedó abierto en {{location}}.',
      other: '{{count}} registros quedaron abiertos en {{location}}.',
    },
    nearOvertime: {
      title: 'Cerca de horas extra',
      one: 'Alguien se acerca al umbral de horas extra en {{location}}.',
      other: '{{count}} personas se acercan al umbral de horas extra en {{location}}.',
    },
    newRequest: {
      title: 'Solicitud pendiente',
      one: 'Hay una solicitud esperando tu revisión en {{location}}.',
      other: 'Hay {{count}} solicitudes esperando tu revisión en {{location}}.',
    },
    kioskNotSyncing: {
      title: 'Reloj sin sincronizar',
      one: 'Un reloj lleva tiempo sin sincronizar en {{location}}.',
      other: '{{count}} relojes llevan tiempo sin sincronizar en {{location}}.',
    },
    wrongKiosk: {
      title: 'Fichaje rechazado',
      one: 'Se rechazó un intento de fichaje desde un reloj desactivado o de otra tienda en {{location}}.',
      other:
        'Se rechazaron {{count}} intentos de fichaje desde un reloj desactivado o de otra tienda en {{location}}.',
    },
  },
  en: {
    late: {
      title: 'Late arrival',
      one: 'Someone has not clocked in at {{location}}.',
      other: '{{count}} people have not clocked in at {{location}}.',
    },
    noShow: {
      title: 'Shift with no clock-in',
      one: 'A shift ended with no clock-in at {{location}}.',
      other: '{{count}} shifts ended with no clock-in at {{location}}.',
    },
    incompleteEntry: {
      title: 'Missing clock-out',
      one: 'An entry was left open at {{location}}.',
      other: '{{count}} entries were left open at {{location}}.',
    },
    nearOvertime: {
      title: 'Close to overtime',
      one: 'Someone is close to the overtime threshold at {{location}}.',
      other: '{{count}} people are close to the overtime threshold at {{location}}.',
    },
    newRequest: {
      title: 'Pending request',
      one: 'One request is waiting for your review at {{location}}.',
      other: '{{count}} requests are waiting for your review at {{location}}.',
    },
    kioskNotSyncing: {
      title: 'Clock not syncing',
      one: 'A clock has not synced for a while at {{location}}.',
      other: '{{count}} clocks have not synced for a while at {{location}}.',
    },
    wrongKiosk: {
      title: 'Clock-in rejected',
      one: 'A clock-in attempt from a deactivated or wrong-store clock was rejected at {{location}}.',
      other:
        '{{count}} clock-in attempts from a deactivated or wrong-store clock were rejected at {{location}}.',
    },
  },
};

export function isManagerAlertType(value: unknown): value is ManagerAlertType {
  return typeof value === 'string' && (managerAlertTypes as readonly string[]).includes(value);
}

/**
 * Idioma del destinatario, caído a es-PE.
 *
 * `profiles.locale` es texto libre en la base, así que puede llegar 'es', 'es-MX'
 * o cualquier cosa. Cualquier español cae en es-PE y cualquier inglés en en, igual
 * que hace `resolveDeviceLanguage` en la app: si las dos puntas resolvieran
 * distinto, la notificación llegaría en un idioma y la pantalla en otro.
 */
export function resolveAlertLocale(raw: string | null | undefined): AlertLocale {
  if (typeof raw !== 'string' || raw.trim() === '') return 'es-PE';
  const tag = raw.trim();
  if ((alertLocales as readonly string[]).includes(tag)) return tag as AlertLocale;
  const language = tag.split('-')[0]?.toLowerCase();
  if (language === 'en') return 'en';
  return 'es-PE';
}

/**
 * Compone título y cuerpo. `count` es la cantidad de hechos agrupados y
 * `locationName` el rótulo de la tienda: nada más entra en el texto.
 */
export function composeAlert(params: {
  type: ManagerAlertType;
  locale: AlertLocale;
  count: number;
  locationName: string;
}): { title: string; body: string } {
  const copy = ALERT_COPY[params.locale][params.type];
  const count = Math.max(1, Math.trunc(params.count));
  const template = count === 1 ? copy.one : copy.other;
  // Una tienda sin nombre no debería existir, pero si la base devuelve vacío es
  // mejor un texto genérico que un cuerpo con un hueco.
  const location = params.locationName.trim() === '' ? '—' : params.locationName.trim();

  return {
    title: copy.title,
    body: template.replaceAll('{{count}}', String(count)).replaceAll('{{location}}', location),
  };
}
