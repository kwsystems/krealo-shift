import type { TFunction } from 'i18next';

/**
 * POR QUÉ UNA CUENTA NO QUEDÓ UNIDA A SU FICHA (5-oct), dicho en UN sitio: la pantalla de
 * «sin acceso» y la de «Mi horario» lo escriben igual. Antes las dos decían algo genérico
 * —«pide que pongan este correo en tu ficha»— también cuando el correo YA estaba puesto, y
 * ni la persona ni quien administra sabían qué arreglar. Los motivos los da el servidor
 * (`functions/src/ficha-de-empleado.ts`).
 */
export const MOTIVOS_SIN_FICHA = [
  'sin-invitacion',
  'correo-repetido',
  'ya-ligada',
  'ficha-inactiva',
  'acceso-retirado',
] as const;
export type MotivoSinFicha = (typeof MOTIVOS_SIN_FICHA)[number];

/** El motivo, si es uno de los conocidos; `null` si no vino o es de un servidor más nuevo. */
export function motivoSinFicha(valor: unknown): MotivoSinFicha | null {
  return (MOTIVOS_SIN_FICHA as readonly unknown[]).includes(valor)
    ? (valor as MotivoSinFicha)
    : null;
}

/** El título y lo que tiene que hacer, con el correo con el que entró. */
export function textoDelMotivo(
  t: TFunction,
  motivo: MotivoSinFicha,
  correo: string | null,
): { titulo: string; cuerpo: string } {
  const email = correo ?? t('access.linkReason.yourEmail');
  return {
    titulo: t(`access.linkReason.${motivo}.title`),
    cuerpo: t(`access.linkReason.${motivo}.body`, { email }),
  };
}
