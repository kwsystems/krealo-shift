import { requestSchema } from '../api';

/**
 * Que una solicitud creada desde el panel se pueda volver a leer.
 *
 * MISMO FALLO QUE LOS TURNOS, por la misma puerta. Un «Agregar fichaje manual» desde
 * Horas inserta la solicitud a través del shim, y el shim escribía `created_at` como
 * `serverTimestamp()`. Eso vuelve de Firestore como objeto `Timestamp`, el esquema espera
 * `z.string()`, y `selectRows` lanza en vez de descartar la fila: **la bandeja de
 * Solicitudes entera dejaba de cargar** en cuanto había una creada desde el panel.
 *
 * Las que crea el reloj sí funcionaban, porque esas las escribe una Cloud Function y el
 * servidor sí guarda texto ISO. O sea que el fallo aparecía solo por el camino del
 * gerente, que es el menos transitado al probar.
 */

/** Lo que el shim añade a cualquier `insert`, sin que el llamante lo pida. */
const loQueAnadeElShim = {
  id: 'solicitud-1',
  created_at: '2026-09-22T10:00:00.000Z',
  updated_at: '2026-09-22T10:00:00.000Z',
};

const loQueEscribeElPanel = {
  organization_id: 'org-1',
  employee_id: 'alguien',
  location_id: 'sede-1',
  work_session_id: null,
  target_date: '2026-09-22',
  kind: 'correction' as const,
  proposed_value: {
    startsAt: '2026-09-22T14:00:00.000Z',
    endsAt: '2026-09-22T22:00:00.000Z',
    createdBy: 'uid-gerente',
  },
  reason: 'Olvidó marcar salida',
  status: 'pending' as const,
  reviewer_comment: null,
  reviewed_at: null,
};

describe('el documento que produce crear una solicitud', () => {
  it('lo acepta el esquema con el que se lee la bandeja', () => {
    const resultado = requestSchema.safeParse({ ...loQueEscribeElPanel, ...loQueAnadeElShim });

    const faltan = resultado.success
      ? []
      : resultado.error.issues.map((issue) => issue.path.join('.'));
    expect(faltan).toEqual([]);
  });

  /** El fallo exacto: una fecha que llega como objeto y no como texto. */
  it('rechaza un created_at que no sea texto, que es lo que devolvía serverTimestamp()', () => {
    const conTimestamp = {
      ...loQueEscribeElPanel,
      ...loQueAnadeElShim,
      created_at: { seconds: 1758531600, nanoseconds: 0 },
    };

    expect(requestSchema.safeParse(conTimestamp).success).toBe(false);
  });
});
