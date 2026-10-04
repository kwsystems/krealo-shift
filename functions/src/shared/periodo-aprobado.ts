import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { COLLECTIONS, db, nowISO } from './admin';
import { audit } from './caller';
import { zonaSegura } from './zonas';

/**
 * CAMBIAR HORAS DE UNA SEMANA YA APROBADA QUEDA ANOTADO EN ESA SEMANA (auditoría, 4-oct).
 *
 * Aprobar una semana es el paso que va antes de exportar la nómina, y ninguna función que
 * escribe horas lo miraba: una corrección hecha después cambiaba las horas sin dejar rastro
 * en la semana, y lo exportado dejaba de cuadrar sin que nadie lo supiera. Bloquearlo del
 * todo es decisión de Andree; esto lo hace VISIBLE: la semana cuenta cuántos cambios tuvo
 * después de aprobarse, cuándo fue el último y quién lo hizo, y Horas lo enseña al lado de
 * «Aprobada».
 *
 * No hace fallar la acción que lo llama: el cambio de horas ya se hizo y tiene su propia
 * fila (`time_adjustments`, el fichaje, el registro de auditoría). Si anotarlo falla, se
 * registra el error y se sigue.
 *
 * Volver a aprobar o reabrir la semana pone la cuenta a cero: ver `approveTimesheetPeriod`.
 */
export async function anotarCambioTrasAprobar(params: {
  organizationId: string;
  locationId: string;
  /** Un instante de lo que cambió: la entrada de la jornada, o el fichaje. */
  instante: string;
  uid: string;
  /** Qué lo cambió, para el registro de auditoría. */
  motivo: string;
}): Promise<string[]> {
  try {
    const sede = (await db.collection(COLLECTIONS.locations).doc(params.locationId).get()).data();
    const zona = zonaSegura(sede?.timezone ?? 'America/Lima', 'anotarCambioTrasAprobar');
    const dia = diaLocal(params.instante, zona);
    if (dia === null) return [];

    // Dos igualdades y nada más: no pide un índice compuesto, y aprobadas hay pocas por sede.
    const aprobadas = await db
      .collection(COLLECTIONS.timesheetPeriods)
      .where('location_id', '==', params.locationId)
      .where('status', '==', 'approved')
      .get();
    const tocadas = aprobadas.docs.filter((doc) => {
      const periodo = doc.data();
      return String(periodo.starts_on) <= dia && dia <= String(periodo.ends_on);
    });

    for (const doc of tocadas) {
      await doc.ref.update({
        changes_after_approval: FieldValue.increment(1),
        changed_after_approval_at: nowISO(),
        changed_after_approval_by: params.uid,
      });
      await audit({
        organizationId: params.organizationId,
        actorUserId: params.uid,
        action: 'timesheet_period_changed_after_approval',
        entityType: 'timesheet_period',
        entityId: doc.id,
        after: { motivo: params.motivo, instante: params.instante },
      });
    }
    return tocadas.map((doc) => doc.id);
  } catch (error) {
    logger.error('No se pudo anotar el cambio en la semana aprobada', {
      locationId: params.locationId,
      instante: params.instante,
      error: String(error),
    });
    return [];
  }
}

/** Lo que vuelve una semana a «sin cambios después de aprobar»: al aprobarla o reabrirla. */
export const SIN_CAMBIOS_TRAS_APROBAR = {
  changes_after_approval: 0,
  changed_after_approval_at: null,
  changed_after_approval_by: null,
} as const;

function diaLocal(instante: string, zona: string): string | null {
  const ms = Date.parse(instante);
  if (Number.isNaN(ms)) return null;
  // `en-CA` da exactamente `AAAA-MM-DD`, el formato de `starts_on` y `ends_on`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}
