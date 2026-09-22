/**
 * ¿Cabe todo, y se lee todo, en las pantallas donde de verdad se usa esto?
 *
 * POR QUÉ EXISTE
 * Había DIECIOCHO fallos de ancho en el panel y ningún chequeo los veía. No eran
 * sutiles: en un portátil de 1280 px el horario mostraba «03:00 – 09:…» y el domingo no
 * aparecía; en un teléfono de 320 px la barra de pestañas decía «Hora…» justo al lado de
 * «Horas», que es otro destino distinto. Llevaban meses así.
 *
 * Lo que fallaba no era el cuidado, era el método: mirar pantallas encuentra lo que
 * revienta y se le escapa lo que cabe por dos píxeles. Un texto recortado por 2 px se lee
 * como «casi bien» y nadie lo reporta, así que nadie lo arregla. Esto no mira: le pregunta
 * al navegador la coordenada de cada elemento y la compara con el borde de la ventana.
 *
 * LAS CUATRO COSAS QUE MIDE, y por qué cada una hace falta
 *
 *   1. ELEMENTOS FUERA DE LA VENTANA. Lo obvio, con un cuidado: si un padre ya se sale,
 *      sus veinte hijos también, y reportarlos todos esconde el único que importa. Solo
 *      se reporta el más externo.
 *
 *   2. TEXTOS RECORTADOS (`scrollWidth > clientWidth`). El fallo característico y el más
 *      invisible: el texto no desborda —está recortado a propósito por el navegador— así
 *      que la pantalla se pinta perfecta y el dato no está. Así se perdía la hora de
 *      salida de los turnos.
 *
 *   3. OBJETIVOS TÁCTILES POR DEBAJO DE 44×44. El mínimo que esta app ya se exige en el
 *      kiosco (§25) y que en el panel no se aplicaba: los siete destinos de la barra
 *      lateral median 30 px de alto, en un panel que se usa en un iPad.
 *
 *   4. CONTENEDORES QUE SCROLLEAN EN HORIZONTAL POR DENTRO. Este es el que hace falta de
 *      verdad. `react-native-web` mete casi todo en scrollers, así que un desborde interno
 *      NO mueve el `scrollWidth` del documento: una medida ingenua del documento da «todo
 *      bien» mientras dos tercios de la plantilla están fuera de vista. El filtro de Horas
 *      tenía 834 px de contenido en 288 visibles y ninguna señal de continuar.
 *
 * LOS DOS ENGAÑOS QUE ME COMÍ ESCRIBIÉNDOLO, y por eso hay guardas
 *
 *   - SEMBRAR EL KIOSCO REDIRIGE TODA RUTA A /kiosk. Mi primera pasada midió el reloj de
 *     fichaje 84 veces creyendo que medía el panel, y salió «todo bien»... porque el reloj
 *     está bien. Un arnés que mide la pantalla equivocada no es un arnés flojo, es peor que
 *     ninguno: da permiso para no mirar.
 *   - SIN SESIÓN, TODA RUTA CAE EN EL ACCESO. El mismo engaño con otro disfraz, y también
 *     salía verde.
 *
 * Por eso cada pantalla trae un MARCADOR: un texto que solo aparece en ella. Si no está,
 * esto falla como error y no mide. Medir la pantalla equivocada tiene que ser imposible,
 * no improbable.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/responsive-check.mjs dist-demo
 */
import { servirExport, cargarPlaywright } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/responsive-check.mjs <export-demo>');
  process.exit(2);
}

/**
 * Los anchos, y por qué estos y no una lista de móviles de moda.
 *
 * Cada uno está en un tramo distinto de decisión del layout, que es lo que importa: dentro
 * de un tramo los hallazgos se repiten, y entre tramos cambian. Se sacaron midiendo doce
 * anchos y quedándose con los que aportaban algo distinto.
 *
 * 360 es el MÍNIMO SOPORTADO del panel. 320 —un iPhone SE de 2016— queda fuera a propósito
 * y está dicho en voz alta en la tarea iAEDziGr2SkVAxAAYXpZ: el reloj de fichaje sí cabe
 * en 320 y eso lo comprueba `kiosco:check`, pero el panel de administración no se diseña
 * para un teléfono descatalogado.
 *
 * 414 está aquí por un motivo concreto: es donde el layout de Reportes cambia a dos
 * columnas y empieza a recortar MÁS que a 390. Un ancho mayor que muestra menos.
 */
const ANCHOS = [
  ['teléfono mínimo', 360, 640],
  ['teléfono normal', 390, 844],
  ['teléfono grande', 414, 896],
  ['iPad vertical', 768, 1024],
  ['iPad horizontal', 1024, 768],
  ['portátil', 1280, 800],
  ['monitor', 1920, 1080],
];

