import type { TFunction } from 'i18next';

import { BREAK_REASONS, type BreakReason } from '@/domain/break-reason';
import { breakReasonLabels } from '@/i18n/break-reason-labels';

/**
 * QUÉ DICE CADA AVISO (5-oct), en UN sitio: la campana y el aviso emergente lo escriben
 * igual. Andree: «cuando alguien marca, cuando alguien va a comer, a mí me debe salir una
 * notificación». Si cada uno armara su frase, la campana diría «salió a comer» y el
 * emergente «inició su descanso» sobre la misma marca, y quien lee no sabría si son dos.
 *
 * LA CLASE SALE DEL TIPO CON EL QUE CUENTA LA MARCA (`reclassified_as`), no del que se
 * pulsó: una salida que quien gestiona reclasificó como almuerzo es un almuerzo en Horas,
 * en Reportes y aquí.
 */
export type ClaseDeAviso = 'entrada' | 'comida' | 'descanso' | 'pausa' | 'vuelta' | 'salida';

type TipoDeMarca = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

export type MarcaParaAviso = {
  event_type: TipoDeMarca;
  reclassified_as: TipoDeMarca | null;
  break_type: 'paid' | 'unpaid' | 'meal' | 'other' | null;
  break_reason: string | null;
};

export function claseDeAviso(marca: MarcaParaAviso): ClaseDeAviso {
  switch (marca.reclassified_as ?? marca.event_type) {
    case 'clock_in':
      return 'entrada';
    case 'clock_out':
      return 'salida';
    case 'break_end':
      return 'vuelta';
    case 'break_start':
      /*
       * SIN MOTIVO, LO QUE DIGA EL TIPO DE PAUSA. Un reloj de antes de los motivos solo
       * guardaba `break_type`; `meal` es comer, y lo demás es un descanso sin más.
       */
      if (marca.break_reason === null) return marca.break_type === 'meal' ? 'comida' : 'descanso';
      if (marca.break_reason === 'meal') return 'comida';
      if (marca.break_reason === 'rest') return 'descanso';
      return 'pausa';
  }
}

/**
 * LA FRASE DEL AVISO. `nombre` llega ya resuelto (preferido o completo); sin él, «Alguien
 * del equipo», nunca un identificador: la persona puede ser nueva y no estar aún en la
 * lista que tiene cargada el panel.
 *
 * Un motivo que esta versión no conoce —un reloj más nuevo— se dice sin motivo en vez de
 * enseñar la palabra cruda que guardó el servidor.
 */
export function textoDelAviso(
  t: TFunction,
  marca: MarcaParaAviso,
  nombre: string | null | undefined,
): string {
  const name =
    nombre !== null && nombre !== undefined && nombre.trim() !== '' ? nombre : t('alerts.someone');
  switch (claseDeAviso(marca)) {
    case 'entrada':
      return t('alerts.clockIn', { name });
    case 'salida':
      return t('alerts.clockOut', { name });
    case 'vuelta':
      return t('alerts.back', { name });
    case 'comida':
      return t('alerts.meal', { name });
    case 'descanso':
      return t('alerts.rest', { name });
    case 'pausa': {
      const motivo = marca.break_reason;
      const conocido =
        motivo !== null &&
        motivo !== 'other' &&
        (BREAK_REASONS as readonly string[]).includes(motivo);
      return conocido
        ? t('alerts.pause', { name, reason: breakReasonLabels(t)[motivo as BreakReason] })
        : t('alerts.pauseNoReason', { name });
    }
  }
}
