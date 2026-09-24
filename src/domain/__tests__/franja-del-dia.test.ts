import { franjaDelDia, marcasDeHora, ventanaDelDia } from '@/domain/franja-del-dia';

/**
 * La geometría de la franja del día.
 *
 * Se prueba aquí y no en la pantalla porque lo que puede salir mal son los BORDES —una
 * jornada que se sale de la ventana, un turno al que nadie fue, una sesión todavía
 * abierta— y esos casos son carísimos de montar en un navegador y triviales aquí.
 *
 * Todas las horas son del mismo día para que las fracciones se puedan comprobar a mano:
 * ventana de 08:00 a 20:00 son doce horas, así que cada hora es exactamente 1/12.
 */

const h = (hora: number, minuto = 0) => new Date(2026, 8, 23, hora, minuto, 0, 0);
const VENTANA = { desde: h(8), hasta: h(20) };
const UNA_HORA = 1 / 12;

/** Redondeo a 4 decimales: comparar flotantes exactos es pedir un fallo que no dice nada. */
const casi = (valor: number) => Math.round(valor * 10000) / 10000;

describe('franjaDelDia', () => {
  it('coloca el turno donde le toca dentro de la ventana', () => {
    const { plan } = franjaDelDia({
      ventana: VENTANA,
      turno: { desde: h(9), hasta: h(13) },
      trabajado: null,
      ahora: h(10),
    });

    expect(casi(plan!.desde)).toBe(casi(UNA_HORA)); // 09:00 es la hora 1 de 12
    expect(casi(plan!.hasta)).toBe(casi(5 * UNA_HORA)); // 13:00 es la hora 5
  });

  it('LLEGAR TARDE se ve: el relleno empieza más adentro que su carril', () => {
    /*
     * Este es el caso para el que existe la franja. Hoy hay que leer «09:00» y «09:45»,
     * restarlas y concluir. Aquí el relleno empieza más adentro y ya está.
     */
    const { plan, real } = franjaDelDia({
      ventana: VENTANA,
      turno: { desde: h(9), hasta: h(13) },
      trabajado: { desde: h(9, 45), hasta: h(13) },
      ahora: h(14),
    });

    expect(real!.desde).toBeGreaterThan(plan!.desde);
    expect(real!.hasta).toBe(plan!.hasta);
  });

  it('NO VINO: hay carril y no hay relleno', () => {
    const { plan, real } = franjaDelDia({
      ventana: VENTANA,
      turno: { desde: h(9), hasta: h(13) },
      trabajado: null,
      ahora: h(14),
    });

    expect(plan).not.toBeNull();
    expect(real).toBeNull();
  });

  it('VINO SIN TURNO: hay relleno y no hay carril', () => {
    const { plan, real } = franjaDelDia({
      ventana: VENTANA,
      turno: null,
      trabajado: { desde: h(9), hasta: h(13) },
      ahora: h(14),
    });

    expect(plan).toBeNull();
    expect(real).not.toBeNull();
  });

  it('una jornada todavía abierta se pinta hasta el final de la ventana', () => {
    /*
     * ESTA PRUEBA NO DISTINGUE «final de la ventana» DE «infinito», y conviene saberlo:
     * probé a poner infinito en el código y siguió pasando, porque el recorte a [0,1] lo
     * tapa. Lo que fija de verdad es que una jornada sin cerrar se pinta ENTERA hasta el
     * borde en vez de no pintarse, que es lo que importa en pantalla. La línea del código
     * dice «final de la ventana» porque se lee mejor, no porque sea lo único que funcione.
     */
    const { real } = franjaDelDia({
      ventana: VENTANA,
      turno: null,
      trabajado: { desde: h(9), hasta: null },
      ahora: h(11),
    });

    expect(real!.hasta).toBe(1);
  });

  it('lo que se sale de la ventana se recorta a sus bordes', () => {
    // Turno de madrugada que acaba dentro: empieza antes de las 08:00.
    const { plan } = franjaDelDia({
      ventana: VENTANA,
      turno: { desde: h(5), hasta: h(10) },
      trabajado: null,
      ahora: h(11),
    });

    expect(plan!.desde).toBe(0);
    expect(casi(plan!.hasta)).toBe(casi(2 * UNA_HORA));
  });

  it('lo que queda ENTERO fuera de la ventana no se pinta', () => {
    /*
     * Y esto no es lo mismo que recortarlo a cero: un turno de ayer no debe dejar una
     * marca pegada al borde izquierdo, porque se leería como «entró justo al abrir».
     */
    const ayer = { desde: new Date(2026, 8, 22, 9), hasta: new Date(2026, 8, 22, 17) };
    const { plan } = franjaDelDia({ ventana: VENTANA, turno: ayer, trabajado: null, ahora: h(11) });

    expect(plan).toBeNull();
  });

  it('«ahora» se sitúa en la ventana, y desaparece cuando queda fuera', () => {
    const dentro = franjaDelDia({ ventana: VENTANA, turno: null, trabajado: null, ahora: h(14) });
    expect(casi(dentro.ahora!)).toBe(casi(6 * UNA_HORA));

    const fuera = franjaDelDia({ ventana: VENTANA, turno: null, trabajado: null, ahora: h(23) });
    expect(fuera.ahora).toBeNull();
  });

  it('una ventana sin duración devuelve todo vacío en vez de dividir por cero', () => {
    /*
     * Pasa de verdad: una sede sin nada hoy, donde el principio y el final salen del mismo
     * sitio. Sin la guarda, cada fracción sería Infinity o NaN y la barra se pintaría como
     * un rectángulo absurdo o como nada, según el motor.
     */
    const franja = franjaDelDia({
      ventana: { desde: h(9), hasta: h(9) },
      turno: { desde: h(9), hasta: h(13) },
      trabajado: { desde: h(9), hasta: h(13) },
      ahora: h(9),
    });

    expect(franja).toEqual({ plan: null, real: null, ahora: null });
  });

  it('un intervalo al revés no se dibuja: es un dato roto, no un tramo de ancho cero', () => {
    const { plan } = franjaDelDia({
      ventana: VENTANA,
      turno: { desde: h(13), hasta: h(9) },
      trabajado: null,
      ahora: h(11),
    });

    expect(plan).toBeNull();
  });
});