/**
 * Las pantallas, con el marcador que prueba que se cargó la que toca.
 *
 * El marcador no es el título: los títulos salen también en la barra de navegación, que
 * está en todas las pantallas, así que buscar «Horario» no distingue nada. Es un texto del
 * CUERPO de cada pantalla.
 */
const PANTALLAS = [
  ['acceso', '/', 'Para administradores y gerentes'],
  ['inicio', '/', 'Para que lo sepas'],
  ['equipo', '/team', 'Agregar empleado'],
  ['horario', '/schedule', 'Copiar semana anterior'],
  ['horas', '/hours', 'Ir a esta semana'],
  ['reportes', '/reports', 'Mide presencia, no trabajo hecho'],
  ['solicitudes', '/requests', 'Correcciones de hora'],
  ['ajustes', '/settings', 'Cambia el idioma de esta app'],
];

/** Textos que, si aparecen tras entrar, significan que se está midiendo otra pantalla. */
const INTRUSOS = [
  ['la pantalla de acceso', 'Ingresa a Krealo Shift'],
  ['el reloj de fichaje', 'Ingresa tu PIN personal'],
];

/** §25: por debajo de esto un botón deja de ser un objetivo táctil usable. */
const MINIMO_TACTIL = 44;

/**
 * DEUDA CONOCIDA, nombrada para que este arnés siga sirviendo mientras se arregla.
 *
 * Cada entrada es un fallo MEDIDO que ya tiene tarea y dueño. Se excusa por su firma
 * exacta —pantalla y qué es— y NUNCA bajando el umbral: bajar el umbral deja un arnés que
 * dice OK sin comprobar nada, y la deuda deja de existir para quien lee la salida.
 *
 * Al arreglar una, se borra su línea de aquí. Si el arreglo no fue completo, esto vuelve a
 * ponerse rojo, que es justo lo que se quiere.
 */
const DEUDA = new Map([
  ['horario/recorte/03:00 – 09:00', 'la hora de fin del turno se corta (loXyMQ1IxbuPHHDlhtl9)'],
  ['horario/recorte/09:00 – 15:00', 'la hora de fin del turno se corta (loXyMQ1IxbuPHHDlhtl9)'],
  ['horario/scroller', 'la rejilla de la semana no cabe (gVCcKDjUCURro5u1FbNV)'],
  ['horario/fuera', 'la rejilla de la semana no cabe (gVCcKDjUCURro5u1FbNV)'],
  ['horas/scroller', 'el filtro de empleados es un carrusel (nhK2Ojc2qu0qqy2uRefc)'],
  ['horas/fuera', 'el filtro de empleados es un carrusel (nhK2Ojc2qu0qqy2uRefc)'],
  ['horas/tactil/Ele', 'el chip del filtro corta el nombre (jAxDGi0czdJvd1R3YhGA)'],
  [
    'reportes/tactil/testid:day-column-',
    'las columnas de día son focalizables y estrechas (zMeTpeHUPyTpTqcKK0gz)',
  ],
  ['reportes/recorte/Bruno Salazar Nieto', 'el ranking corta los nombres (Q7N1ruDziEsMRMrzi15S)'],
  ['reportes/recorte/Diego Paredes Vega', 'el ranking corta los nombres (Q7N1ruDziEsMRMrzi15S)'],
  ['reportes/recorte/Héctor Ramírez Pinto', 'el ranking corta los nombres (Q7N1ruDziEsMRMrzi15S)'],
  [
    'reportes/recorte/44% del total · 2 pausas',
    'el ranking corta el subtítulo (Q7N1ruDziEsMRMrzi15S)',
  ],
  [
    'reportes/recorte/25% del total · 2 pausas',
    'el ranking corta el subtítulo (Q7N1ruDziEsMRMrzi15S)',
  ],
  ['reportes/recorte/dom 27', 'las etiquetas de día se cortan (GiIhApo06ZGnVZdcZ2st)'],
  ['reportes/recorte/mar 22', 'las etiquetas de día se cortan (GiIhApo06ZGnVZdcZ2st)'],
  ['reportes/recorte/mié 23', 'las etiquetas de día se cortan (GiIhApo06ZGnVZdcZ2st)'],
  ['reportes/recorte/sáb 26', 'las etiquetas de día se cortan (GiIhApo06ZGnVZdcZ2st)'],
]);

/**
 * La medida, dentro del navegador.
 *
 * Todo el criterio vive aquí y no en Node: lo que decide si algo cabe es la caja que el
 * navegador pintó, y eso solo se sabe preguntándoselo a él.
 */
