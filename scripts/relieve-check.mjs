#!/usr/bin/env node
/**
 * ¿SE VE DÓNDE ACABA UNA FILA Y EMPIEZA LA SIGUIENTE?
 *
 * POR QUÉ EXISTE. Andree, mirando la app publicada: «el que separa a Ana y Joseph no se
 * ve y es como que no están separados». Al medirlo salieron DOS fallos distintos, y el
 * primero no era de contraste:
 *
 *   1. Equipo NO TENÍA SEPARADOR. La lista no pasaba `ItemSeparatorComponent`, así que
 *      entre fila y fila no había ningún elemento: bloques blancos de 73 px pegados sobre
 *      fondo blanco. Y el comentario del código AFIRMABA que sí lo tenía.
 *   2. Donde sí lo había —Horas, Inicio— la regla estaba a 1,27:1 contra la fila en claro
 *      y 1,32:1 en oscuro. Una línea de 1 px a 1,27:1 no es tenue: a distancia de lectura
 *      no está.
 *
 * NINGUNA PRUEBA PODÍA VERLO. Las de unidad montan los componentes y comprueban que la
 * lista pinta las filas, y las pinta. `contraste:check` mide TEXTOS, y una regla no es
 * texto. El fallo vivía justo en el hueco entre las dos, que es donde vive siempre en este
 * proyecto.
 *
 * QUÉ AFIRMA, y por qué así:
 *
 *   · Que entre dos filas consecutivas haya un elemento separador. Esto es lo que habría
 *     cazado el caso de Equipo, donde el problema no era el color sino la ausencia.
 *   · Que su contraste contra la superficie de la fila llegue al suelo. NO se mide contra
 *     un valor exacto: un tono se afina, y una prueba que exija «exactamente #B8B6BC»
 *     falla al afinarlo sin que nada esté mal.
 *   · Que la regla de la CABECERA pese más que las de entre filas. Es lo que distingue un
 *     libro de registro de una rejilla: la raya que separa dos cosas distintas no puede
 *     pesar lo mismo que la que separa dos iguales.
 *
 * En los dos temas y a dos anchos, porque el teléfono es donde esto va a acabar.
 *
 * USO
 *   npm run demo:export
 *   node scripts/relieve-check.mjs dist-demo
 */
