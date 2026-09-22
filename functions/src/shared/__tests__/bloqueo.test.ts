import {
  BLOQUEO_MINUTOS,
  estaBloqueado,
  MAX_INTENTOS,
  trasUnFallo,
  VENTANA_MINUTOS,
  type EstadoDeIntentos,
} from '../bloqueo';

/**
 * Los dos agujeros que esta prueba fija son los que se midieron contra produccion:
 * el contador no caducaba, y al vencer un bloqueo seguia arriba, asi que un solo
 * fallo mas volvia a bloquear la tienda entera otros cinco minutos.
 */

const T0 = Date.parse('2026-09-22T10:00:00.000Z');
const MINUTO = 60_000;
const limpio: EstadoDeIntentos = { intentos: 0, ultimoFallo: null, bloqueadoHasta: null };

/** Encadena `n` fallos seguidos, uno cada diez segundos. */
function fallosSeguidos(n: number, desde = T0): EstadoDeIntentos {
  let estado = limpio;
  for (let i = 0; i < n; i += 1) estado = trasUnFallo(estado, desde + i * 10_000);
  return estado;
}

describe('bloqueo del reloj por PIN equivocados', () => {
  it('no bloquea antes del limite', () => {
    const estado = fallosSeguidos(MAX_INTENTOS - 1);
    expect(estado.intentos).toBe(MAX_INTENTOS - 1);
    expect(estado.bloqueadoHasta).toBeNull();
    expect(estaBloqueado(estado, T0)).toBe(false);
  });

  it('bloquea justo al llegar al limite, y por los minutos dichos', () => {
    const estado = fallosSeguidos(MAX_INTENTOS);
    expect(estado.bloqueadoHasta).not.toBeNull();
    expect(estaBloqueado(estado, T0)).toBe(true);

    // El bloqueo cuenta desde el ULTIMO fallo, no desde el primero: medirlo desde T0
    // se queda corto por los segundos que duro la rafaga. Lo escribi asi la primera
    // vez y la prueba lo cazo.
    const vence = Date.parse(estado.bloqueadoHasta!);
    expect(vence).toBe(Date.parse(estado.ultimoFallo!) + BLOQUEO_MINUTOS * MINUTO);
    expect(estaBloqueado(estado, vence - 1)).toBe(true);
    expect(estaBloqueado(estado, vence)).toBe(false);
  });

  it('EL CONTADOR CADUCA: fallos repartidos a lo largo del dia no se suman', () => {
    // Nueve fallos, cada uno una hora despues del anterior. Antes esto bloqueaba.
    let estado = limpio;
    for (let i = 0; i < MAX_INTENTOS + 4; i += 1) {
      estado = trasUnFallo(estado, T0 + i * 60 * MINUTO);
      expect(estado.intentos).toBe(1);
      expect(estado.bloqueadoHasta).toBeNull();
    }
  });

  it('el fallo justo dentro de la ventana SI suma', () => {
    const primero = trasUnFallo(limpio, T0);
    const dentro = trasUnFallo(primero, T0 + (VENTANA_MINUTOS - 1) * MINUTO);
    expect(dentro.intentos).toBe(2);

    const fuera = trasUnFallo(primero, T0 + (VENTANA_MINUTOS + 1) * MINUTO);
    expect(fuera.intentos).toBe(1);
  });

  it('CUMPLIR EL BLOQUEO DEVUELVE LOS INTENTOS: un fallo despues no vuelve a bloquear', () => {
    const bloqueado = fallosSeguidos(MAX_INTENTOS);
    const despues = Date.parse(bloqueado.bloqueadoHasta!) + MINUTO;

    const siguiente = trasUnFallo(bloqueado, despues);
    expect(siguiente.intentos).toBe(1);
    expect(siguiente.bloqueadoHasta).toBeNull();
    expect(estaBloqueado(siguiente, despues)).toBe(false);
  });

  it('un bloqueo vigente sigue vigente aunque llegue otro fallo', () => {
    const bloqueado = fallosSeguidos(MAX_INTENTOS);
    const durante = T0 + 1 * MINUTO;
    const siguiente = trasUnFallo(bloqueado, durante);
    expect(estaBloqueado(siguiente, durante)).toBe(true);
  });

  it('una fecha corrupta se trata como «no hay fallo previo», no como bloqueo eterno', () => {
    const roto: EstadoDeIntentos = {
      intentos: 99,
      ultimoFallo: 'no-es-una-fecha',
      bloqueadoHasta: 'tampoco',
    };
    expect(estaBloqueado(roto, T0)).toBe(false);
    expect(trasUnFallo(roto, T0).intentos).toBe(1);
  });
});
