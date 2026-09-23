import { franjaDelDia, ventanaDelDia } from '@/domain/franja-del-dia';

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
