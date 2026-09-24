/**
 * LA FRANJA DEL DÍA: el turno y lo que de verdad se trabajó, sobre una sola escala.
 *
 * POR QUÉ EXISTE. Esta app enseña el tiempo SIEMPRE como número: «80:03 / 132:00» en una
 * barra sin escala, «Lleva 03:05», un «05:30» sin etiqueta debajo de un nombre. Un número
 * se lee; una forma se reconoce de un vistazo, y de un vistazo es como se mira este
 * tablero: entre atender a alguien y contestar el teléfono.
 *
 * Sobre la franja, «entró tarde» no es una resta que haya que hacer mentalmente: es que
 * el relleno empieza más adentro que su carril. «No vino» es un carril vacío. «Se quedó
 * de más» es relleno que sobresale. Lo mismo que hoy exige leer dos horas y restarlas.
 *
 * ESTO ES SOLO LA GEOMETRÍA, a propósito: entra tiempo, sale fracción de 0 a 1. Sin
 * React, sin colores y sin idioma, porque así se puede probar de verdad —los casos que
 * importan son los bordes— y porque la misma cuenta sirve para la franja grande de Inicio
 * y para la mini de una fila.
 *
 * LO QUE NO DIBUJA, Y POR QUÉ. Las pausas. La app guarda cuántos minutos de pausa hubo
 * (`paid_break_minutes`, `unpaid_break_minutes`) pero NO a qué hora fueron: eso vive en
 * `time_events`, que el tablero no carga. Dibujar el descanso en una posición inventada
 * sería exactamente la clase de mentira que este proyecto lleva la semana quitando: una
 * pantalla que parece precisa y no lo es. Cuando haga falta, se cargan los eventos y se
 * dibujan donde estuvieron.
 */
import { inZone } from '@/utils/time';

/** Un tramo de la franja, en fracciones de la ventana: 0 es el principio y 1 el final. */
export type TramoDeFranja = { desde: number; hasta: number };

export type FranjaDelDia = {
  /** El turno programado. `null` si esa persona no tenía turno hoy. */
  plan: TramoDeFranja | null;
  /** Lo que de verdad se fichó. `null` si no llegó a fichar. */
  real: TramoDeFranja | null;
  /** Dónde cae «ahora» en la ventana, o `null` si ahora queda fuera de ella. */
  ahora: number | null;
};

type Intervalo = { desde: Date; hasta: Date | null };

const acotar = (valor: number): number => (valor < 0 ? 0 : valor > 1 ? 1 : valor);

/**
 * Convierte un intervalo en un tramo de la ventana.
 *
 * Devuelve `null` cuando el intervalo no toca la ventana, que NO es lo mismo que un tramo
 * de ancho cero: un turno de ayer no se pinta, y un turno que acaba de empezar sí, aunque
 * hoy mida un pelo.
 *
 * `hasta: null` significa «sigue abierto»: se corta en el final de la ventana. Quien lo
 * lea que sepa que esa línea NO es lo que lo sostiene —poniendo infinito el resultado es
 * el mismo, porque el recorte a [0,1] lo tapa— y está escrita así porque se entiende
 * mejor. Se comprobó rompiéndola.
 */
function tramo(
  intervalo: Intervalo | null,
  desdeLaVentana: number,
  duracionDeLaVentana: number,
): TramoDeFranja | null {
  if (intervalo === null) return null;

  const inicio = intervalo.desde.getTime();
  const fin =
    intervalo.hasta === null ? desdeLaVentana + duracionDeLaVentana : intervalo.hasta.getTime();

  // Un intervalo al revés no se dibuja: no es un tramo de ancho cero, es un dato roto.
  if (fin < inicio) return null;
  // Fuera de la ventana por completo, por cualquiera de los dos lados.
  if (fin < desdeLaVentana || inicio > desdeLaVentana + duracionDeLaVentana) return null;

  return {
    desde: acotar((inicio - desdeLaVentana) / duracionDeLaVentana),
    hasta: acotar((fin - desdeLaVentana) / duracionDeLaVentana),
  };
}

export function franjaDelDia(datos: {
  ventana: { desde: Date; hasta: Date };
  turno: Intervalo | null;
  trabajado: Intervalo | null;
  ahora: Date;
}): FranjaDelDia {
  const desdeLaVentana = datos.ventana.desde.getTime();
  const duracionDeLaVentana = datos.ventana.hasta.getTime() - desdeLaVentana;

  /*
   * UNA VENTANA SIN DURACIÓN NO SE DIVIDE. Pasa de verdad —una sede sin turnos hoy, donde
   * el principio y el final salen del mismo sitio— y sin esta guarda cada fracción sería
   * `Infinity` o `NaN`, que en una barra se pinta como un rectángulo de ancho absurdo o
   * como nada, según el motor. Vacía es la respuesta honesta.
   */
  if (duracionDeLaVentana <= 0) return { plan: null, real: null, ahora: null };

  const ahoraEnLaVentana = (datos.ahora.getTime() - desdeLaVentana) / duracionDeLaVentana;

  return {
    plan: tramo(datos.turno, desdeLaVentana, duracionDeLaVentana),
    real: tramo(datos.trabajado, desdeLaVentana, duracionDeLaVentana),
    ahora: ahoraEnLaVentana < 0 || ahoraEnLaVentana > 1 ? null : ahoraEnLaVentana,
  };
}