const MEDIR = (minimoTactil) => {
  const vw = window.innerWidth;

  /*
   * EL TEXTO DE UN BOTÓN CON ICONO NO ES EL TEXTO QUE SE VE, y esto me costó una hora.
   *
   * Los iconos son un tipo de letra (`Ionicons`), así que cada glifo es un CARÁCTER real
   * en el `textContent`, del área de uso privado de Unicode. El destino «Inicio» de la
   * barra lateral no dice «Inicio»: dice «\uF383\uF383Inicio». Son invisibles en una
   * terminal, así que el arnés imprimía «Inicio» y a la vez no encontraba «Inicio» en su
   * tabla de deuda conocida —y reportaba 42 fallos ya conocidos como si fueran nuevos—.
   *
   * Un arnés que dice una cosa y compara otra es peor que uno que falla: se pierde la
   * confianza en la salida, que es lo único que tiene.
   */
  const limpiar = (t) =>
    t
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const fuera = [];
  const recortes = [];
  const tactiles = [];
  const scrollers = [];
  let medidos = 0;

  const visible = (el, r) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return r.width > 0 && r.height > 0;
  };

  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    medidos += 1;
    const texto = limpiar(el.textContent || '').slice(0, 60);

    // 1. Fuera de la ventana. Solo el más externo: si el padre ya se sale, el hijo es
    // consecuencia y reportarlo esconde la causa.
    if (r.right > vw + 1 || r.left < -1) {
      const p = el.parentElement;
      const pr = p === null ? null : p.getBoundingClientRect();
      const padreYaSale = pr !== null && (pr.right > vw + 1 || pr.left < -1);
      if (!padreYaSale) {
        fuera.push({ texto, derecha: Math.round(r.right), ancho: Math.round(r.width) });
      }
    }

    // 2. Texto recortado. Solo en hojas: un contenedor con scroll no es un texto cortado.
    if (el.children.length === 0 && texto.length > 0) {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        recortes.push({ texto, visible: el.clientWidth, necesario: el.scrollWidth });
      }
    }

    // 3. Objetivo táctil. Se ignora si un ancestro pulsable ya es bastante grande: el área
    // que recibe el dedo es la del ancestro, no la del icono de dentro.
    const rol = el.getAttribute('role');
    const pulsable =
      rol === 'button' ||
      rol === 'tab' ||
      rol === 'link' ||
      rol === 'switch' ||
      el.tagName === 'BUTTON' ||
      el.tagName === 'A' ||
      el.getAttribute('tabindex') === '0';
    if (pulsable && (r.height < minimoTactil || r.width < minimoTactil)) {
      const anc =
        el.parentElement === null
          ? null
          : el.parentElement.closest('[role="button"],[role="tab"],[role="link"],button,a');
      const ar = anc === null ? null : anc.getBoundingClientRect();
      const ancestroGrande = ar !== null && ar.height >= minimoTactil && ar.width >= minimoTactil;
      if (!ancestroGrande) {
        tactiles.push({
          texto,
          testid: el.getAttribute('data-testid'),
          ancho: Math.round(r.width),
          alto: Math.round(r.height),
        });
      }
    }

    // 4. Scroller horizontal interno. El que se escapa de cualquier medida del documento.
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 40 && el.children.length > 0) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' || cs.overflowX === 'scroll' || cs.overflowX === 'auto') {
        scrollers.push({
          texto,
          overflowX: cs.overflowX,
          visible: el.clientWidth,
          contenido: el.scrollWidth,
        });
      }
    }
  }

  return { fuera, recortes, tactiles, scrollers, medidos, vw };
};

const { base, cerrar } = await servirExport(DIR, 8260);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

const problemas = [];
const deudaVista = new Set();

/** ¿Está esto excusado como deuda conocida? Devuelve el motivo o `undefined`. */
const excusa = (pantalla, clase, detalle, testid) => {
  const exacta = DEUDA.get(`${pantalla}/${clase}/${detalle}`);
  if (exacta !== undefined) return exacta;
  // `*` excusa en cualquier pantalla: lo que está en la barra de navegación sale en todas.
  const cualquierPantalla = DEUDA.get(`*/${clase}/${detalle}`);
  if (cualquierPantalla !== undefined) return cualquierPantalla;
  // Un grupo entero, por prefijo de testid. Las siete columnas de día son el mismo fallo,
  // y seis no tienen texto con el que nombrarlas; la séptima sí, y se escapaba.
  if (typeof testid === 'string') {
    for (const [clave, motivo] of DEUDA) {
      const prefijo = `${pantalla}/${clase}/testid:`;
      if (clave.startsWith(prefijo) && testid.startsWith(clave.slice(prefijo.length))) {
        return motivo;
      }
    }
  }
  // Y por clase entera, para lo que desborda en bloque: una rejilla que no cabe se
  // reporta una vez, no una por celda.
  const porClase = DEUDA.get(`${pantalla}/${clase}`);
  if (porClase !== undefined) return porClase;
  return undefined;
};

