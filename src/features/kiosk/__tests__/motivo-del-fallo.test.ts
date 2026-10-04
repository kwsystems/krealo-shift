import { mapInvokeError } from '../api';

/**
 * ¿LLEGA AL RELOJ EL MOTIVO DE UN FALLO?
 *
 * ESTO NO ES UNA PRUEBA DE UNA FUNCIÓN PEQUEÑA: es el cable entre lo que el servidor sabe
 * y lo que la pantalla puede decir. Estaba cortado, y el sintoma era el peor posible en
 * una tienda: quien se equivocaba de PIN leía «No pudimos completar la acción». Un fallo
 * que la persona puede arreglar sola —volver a teclear— disfrazado de avería.
 *
 * La causa: el motivo viaja en `error.details` de la Cloud Function, y el traductor mirab
 * el CUERPO de la respuesta, que en un error no existe. Los cinco casos del `switch`
 * estaban escritos y traducidos, y no se ejecutaban nunca.
 *
 * Por eso las formas de abajo son LAS DEL SERVIDOR DE VERDAD —las mismas que lanzan
 * `kiosk-api.ts` y `shared/kiosk.ts`— y no una invención de la prueba.
 */

/** Lo que `callFunction` entrega cuando una función lanza `HttpsError(code, msg, details)`. */
function comoLlegaDelServidor(details: unknown) {
  return { code: 'internal', message: 'algo que la pantalla no debe mostrar', details };
}

describe('el motivo de un fallo del reloj', () => {
  it('un PIN equivocado se reconoce como tal, no como un error del servidor', () => {
    const resultado = mapInvokeError(
      comoLlegaDelServidor({ code: 'invalid_pin', remainingAttempts: null }),
      null,
    );
    expect(resultado).toEqual({ kind: 'invalid_pin', remainingAttempts: null });
  });

  it('un reloj bloqueado trae hasta cuándo, que es lo que la pantalla necesita', () => {
    const resultado = mapInvokeError(
      comoLlegaDelServidor({ code: 'locked', lockedUntil: '2026-09-29T15:00:00.000Z' }),
      null,
    );
    expect(resultado).toEqual({ kind: 'locked', lockedUntil: '2026-09-29T15:00:00.000Z' });
  });

  it('un bloqueo sin fecha no revienta: cae a cadena vacía', () => {
    expect(
      mapInvokeError(comoLlegaDelServidor({ code: 'locked', lockedUntil: null }), null),
    ).toEqual({ kind: 'locked', lockedUntil: '' });
  });

  it('un reloj desactivado se reconoce', () => {
    expect(mapInvokeError(comoLlegaDelServidor({ code: 'revoked' }), null)).toEqual({
      kind: 'revoked',
    });
  });

  it('un código de activación vencido se distingue de una avería', () => {
    expect(mapInvokeError(comoLlegaDelServidor({ code: 'activation_code_invalid' }), null)).toEqual(
      { kind: 'activation_code_invalid' },
    );
  });

  /*
   * EL FALLO DEL 3-OCT: una vendedora no pudo marcar su salida. El permiso del PIN había
   * vencido, el reloj lo tomaba por avería —«Inténtalo otra vez»— y reintentar con el
   * mismo permiso fallaba siempre. Las dos formas son las que lanza el servidor.
   */
  it('un permiso vencido se reconoce, para pedir el PIN otra vez y no «inténtalo otra vez»', () => {
    expect(mapInvokeError(comoLlegaDelServidor({ code: 'action_expired' }), null)).toEqual({
      kind: 'action_expired',
    });
  });

  it('una transición imposible se reconoce aunque traiga el estado en los detalles', () => {
    expect(
      mapInvokeError(
        comoLlegaDelServidor({ code: 'invalid_transition', state: 'OFF_SHIFT' }),
        null,
      ),
    ).toEqual({ kind: 'invalid_transition' });
  });

  it('lo que no se reconoce sigue siendo un fallo del servidor, con su mensaje', () => {
    const resultado = mapInvokeError(
      { code: 'internal', message: 'se cayó el mundo', details: null },
      null,
    );
    expect(resultado.kind).toBe('server');
  });

  it('un código inventado en los detalles no se cuela', () => {
    const resultado = mapInvokeError(comoLlegaDelServidor({ code: 'lo_que_sea' }), null);
    expect(resultado.kind).toBe('server');
  });

  /*
   * EL CAMINO VIEJO SE CONSERVA: si alguna función devuelve el motivo como DATOS en vez
   * de como error, sigue funcionando. Quitarlo no cuesta nada y mantenerlo tampoco, y
   * esta prueba es la que dice cuál de los dos es el que se usa hoy.
   */
  it('si el motivo viniera en el cuerpo, también se entiende', () => {
    const resultado = mapInvokeError({ code: 'internal', message: 'x' }, { code: 'revoked' });
    expect(resultado).toEqual({ kind: 'revoked' });
  });

  it('los detalles mandan sobre el cuerpo', () => {
    const resultado = mapInvokeError(comoLlegaDelServidor({ code: 'invalid_pin' }), {
      code: 'revoked',
    });
    expect(resultado.kind).toBe('invalid_pin');
  });
});
