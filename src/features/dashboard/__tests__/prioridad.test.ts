import { prioridadDelDia, type ConteosDelDia } from '../prioridad';

/**
 * La prueba que demuestra que la priorización HACE algo.
 *
 * Es fácil escribir un ordenador que siempre devuelve lo mismo y que la pantalla
 * parezca priorizada sin estarlo. Así que aquí no se comprueba «devuelve una lista»:
 * se comprueba que ante DÍAS DISTINTOS el titular es DISTINTO, que es la promesa
 * entera —«si nadie llegó tarde, "0 atrasados" no merece el sitio principal»—.
 */

const nada: ConteosDelDia = {
  absent: 0,
  late: 0,
  incomplete: 0,
  requests: 0,
  pendingSync: 0,
};

describe('lo más importante del día', () => {
  it('un día tranquilo NO tiene titular, y lo dice', () => {
    const resultado = prioridadDelDia(nada);
    expect(resultado.titular).toBeNull();
    expect(resultado.resto).toEqual([]);
    expect(resultado.todoEnOrden).toBe(true);
  });

  it('un cero nunca ocupa el sitio principal', () => {
    // Con tres solicitudes y cero de todo lo demás, el titular es solicitudes: no hay
    // forma de que «0 atrasados» se cuele por delante por estar antes en la lista.
    const resultado = prioridadDelDia({ ...nada, requests: 3 });
    expect(resultado.titular).toMatchObject({ clave: 'requests', count: 3 });
    expect(resultado.resto).toEqual([]);
  });

  it('un ausente manda sobre un atrasado, aunque haya más atrasados', () => {
    // El número NO decide: cinco atrasados vienen de camino y se resuelven solos; un
    // ausente deja la tienda corta hasta que alguien llame por teléfono.
    const resultado = prioridadDelDia({ ...nada, absent: 1, late: 5 });
    expect(resultado.titular?.clave).toBe('absent');
    expect(resultado.resto.map((fila) => fila.clave)).toEqual(['late']);
  });

  it('ordena lo demás por lo que cuesta ignorarlo, no por cantidad', () => {
    const resultado = prioridadDelDia({
      absent: 2,
      late: 1,
      incomplete: 9,
      requests: 4,
      pendingSync: 30,
    });
    expect(resultado.titular?.clave).toBe('absent');
    expect(resultado.resto.map((fila) => fila.clave)).toEqual([
      'late',
      'incomplete',
      'requests',
      'pendingSync',
    ]);
  });

  /**
   * LA PRUEBA QUE PIDE LA TAREA: tres días distintos, tres pantallas distintas. Si los
   * tres dieran el mismo titular, la priorización no estaría haciendo nada y la
   * pantalla se vería igual siempre, que es justo de lo que venimos.
   */
  it('tres días distintos dan tres titulares distintos', () => {
    const tranquilo = prioridadDelDia(nada);
    const conAusentes = prioridadDelDia({ ...nada, absent: 3, late: 1 });
    const conSolicitudes = prioridadDelDia({ ...nada, requests: 6, pendingSync: 2 });

    expect(tranquilo.titular).toBeNull();
    expect(conAusentes.titular?.clave).toBe('absent');
    expect(conSolicitudes.titular?.clave).toBe('requests');

    const titulares = [tranquilo, conAusentes, conSolicitudes].map(
      (dia) => dia.titular?.clave ?? 'ninguno',
    );
    expect(new Set(titulares).size).toBe(3);
  });

  it('cada cosa que se destaca lleva a donde se resuelve', () => {
    const resultado = prioridadDelDia({ ...nada, absent: 1, incomplete: 2, requests: 1 });
    expect(resultado.titular?.destino).toBe('/(manager)/schedule');
    expect(resultado.resto.map((fila) => fila.destino)).toEqual([
      '/(manager)/hours',
      '/(manager)/requests',
    ]);
  });

  /**
   * La cola de sincronización NO se arregla desde ninguna pantalla: se arregla cuando
   * vuelve la red. Enviar a alguien a una pantalla donde no hay nada que tocar es peor
   * que no ofrecer nada, así que su destino es `null` a propósito.
   */
  it('lo que no se arregla dentro de la app no finge llevar a ningún sitio', () => {
    const resultado = prioridadDelDia({ ...nada, pendingSync: 4 });
    expect(resultado.titular).toMatchObject({ clave: 'pendingSync', destino: null });
  });
});