for (const [nombreAncho, ancho, alto] of ANCHOS) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const pagina = await ctx.newPage();
  let entrado = false;

  for (const [pantalla, ruta, marcador] of PANTALLAS) {
    // El acceso se mide ANTES de entrar; el resto, después. Es la única pantalla que ve
    // alguien sin sesión, así que un recorte ahí es el peor sitio posible —y de hecho es
    // donde vive el enlace para montar el reloj de fichaje—.
    if (pantalla !== 'acceso' && !entrado) {
      await pagina.locator('[data-testid="sign-in-demo"]').click();
      await pagina.waitForTimeout(3000);
      entrado = true;
    }

    await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(2000);

    const texto = ((await pagina.evaluate(() => document.body.innerText)) || '').replace(
      /\s+/g,
      ' ',
    );

    // LA GUARDA. Sin esto el arnés puede medir siete veces la misma pantalla y decir que
    // todo está bien, que es exactamente lo que me pasó dos veces al escribirlo.
    if (!texto.includes(marcador)) {
      let culpa = 'no se sabe qué se cargó';
      for (const [quien, huella] of INTRUSOS) {
        if (texto.includes(huella)) culpa = `se cargó ${quien}`;
      }
      problemas.push(
        `${nombreAncho}, ${pantalla}: no se cargó esa pantalla (falta «${marcador}»; ${culpa}), ` +
          'así que NO se midió',
      );
      console.log(`  ${String(ancho).padStart(4)} ${pantalla.padEnd(12)} NO SE CARGÓ`);
      continue;
    }

    const m = await pagina.evaluate(MEDIR, MINIMO_TACTIL);
    let conocidos = 0;

    const anotar = (clase, detalle, mensaje, testid) => {
      const motivo = excusa(pantalla, clase, detalle, testid);
      if (motivo !== undefined) {
        conocidos += 1;
        deudaVista.add(motivo);
        return;
      }
      problemas.push(`${nombreAncho} (${ancho}px), ${pantalla}: ${mensaje}`);
    };

    for (const f of m.fuera) {
      anotar(
        'fuera',
        f.texto,
        `«${f.texto}» se sale ${f.derecha - m.vw}px por la derecha (acaba en ${f.derecha} ` +
          `de ${m.vw})`,
      );
    }
    for (const c of m.recortes) {
      anotar(
        'recorte',
        c.texto,
        `«${c.texto}» está recortado: ${c.visible}px visibles de ${c.necesario} que necesita`,
      );
    }
    for (const t of m.tactiles) {
      anotar(
        'tactil',
        t.texto,
        `«${t.texto || t.testid || 'sin texto'}» mide ${t.ancho}×${t.alto}, por debajo del ` +
          `mínimo táctil de ${MINIMO_TACTIL}`,
        t.testid,
      );
    }
    for (const s of m.scrollers) {
      anotar(
        'scroller',
        s.texto,
        `hay ${s.contenido}px de contenido en ${s.visible}px visibles con ` +
          `overflow-x:${s.overflowX} («${s.texto}»), así que ${s.contenido - s.visible}px ` +
          'quedan fuera de vista',
      );
    }

    const nuevos =
      m.fuera.length + m.recortes.length + m.tactiles.length + m.scrollers.length - conocidos;
    console.log(
      `  ${String(ancho).padStart(4)} ${pantalla.padEnd(12)} ${String(m.medidos).padStart(4)} ` +
        `elementos, ${nuevos === 0 ? 'todo cabe y se lee' : `${nuevos} PROBLEMAS`}` +
        `${conocidos > 0 ? ` (${conocidos} de deuda conocida)` : ''}`,
    );

    /*
     * Un puñado de elementos no es una pantalla limpia: es el arnés mirando una página
     * medio cargada. El suelo es BAJO a propósito —la pantalla de acceso tiene 41
     * elementos y es correcta— porque quien de verdad garantiza que se midió lo que toca
     * es el marcador de arriba. Esto solo caza el caso de que la app no llegue a pintar.
     */
    if (m.medidos < 25) {
      problemas.push(
        `${nombreAncho}, ${pantalla}: solo ${m.medidos} elementos medidos, la pantalla no ` +
          'llegó a pintarse',
      );
    }
  }

  await ctx.close();
}

await navegador.close();
await cerrar();

for (const deuda of deudaVista) {
  console.log(`  deuda: se topó y se dejó pasar — ${deuda}`);
}

if (problemas.length > 0) {
  console.error('\nNO CABE O NO SE LEE:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  `\nOK: ${PANTALLAS.length} pantallas × ${ANCHOS.length} anchos. Nada se sale, nada se ` +
    'recorta sin querer, y todo lo que se pulsa llega al mínimo táctil.',
);
