import { cuerpoFirmado } from '../outbox';

/**
 * La firma de la cola sin conexión, que hasta hoy no verificaba nadie.
 *
 * SE CALCULABA Y SE GUARDABA, y punto. Se buscó en todo `src/` y `functions/src/`:
 * `toWirePayload` no la mandaba, `syncOfflineEvents` no la recibía, y nada la
 * recalculaba para comparar. Un hash que se escribe y nadie lee, mientras su propio
 * comentario prometía «detectar que el archivo de la base local se manipuló entre el
 * momento en que se guardó el evento y el momento en que se envió».
 *
 * LO QUE SE PRUEBA AQUÍ es el texto que se firma, no el hash: el hash necesita la clave
 * del dispositivo, que vive en el almacén seguro del aparato. Y el texto es donde está el
 * valor real — si un campo no entra en él, cambiarlo en el SQLite del aparato no rompe la
 * firma y la manipulación pasa desapercibida.
 */

const BASE = {
  idempotencyKey: 'clave-1',
  deviceSequence: 7,
  employeeOpaqueId: 'persona-1',
  eventType: 'clock_out',
  breakType: null,
  breakReason: null,
  breakNote: null,
  departureReason: 'errand',
  departureNote: 'al almacén',
  shiftId: 'turno-1',
  locationId: 'sede-1',
  occurredAtDevice: '2026-09-23T17:00:00.000Z',
};

describe('el texto que se firma', () => {
  it('es estable: los mismos datos dan el mismo texto', () => {
    expect(cuerpoFirmado(BASE)).toBe(cuerpoFirmado({ ...BASE }));
  });

  /**
   * CADA CAMPO QUE SE PUEDA TOCAR TIENE QUE ENTRAR, y se comprueban uno a uno en vez de
   * mirar la lista: mirar la lista comprueba que la lista es la lista. Lo que importa es
   * que cambiar el dato cambie el texto, porque es lo único que hace que la firma detecte
   * algo.
   *
   * `occurredAtDevice` es el que más importa: es la hora del fichaje, o sea el minuto que
   * se paga. `departureReason` y `departureNote` son texto libre escrito por una persona
   * sobre por qué se ausentó, que es justo lo que alguien querría reescribir después.
   */
  const camposQueImportan: [string, unknown][] = [
    ['idempotencyKey', 'otra-clave'],
    ['deviceSequence', 8],
    ['employeeOpaqueId', 'persona-2'],
    ['eventType', 'clock_in'],
    ['breakType', 'paid'],
    ['breakReason', 'meal'],
    ['breakNote', 'otra cosa'],
    ['departureReason', 'permit'],
    ['departureNote', 'me fui a casa'],
    ['shiftId', 'turno-2'],
    ['locationId', 'sede-2'],
    ['occurredAtDevice', '2026-09-23T19:00:00.000Z'],
  ];

  it.each(camposQueImportan)('cambiar «%s» cambia el texto firmado', (campo, valor) => {
    const tocado = { ...BASE, [campo]: valor };
    expect(cuerpoFirmado(tocado)).not.toBe(cuerpoFirmado(BASE));
  });

  it('los campos vacíos no se confunden entre sí', () => {
    // Si `null` y `''` dieran el mismo texto, mover un valor de un campo al de al lado
    // no rompería la firma. El separador es lo que lo impide.
    const a = cuerpoFirmado({ ...BASE, breakReason: 'x', breakNote: null });
    const b = cuerpoFirmado({ ...BASE, breakReason: null, breakNote: 'x' });
    expect(a).not.toBe(b);
  });

  it('lleva los doce campos separados', () => {
    expect(cuerpoFirmado(BASE).split('|')).toHaveLength(12);
  });
});