describe('ventanaDelDia', () => {
  it('encuadra desde lo más temprano hasta lo más tarde, con margen', () => {
    const ventana = ventanaDelDia(
      [
        { desde: h(9), hasta: h(13) },
        { desde: h(15), hasta: h(19) },
      ],
      h(20),
      30,
    );

    expect(ventana!.desde.getHours()).toBe(8);
    expect(ventana!.desde.getMinutes()).toBe(30);
    expect(ventana!.hasta.getHours()).toBe(19);
    expect(ventana!.hasta.getMinutes()).toBe(30);
  });

  it('una jornada abierta encuadra hasta AHORA, no hasta el final del día', () => {
    const ventana = ventanaDelDia([{ desde: h(9), hasta: null }], h(14), 0);
    expect(ventana!.hasta.getHours()).toBe(14);
  });

  it('sin nada que enseñar no hay ventana', () => {
    expect(ventanaDelDia([], h(12))).toBeNull();
  });
});

/**
 * LAS MARCAS DE HORA. Lo que puede fallar aquí no es «qué números salen» sino que la regla
 * mienta: una marca fuera de la ventana, una hora que no es en punto en la tienda, o un
 * paso tan fino que los rótulos se encabalguen justo en las jornadas largas.
 */
describe('marcasDeHora', () => {
  const LIMA = 'America/Lima';
  const ventana = (desdeISO: string, hastaISO: string) => ({
    desde: new Date(desdeISO),
    hasta: new Date(hastaISO),
  });
  /** La hora de reloj en Lima, que es la que el rótulo va a enseñar. */
  const enLima = (fecha: Date) =>
    new Intl.DateTimeFormat('es-PE', {
      timeZone: LIMA,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(fecha);

  it('todas las marcas son horas EN PUNTO en la zona de la tienda', () => {
    // Lo que sirve de regla es la hora en punto. Una marca a las 09:37 no es referencia
    // de nada, y «en punto» solo significa algo en el reloj de quien atiende la tienda:
    // en UTC estas mismas marcas caen a las 14:00, que es otra cosa.
    const marcas = marcasDeHora(ventana('2026-09-24T13:08:00Z', '2026-09-24T23:30:00Z'), LIMA);
    expect(marcas.length).toBeGreaterThan(1);
    for (const marca of marcas) expect(enLima(marca.instante)).toMatch(/:00$/);
  });

  it('ninguna marca se sale de la ventana', () => {
    // Una marca en 1,2 se pintaría fuera de la pista, o peor, recortada en el borde
    // diciendo una hora que no corresponde a donde está.
    const v = ventana('2026-09-24T13:08:00Z', '2026-09-24T20:30:00Z');
    for (const marca of marcasDeHora(v, LIMA)) {
      expect(marca.fraccion).toBeGreaterThanOrEqual(0);
      expect(marca.fraccion).toBeLessThanOrEqual(1);
      expect(marca.instante.getTime()).toBeGreaterThanOrEqual(v.desde.getTime());
      expect(marca.instante.getTime()).toBeLessThanOrEqual(v.hasta.getTime());
    }
  });

  it('la fracción dice DÓNDE cae esa hora, no solo que cae dentro', () => {
    /*
     * La prueba de arriba pasaría igual devolviendo siempre 0,5. Esta ata la fracción al
     * reloj: en una ventana que empieza en punto, la marca de las dos horas siguientes
     * tiene que caer justo a un cuarto de una ventana de ocho horas.
     */
    const v = ventana('2026-09-24T13:00:00Z', '2026-09-24T21:00:00Z'); // 08:00–16:00 en Lima
    const marcas = marcasDeHora(v, LIMA, 6);
    const dosHorasDespues = marcas.find((m) => enLima(m.instante) === '10:00');
    expect(dosHorasDespues).toBeDefined();
    expect(dosHorasDespues?.fraccion).toBeCloseTo(0.25, 5);
  });

  it('una jornada larga no se llena de rótulos: el paso se agranda solo', () => {
    // Dieciséis horas con marca cada hora serían dieciséis rótulos encabalgados justo en
    // el día que más falta hace leer.
    const marcas = marcasDeHora(ventana('2026-09-24T10:00:00Z', '2026-09-25T02:00:00Z'), LIMA);
    expect(marcas.length).toBeLessThanOrEqual(6);
    expect(marcas.length).toBeGreaterThanOrEqual(3);
  });

  it('una jornada corta no se queda con una sola marca', () => {
    const marcas = marcasDeHora(ventana('2026-09-24T13:10:00Z', '2026-09-24T17:50:00Z'), LIMA);
    expect(marcas.length).toBeGreaterThanOrEqual(3);
  });

  it('una ventana de duración cero no devuelve marcas en el infinito', () => {
    // Sin la guarda, dividir por cero da Infinity y cada rótulo se pinta fuera de la
    // pantalla. Es el mismo borde que ya tenía `franjaDelDia`.
    expect(marcasDeHora(ventana('2026-09-24T13:00:00Z', '2026-09-24T13:00:00Z'), LIMA)).toEqual([]);
    expect(marcasDeHora(ventana('2026-09-24T14:00:00Z', '2026-09-24T13:00:00Z'), LIMA)).toEqual([]);
  });

  it('un cambio de horario no desiguala la regla: los huecos siguen siendo iguales', () => {
    /*
     * Toronto adelanta el reloj el 8 de marzo de 2026 a las 02:00. Perú no cambia la hora,
     * pero la app se está montando para una segunda empresa en Canadá, que sí.
     *
     * LO QUE SE AFIRMA AQUÍ ES QUE LOS HUECOS SEAN IGUALES, y no que las marcas caigan en
     * punto, porque lo segundo NO PUEDE FALLAR: el salto es de una hora exacta y el paso
     * es múltiplo de sesenta minutos, así que cruzar el cambio deja las marcas en punto
     * igual — solo se salta una. La primera versión de esta prueba afirmaba «:00» y pasaba
     * también con la suma a ciegas, o sea que no probaba nada. Se vio rompiendo el código
     * a propósito para ver si la prueba caía, y no cayó.
     *
     * Sumando el paso a ciegas, en el reloj de la tienda las marcas salen 00, 04, 07, 10…:
     * una regla cuya primera división mide cuatro horas y el resto tres. Eso es lo que
     * hace que una escala mienta, y es lo que esto sí caza.
     */
    const marcas = marcasDeHora(
      ventana('2026-03-08T05:00:00Z', '2026-03-08T20:00:00Z'),
      'America/Toronto',
    );
    const horaLocal = (fecha: Date) =>
      Number(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Toronto',
          hour: '2-digit',
          hour12: false,
        }).format(fecha),
      );
    expect(marcas.length).toBeGreaterThan(2);
    const huecos = marcas
      .slice(1)
      .map((marca, i) => horaLocal(marca.instante) - horaLocal(marcas[i]?.instante ?? marca.instante));
    expect(new Set(huecos).size).toBe(1);
  });
});