/**
 * La ventana que encuadra el día: desde lo más temprano hasta lo más tarde de lo que haya
 * que enseñar, con un margen para que nada quede pegado al borde.
 *
 * NO ES «DE 00:00 A 24:00», y esa fue la primera idea. Una tienda que abre de 8 a 18
 * gastaría dos tercios de la franja en horas en las que no pasa nada, y los turnos
 * quedarían comprimidos justo en la parte que importa. La ventana se ajusta a la jornada
 * real.
 */
export function ventanaDelDia(
  intervalos: readonly Intervalo[],
  ahora: Date,
  margenMinutos = 30,
): { desde: Date; hasta: Date } | null {
  const inicios = intervalos.map((i) => i.desde.getTime());
  const finales = intervalos.map((i) => (i.hasta === null ? ahora.getTime() : i.hasta.getTime()));
  if (inicios.length === 0) return null;

  const margen = margenMinutos * 60_000;
  return {
    desde: new Date(Math.min(...inicios) - margen),
    hasta: new Date(Math.max(...finales) + margen),
  };
}

/**
 * LAS MARCAS DE HORA DE LA FRANJA: dónde cae cada hora redonda, en fracciones.
 *
 * ESTO FALTABA, Y ERA EL AGUJERO GRANDE DE LA FRANJA. La franja codifica la hora del día
 * como posición horizontal —es lo único que hace— y no había nada en pantalla que dijera
 * qué hora es cada posición. Se veía que Ana empezó más tarde que Julio, pero no a qué
 * hora empezó ninguno de los dos, ni si el hueco de la derecha era media hora o cuatro.
 * Un gráfico cuyo eje no está rotulado enseña la forma y esconde el dato.
 *
 * Y no se veía mirando, porque la pantalla se lee como si tuviera sentido: las barras
 * están donde tienen que estar. Salió midiendo la posición de cada barra contra la hora
 * que la fila escribe debajo del nombre. Cuadran —00:38 cae en 0,032, 09:00 en 0,577— y
 * de ahí se deduce que la ventana iba de las 00:08 a las 15:30. Que sea deducible a base
 * de despejar es exactamente la razón por la que tiene que estar escrito.
 *
 * LAS HORAS SON REDONDAS EN LA ZONA DE LA TIENDA, no en UTC. Un rótulo a las «09:37» no
 * es una referencia: lo que sirve de regla es la hora en punto, y «en punto» solo
 * significa algo en el reloj que mira quien atiende la tienda.
 *
 * EL PASO SE ELIGE SOLO. Con una ventana de cuatro horas, marcas cada hora; con una de
 * dieciséis, cada tres. Fijar el paso llenaría de rótulos encabalgados las jornadas
 * largas —que son justo las que más falta hace leer— o dejaría dos marcas en las cortas.
 *
 * Y SE REENCAJA EN CADA PASO en vez de sumar el intervalo a ciegas: sumar 3 h sobre un
 * cambio de horario deja las marcas a y media el resto del día. Perú no cambia la hora,
 * pero la app ya se está montando para una segunda empresa en Canadá, que sí.
 */
export function marcasDeHora(
  ventana: { desde: Date; hasta: Date },
  zona: string,
  maximo = 6,
): { fraccion: number; instante: Date }[] {
  const total = ventana.hasta.getTime() - ventana.desde.getTime();
  // Una ventana de duración cero dividiría por cero y devolvería marcas en el infinito.
  if (!(total > 0) || maximo < 1) return [];

  const minutos = total / 60_000;
  const paso =
    PASOS_DE_MARCA.find((candidato) => minutos / candidato <= maximo) ??
    PASOS_DE_MARCA[PASOS_DE_MARCA.length - 1] ??
    60;

  const marcas: { fraccion: number; instante: Date }[] = [];
  let instante = encajarEnPaso(ventana.desde, zona, paso);
  if (instante < ventana.desde.getTime()) instante += paso * 60_000;
  instante = encajarEnPaso(new Date(instante), zona, paso);
  if (instante < ventana.desde.getTime()) instante += paso * 60_000;

  // El tope es una red, no la regla: con `maximo` ≤ 6 nunca se llega. Está para que un
  // paso mal encajado no pueda colgar la pantalla en un bucle infinito.
  while (instante <= ventana.hasta.getTime() && marcas.length < 32) {
    marcas.push({ fraccion: (instante - ventana.desde.getTime()) / total, instante: new Date(instante) });
    const siguiente = encajarEnPaso(new Date(instante + paso * 60_000), zona, paso);
    instante = siguiente > instante ? siguiente : instante + paso * 60_000;
  }
  return marcas;
}

/**
 * Los pasos posibles, en minutos. Todos son múltiplos de 60 a propósito: una marca a las
 * «09:30» no funciona como regla, porque lo que el ojo busca es la hora en punto.
 */
const PASOS_DE_MARCA = [60, 120, 180, 240, 360, 720] as const;

/** El múltiplo de `paso` anterior o igual, contado desde la medianoche de la tienda. */
function encajarEnPaso(instante: Date, zona: string, paso: number): number {
  const local = inZone(instante, zona);
  const desdeMedianoche = local.getHours() * 60 + local.getMinutes();
  const sobra =
    (desdeMedianoche % paso) * 60_000 + local.getSeconds() * 1_000 + local.getMilliseconds();
  return instante.getTime() - sobra;
}