import { cargarPlaywright, entrarComoDemo, irA, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8219;

/** Suelo de contraste de una regla contra su fila. Ver el token `regla` en `tokens.ts`. */
const SUELO_REGLA = 1.8;
/** La de la cabecera separa dos cosas distintas, así que pesa más. */
const SUELO_CABECERA = 2.6;

/**
 * Cuánto tiene que cambiar una fila al ponerle el puntero encima para que se note.
 *
 * Es un cociente de luminancia y no un contraste de 3:1, y eso es deliberado: aquí no se
 * está leyendo nada sobre ese fondo, se está notando que ALGO cambió. Un realce a 3:1
 * sería un bloque de color oscuro debajo del texto. 1,05 es el suelo por debajo del cual
 * el cambio deja de percibirse en una pantalla normal; el que hay puesto llega a 1,10.
 */
const SUELO_REALCE = 1.05;

/**
 * Cuándo se considera que una tarjeta se lee como un plano aparte.
 *
 * SON DOS CAMINOS Y VALE CUALQUIERA, porque la elevación se dice distinta en cada tema y
 * eso no es un capricho: en claro la lleva la SOMBRA, y en oscuro una sombra negra sobre
 * un fondo casi negro no existe, así que la lleva el COLOR de la superficie. Exigir sombra
 * en los dos sería exigir algo imposible en uno; exigir color en los dos convertiría el
 * tema claro en una escala de grises de tarjetas.
 */
const SOMBRA_MINIMA = 0.08;
const SALTO_DE_PLANO_MINIMO = 1.15;

/*
 * EL SELECTOR DE FILA EXCLUYE EL CONTENEDOR DE LA LISTA A PROPÓSITO.
 *
 * La primera versión usaba `[data-testid^="team-member-"]`, que casa TAMBIÉN con
 * `team-member-list`: la lista entera. O sea que el arnés medía el contraste y el realce
 * de la lista, no de una fila, y llegó a decir que Equipo no responde al puntero cuando lo
 * que pasaba es que estaba poniendo el puntero encima de otra cosa.
 *
 * Es la trampa de los `testID` con prefijo común, y la lección es que un selector también
 * es código que puede estar mal: cuando una medida dice algo raro, lo primero que hay que
 * dudar es de la medida.
 */
const PANTALLAS = [
  {
    ruta: '/team',
    nombre: 'Equipo',
    fila: '[data-testid^="team-member-"]:not([data-testid="team-member-list"])',
    cabecera: true,
  },
  {
    ruta: '/hours',
    nombre: 'Horas',
    fila: '[data-testid^="session-"]:not([data-testid$="-list"])',
    cabecera: true,
  },
];

/** Cociente de luminancia entre dos colores `rgb(...)`. Uno, si alguno no se pudo leer. */
function cociente(unColor, otroColor) {
  if (unColor === null || otroColor === null) return 1;
  const canal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (texto) => {
    const [r, g, b] = (texto.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'])
      .slice(0, 3)
      .map((n) => canal(Number(n) / 255));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [alto, bajo] = [lum(unColor), lum(otroColor)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};

const { base, cerrar } = await servirExport(RAIZ, PUERTO);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

/**
 * La medida se hace EN EL NAVEGADOR y no sobre los tokens, a propósito. Un token correcto
 * y un componente que no lo usa dan verde si se miran los tokens; lo que importa es el
 * píxel que sale, que es lo que mira una persona.
 */
const MEDIR = (selector) => `(() => {
  const srgb = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const parse = (s) => (s.match(/\\d+(\\.\\d+)?/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
  const ct = (a, b) => { const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // El color que se VE detrás de un elemento, subiendo hasta el primer antepasado opaco.
  /*
   * EMPIEZA EN EL PADRE, no en el propio elemento, y esa es la diferencia entre medir algo
   * y medir nada: un separador TIENE fondo —es todo lo que es—, así que arrancando en él
   * se comparaba consigo mismo y daba 1:1 siempre. Salió a la primera ejecución, con las
   * ocho cabeceras «fallando» a 1:1 exacto, que es un número demasiado redondo para ser
   * un color mal elegido.
   */
  const fondoDe = (n) => { let e = n?.parentElement; while (e) { const b = getComputedStyle(e).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && !b.endsWith(', 0)')) return b; e = e.parentElement; } return 'rgb(255, 255, 255)'; };

  const filas = [...document.querySelectorAll('${selector}')];
  if (filas.length < 2) return { filas: filas.length, error: 'menos de dos filas: no hay nada que separar' };

  // El envoltorio de cada fila dentro del contenedor de la lista.
  const envoltorio = (f) => { let n = f; while (n && n.parentElement && ![...n.parentElement.children].includes(filas[1]?.closest('*'))) { if (n.parentElement.children.length > 2) return n; n = n.parentElement; } return n; };
  const e0 = envoltorio(filas[0]);
  const cont = e0.parentElement;
  const hijos = [...cont.children];
  const iPrimera = hijos.findIndex((h) => h.contains(filas[0]));
  const iSegunda = hijos.findIndex((h) => h.contains(filas[1]));

  const entre = hijos.slice(iPrimera + 1, iSegunda);
  const sep = entre.find((h) => { const r = h.getBoundingClientRect(); return r.height > 0 && r.height <= 3; })
    ?? [...cont.querySelectorAll('[data-testid="separador-de-registro"]')][0] ?? null;

  const cab = document.querySelector('[data-testid="separador-de-cabecera"]');
  /*
   * LA REFERENCIA ES LA SUPERFICIE DE LA FILA, no lo que haya detrás de la tira de 1 px.
   *
   * Primera versión: se medía contra el fondo que quedaba DEBAJO del separador, que es el
   * lienzo de la página, porque la lista en sí es transparente. Daba 1,88:1 en vez de
   * 2,01:1 — cerca, así que pasaba, y por la razón equivocada. Lo que el ojo compara es la
   * raya contra el BLANCO de la fila de arriba y la de abajo, no contra un lienzo que en
   * ese punto no se ve. Con listas sobre un lienzo más oscuro la diferencia dejaría de ser
   * de 0,13 y la comprobación aprobaría una raya invisible.
   */
  const superficieDe = (f) => { const pintado = [...f.querySelectorAll('*')].find((d) => { const b = getComputedStyle(d).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' && !b.endsWith(', 0)'); }); return pintado ? getComputedStyle(pintado).backgroundColor : fondoDe(f); };
  const filaFondo = superficieDe(filas[0]);
  return {
    filas: filas.length,
    hayRegla: sep !== null,
    reglaColor: sep ? getComputedStyle(sep).backgroundColor : null,
    reglaAlto: sep ? +sep.getBoundingClientRect().height.toFixed(2) : null,
    reglaContraste: sep ? +ct(getComputedStyle(sep).backgroundColor, filaFondo).toFixed(2) : null,
    hayCabecera: cab !== null,
    cabeceraColor: cab ? getComputedStyle(cab).backgroundColor : null,
    cabeceraFondo: cab ? filaFondo : null,
    cabeceraContraste: cab ? +ct(getComputedStyle(cab).backgroundColor, filaFondo).toFixed(2) : null,
    filaFondo,
  };
})()`;

for (const tema of ['light', 'dark']) {
  for (const ancho of [1280, 390]) {
    const contexto = await navegador.newContext({
      viewport: { width: ancho, height: 1100 },
      colorScheme: tema,
    });
    const pagina = await contexto.newPage();
    await entrarComoDemo(pagina, base);

    for (const pantalla of PANTALLAS) {
      await irA(pagina, base, pantalla.ruta);
      await pagina.waitForTimeout(900);
      const m = await pagina.evaluate(MEDIR(pantalla.fila));
      const donde = `${pantalla.nombre} ${tema} ${ancho}px`;

      if (m.error !== undefined) {
        fallar(donde, m.error);
        continue;
      }
      if (!m.hayRegla) {
        fallar(
          donde,
          `${m.filas} filas y NINGÚN separador entre ellas. No es que no se vea: no está. ` +
            'Es el caso exacto de Equipo el 2026-09-24.',
        );
      } else if (m.reglaContraste < SUELO_REGLA) {
        fallar(
          donde,
          `la regla está a ${m.reglaContraste}:1 contra la fila (${m.reglaColor} sobre ` +
            `${m.filaFondo}), por debajo del suelo de ${SUELO_REGLA}. A distancia de ` +
            'lectura una línea de 1 px así no se ve.',
        );
      } else {
        console.log(
          `ok     ${donde.padEnd(24)} regla ${m.reglaContraste}:1  ${m.reglaAlto}px  ${m.filas} filas`,
        );
      }

      /*
       * EL REALCE AL PASAR EL PUNTERO. Se mide MOVIENDO EL PUNTERO DE VERDAD y leyendo el
       * color que queda, no comprobando que el componente declare un estilo de hover: un
       * estilo declarado y puesto en el elemento equivocado —el padre, tapado por el hijo
       * que lleva el fondo— da verde leyendo el código y no pinta nada en la pantalla.
       * Es el mismo fallo de campo muerto que este proyecto lleva encontrando seis veces.
       */
      const filaSel = pantalla.fila;
      /*
       * EL SELECTOR VIAJA COMO ARGUMENTO, no pegado dentro de la cadena. Lleva comillas
       * dobles —`[data-testid^="…"]`— así que interpolarlo en un literal entre comillas
       * simples lo parte por la mitad y el `querySelector` deja de encontrar nada.
       *
       * Y EL COCIENTE SE CALCULA AQUÍ, EN NODE, y no dentro de la página: la primera
       * versión lo calculaba dentro con el color de antes interpolado, y devolvía 1 exacto
       * incluso cuando el color SÍ cambiaba, que se veía en el propio mensaje de error.
       * Aritmética fuera del sitio donde hay que interpolar cadenas: un fallo menos posible.
       */
      const fondoDeFila = (sel) =>
        pagina.evaluate((s) => {
          const f = document.querySelector(s);
          if (f === null) return null;
          const d =
            [...f.querySelectorAll('*')].find((e) => {
              const b = getComputedStyle(e).backgroundColor;
              return b && b !== 'rgba(0, 0, 0, 0)';
            }) ?? f;
          return getComputedStyle(d).backgroundColor;
        }, sel);

      const antes = await fondoDeFila(filaSel);
      await pagina.locator(filaSel).first().hover();
      await pagina.waitForTimeout(160);
      const despues = await fondoDeFila(filaSel);
      const cambio = cociente(antes, despues);

      if (cambio < SUELO_REALCE) {
        fallar(
          donde,
          `al poner el puntero sobre una fila el fondo pasa de ${antes} a ${despues}: ` +
            `un cambio de ${cambio.toFixed(3)} sobre un suelo de ${SUELO_REALCE}. Una fila ` +
            'que no responde al puntero se lee como texto, no como un control.',
        );
      } else {
        console.log(
          `ok     ${donde.padEnd(24)} puntero ${antes} -> ${despues} (${cambio.toFixed(3)})`,
        );
      }
      await pagina.mouse.move(0, 0);

      if (pantalla.cabecera) {
        if (!m.hayCabecera) {
          fallar(
            donde,
            'no hay regla bajo los rótulos de columna: la cabecera se lee como una fila más.',
          );
        } else if (m.cabeceraContraste < SUELO_CABECERA) {
          fallar(
            donde,
            `la regla de cabecera está a ${m.cabeceraContraste}:1, por debajo de ` +
              `${SUELO_CABECERA}: pesa lo mismo que las de entre filas y deja de decir que ` +
              'ahí cambia lo que se está mirando.',
          );
        } else {
          console.log(
            `ok     ${donde.padEnd(24)} cabecera ${m.cabeceraContraste}:1  ${m.cabeceraColor} sobre ${m.cabeceraFondo}`,
          );
        }
      }
    }
    /*
     * LA ELEVACIÓN DE UNA TARJETA. Se mide en Inicio, que es donde hay tarjetas de verdad.
     * Antes de esto la sombra era negro al 4% en LOS DOS temas: en claro casi nada y en
     * oscuro literalmente nada. El proyecto ya tenía escrito que «en claro la elevación es
     * sombra y en oscuro tiene que ser color», y no estaba hecho.
     */
    {
      /*
       * SE REUSA LA MISMA PÁGINA y se vuelve a Inicio, en vez de abrir una segunda pestaña:
       * `entrarComoDemo` hace el camino de entrada completo, y en una pestaña nueva del
       * mismo contexto la sesión ya existe, así que se queda esperando una pantalla de
       * entrada que no va a volver a salir. Se vio con un timeout de 30 s.
       */
      await irA(pagina, base, '/');
      await pagina.waitForTimeout(900);
      const plano = await pagina.evaluate(() => {
        const conSombra = [...document.querySelectorAll('*')].filter((d) => {
          const s = getComputedStyle(d).boxShadow;
          return s && s !== 'none';
        });
        if (conSombra.length === 0) return null;
        const tarjeta = conSombra[0];
        const sombra = getComputedStyle(tarjeta).boxShadow;
        const alfa = Number(/rgba?\([^)]*?,\s*([\d.]+)\)/.exec(sombra)?.[1] ?? '1');
        const fondoDetras = (() => {
          let e = tarjeta.parentElement;
          while (e) {
            const b = getComputedStyle(e).backgroundColor;
            if (b && b !== 'rgba(0, 0, 0, 0)') return b;
            e = e.parentElement;
          }
          return 'rgb(255, 255, 255)';
        })();
        return {
          tarjetas: conSombra.length,
          sombra,
          alfa,
          bg: getComputedStyle(tarjeta).backgroundColor,
          fondoDetras,
        };
      });
      const donde = `Inicio ${tema} ${ancho}px`;
      if (plano === null) {
        fallar(
          donde,
          'ninguna tarjeta tiene elevación: no hay un solo plano levantado en la pantalla.',
        );
      } else {
        const salto = cociente(plano.bg, plano.fondoDetras);
        /*
         * LA SOMBRA SOLO CUENTA EN CLARO, y esto lo corrigió el propio arnés: con un «vale
         * cualquiera de los dos» el tema OSCURO pasaba por tener una sombra negra al 10%,
         * que sobre un fondo casi negro es exactamente nada. O sea que la comprobación
         * aprobaba justo el defecto que existe para cazar.
         */
        const seLevanta =
          tema === 'light' ? plano.alfa >= SOMBRA_MINIMA : salto >= SALTO_DE_PLANO_MINIMO;
        if (!seLevanta) {
          fallar(
            donde,
            tema === 'light'
              ? `la tarjeta no se levanta: sombra al ${plano.alfa}, por debajo de ` +
                  `${SOMBRA_MINIMA}. En claro la elevación la lleva la sombra.`
              : `la tarjeta no se levanta: su superficie ${plano.bg} está a ` +
                  `${salto.toFixed(3)} de ${plano.fondoDetras}, por debajo de ` +
                  `${SALTO_DE_PLANO_MINIMO}. En oscuro una sombra negra sobre fondo casi ` +
                  'negro no existe, así que la elevación tiene que ser COLOR.',
          );
        } else {
          console.log(
            `ok     ${donde.padEnd(24)} plano: sombra ${plano.alfa}, salto ${salto.toFixed(3)} (${plano.tarjetas} tarjetas)`,
          );
        }
      }
    }

    await contexto.close();
  }
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.log(`\nFALLA la comprobación de relieve (${problemas.length}):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK: las filas se separan de verdad, y la cabecera pesa más que un renglón.');
