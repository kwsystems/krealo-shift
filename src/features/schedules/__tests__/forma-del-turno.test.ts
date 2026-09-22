import { shiftRowSchema } from '../api';

/**
 * Que un turno recién creado se pueda VOLVER A LEER.
 *
 * ESTO NO ES TEORICO: hasta el 2026-09-22, `createShift` escribía el turno sin
 * `publication_version`, sin `published_at` y sin `updated_at`, y los tres son
 * obligatorios en el esquema con el que la propia pantalla lee la semana. Y `selectRows`
 * no descarta la fila mala —lanza—, así que no se perdía un turno: **fallaba la consulta
 * de la semana entera**. Creabas un turno, recargabas, y el horario no cargaba.
 *
 * NADIE LO VIO PORQUE LA DEMOSTRACION SI ESCRIBE ESOS CAMPOS. El horario funcionaba
 * perfecto en la demo y en los siete arneses; el único camino que lo rompía era crear un
 * turno de verdad contra Firestore, y eso no lo había hecho nadie todavía.
 *
 * La prueba arma el documento EXACTO que acaba en la base —lo que escribe `createShift`
 * más lo que el shim añade por su cuenta— y lo pasa por el esquema. Es barata y habría
 * cazado el fallo el primer día.
 */

/** Lo que el shim de Firestore añade a cualquier `insert`, sin que el llamante lo pida. */
const loQueAnadeElShim = {
  id: 'turno-recien-creado',
  created_at: '2026-09-22T10:00:00.000Z',
  updated_at: '2026-09-22T10:00:00.000Z',
};

/** Lo que escribe `createShift`: `buildRow` + el estado y los autores. */
const loQueEscribeCrearTurno = {
  organization_id: 'org-1',
  location_id: 'sede-1',
  employee_id: 'alguien',
  job_role_id: null,
  starts_at: '2026-09-22T14:00:00.000Z',
  ends_at: '2026-09-22T22:00:00.000Z',
  timezone: 'America/Lima',
  planned_unpaid_break_minutes: 30,
  employee_note: null,
  manager_note: null,
  status: 'draft' as const,
  publication_version: 0,
  published_at: null,
  created_by: 'uid-gerente',
  updated_by: 'uid-gerente',
};

describe('el documento que produce crear un turno', () => {
  it('lo acepta el esquema con el que se lee la semana', () => {
    const resultado = shiftRowSchema.safeParse({
      ...loQueEscribeCrearTurno,
      ...loQueAnadeElShim,
    });

    // El mensaje nombra los campos que faltan: es lo que uno quiere leer al romperse.
    const faltan = resultado.success
      ? []
      : resultado.error.issues.map((issue) => issue.path.join('.'));
    expect(faltan).toEqual([]);
  });

  /**
   * LAS FECHAS SON TEXTO, NO `Timestamp`. El shim escribía `serverTimestamp()`, que
   * vuelve de Firestore como objeto, y el esquema espera `z.string()`. Es el mismo fallo
   * por otra puerta: bastaba EDITAR un turno para tirar la semana.
   */
  it('rechaza una fecha que no sea texto, que es lo que devolvía serverTimestamp()', () => {
    const conTimestamp = {
      ...loQueEscribeCrearTurno,
      ...loQueAnadeElShim,
      updated_at: { seconds: 1758531600, nanoseconds: 0 },
    };

    expect(shiftRowSchema.safeParse(conTimestamp).success).toBe(false);
  });

  /** Cada campo obligatorio, uno a uno: así el fallo dice cuál falta y no «algo». */
  it.each(['publication_version', 'published_at', 'updated_at'])(
    'sin «%s» no se puede leer',
    (campo) => {
      const incompleto: Record<string, unknown> = {
        ...loQueEscribeCrearTurno,
        ...loQueAnadeElShim,
      };
      delete incompleto[campo];

      expect(shiftRowSchema.safeParse(incompleto).success).toBe(false);
    },
  );
});
