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
import { servirExport, cargarPlaywright, esperarPantalla, MARCADORES } from './lib/arnes-web.mjs';

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
  /*
   * Horas se reconocía por «Ir a esta semana», y ese botón pasó a salir SOLO cuando no
   * estás en la semana actual: un botón apagado ocupa el mismo sitio que uno que sirve y
   * enseña una acción imposible. El marcador tiene que ser algo que la pantalla pinte
   * SIEMPRE, no el texto de un control que el diseño puede esconder.
   */
  ['horas', '/hours', 'Horas netas'],
  ['reportes', '/reports', 'Mide presencia, no trabajo hecho'],
  ['solicitudes', '/requests', 'Correcciones de hora'],
  ['ajustes', '/settings', 'Cambia el idioma de esta app'],
];

/**
 * LO QUE VIVE DETRÁS DE UN BOTÓN, que hasta ahora no se medía.
 *
 * Las ocho pantallas de arriba son las que tienen URL. Todo lo demás —editar un turno,
 * copiar la semana, dar de alta a alguien, compartir el reporte— vive en una hoja que
 * solo existe después de un toque, y el arnés no la abría NUNCA.
 *
 * Y ahí había un fallo de los gordos: en «Editar turno» de un turno publicado, la pista
 * de «Cancelar turno» se salía 106 px de la hoja a 360 px de ancho y se leía «…se cancela
 * y qued». Apareció mirando una captura de otra tarea, de casualidad, que es exactamente
 * el modo de fallo contra el que existe este arnés.
 *
 * Cada entrada es [pantalla, ruta, con qué se abre, qué hoja tiene que salir].
 */
const HOJAS = [
  ['horario', '/schedule', '[data-testid^="shift-"]', 'shift-form-sheet'],
  ['horario', '/schedule', '[data-testid="schedule-copy-week"]', 'copy-week-sheet'],
  ['equipo', '/team', '[data-testid="team-add-employee"]', 'employee-form-sheet'],
  ['reportes', '/reports', '[data-testid="report-share-open"]', 'report-share-sheet'],
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
/*
 * LOS IDENTIFICADORES SON DE «Krealo Media», no de Universo Tutu. El trabajo de Krealo
 * Shift se registraba alli por la excepcion temporal de empresa y el 22-sep-2026 se
 * movio: los originales quedaron CERRADOS con una nota que apunta al reemplazo. Una
 * linea de deuda que cita un id ya cerrado invita a borrarla —«si la tarea esta hecha,
 * fuera»— y borrarla sin arreglar nada pone el arnes en rojo.
 */
const DEUDA = new Map([
  [
    'horario/scroller',
    'la rejilla de la semana pide 1120 px y por debajo se arrastra (tXdQjB2WZqydk1EyZmRt)',
  ],
  [
    'horario/fuera',
    'la rejilla de la semana pide 1120 px y por debajo se arrastra (tXdQjB2WZqydk1EyZmRt)',
  ],
]);

/**
 * EXENCIONES RAZONADAS, que no son deuda.
 *
 * La diferencia importa: una línea de `DEUDA` dice «esto está mal y se va a arreglar», y
 * al arreglarse se borra. Una de aquí dice «la regla general no aplica a esto, y por
 * qué». Si se mezclaran, la lista de deuda nunca llegaría a cero y dejaría de significar
 * nada.
 *
 * Las columnas del gráfico de la semana son la primera: son MARCAS DE DATOS, no botones.
 * El mínimo táctil de 44 px que esta app se exige viene del teclado del reloj de
 * fichaje, donde cada tecla es un control; aplicarlo a siete columnas de un gráfico
 * obligaría a que el gráfico midiera 308 px solo de marcas, que en un teléfono de 360 no
 * existen. El mínimo que sí les corresponde es el de WCAG 2.5.8 para objetivos —24×24
 * px— y lo cumplen: miden 25×24 en el ancho más estrecho.
 *
 * Y se quedan en el recorrido del teclado a propósito: su `accessibilityLabel` es la
 * única forma de que un lector de pantalla lea el valor de cada día. Lo que sí era un
 * fallo es que pulsarlas con Enter no hiciera nada, y eso se arregló en el componente.
 */
const EXENCIONES = new Map([
  [
    'reportes/tactil/testid:day-column-',
    'marcas del gráfico: les aplica el mínimo de 24×24 de WCAG 2.5.8, y miden 25×24',
  ],
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
  /*
   * CUÁNTO ANCHO PIDE DE VERDAD ESTE TEXTO, que no es su `scrollWidth`.
   *
   * `numberOfLines` de React Native se compila a `-webkit-line-clamp` con
   * `overflow: hidden`, y ahí `scrollWidth` devuelve el ancho de la CAJA RECORTADA, no
   * el del texto. Me costó un arreglo equivocado: el arnés dijo que a la hora de un
   * turno le faltaban 2 px —102 visibles de 104— y al medirla de verdad le faltaban 44.
   * Con 2 px se busca un relleno que sobre; con 44 se sabe que el texto no cabe en esa
   * columna y hay que decidir otra cosa. El número cambia la decisión, así que tiene
   * que ser el verdadero.
   *
   * Se clona el nodo, se le quita el recorte y se mide. Solo para los que ya salieron
   * recortados, que son pocos: clonar los 300 elementos de una pantalla sería lento.
   */
  const anchoDeVerdad = (el) => {
    const c = el.cloneNode(true);
    c.style.position = 'absolute';
    c.style.visibility = 'hidden';
    c.style.width = 'auto';
    c.style.maxWidth = 'none';
    c.style.overflow = 'visible';
    c.style.whiteSpace = 'nowrap';
    c.style.webkitLineClamp = 'none';
    document.body.appendChild(c);
    const w = Math.ceil(c.getBoundingClientRect().width);
    c.remove();
    return w;
  };

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
        recortes.push({ texto, visible: el.clientWidth, necesario: anchoDeVerdad(el) });
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

/**
 * Lo que se le pide a una hoja: que nada de lo que hay dentro se salga de ella.
 *
 * SE MIDE CONTRA EL BORDE DE LA HOJA Y NO CONTRA LA VENTANA, y esa es la diferencia que
 * lo hace servir: en una tablet la hoja va centrada y es más estrecha que la ventana, así
 * que un texto puede salirse de la hoja —y verse cortado por su borde— sin salirse de la
 * pantalla. Medir contra la ventana daría verde sobre un texto cortado.
 */
const MEDIR_HOJA = (hojaTestId) => {
  const hoja = document.querySelector(`[data-testid="${hojaTestId}"]`);
  if (hoja === null) return null;
  const caja = hoja.getBoundingClientRect();
  const limpiar = (texto) =>
    texto
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const fuera = [];
  const recortes = [];
  let medidos = 0;
  for (const el of hoja.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const texto = limpiar(el.textContent ?? '');
    const c = el.getBoundingClientRect();
    if (c.width === 0 || c.height === 0) continue;
    medidos += 1;
    if (c.right > caja.right + 1) {
      fuera.push({ texto: texto.slice(0, 60), sale: Math.round(c.right - caja.right) });
    }
    if (texto !== '' && el.scrollWidth > el.clientWidth + 1) {
      recortes.push({ texto: texto.slice(0, 60), px: el.scrollWidth - el.clientWidth });
    }
  }
  return { medidos, fuera, recortes, ancho: Math.round(caja.width) };
};

const problemas = [];
const deudaVista = new Set();
const exencionesVistas = new Set();

/** ¿Está esto excusado como deuda conocida? Devuelve el motivo o `undefined`. */
/** Busca una clave en un mapa, con las mismas tres formas que usa la deuda. */
const buscar = (mapa, pantalla, clase, detalle, testid) => {
  const exacta = mapa.get(`${pantalla}/${clase}/${detalle}`);
  if (exacta !== undefined) return exacta;
  // `*` excusa en cualquier pantalla: lo que está en la barra de navegación sale en todas.
  const cualquierPantalla = mapa.get(`*/${clase}/${detalle}`);
  if (cualquierPantalla !== undefined) return cualquierPantalla;
  // Un grupo entero, por prefijo de testid. Las siete columnas de día son el mismo fallo,
  // y seis no tienen texto con el que nombrarlas; la séptima sí, y se escapaba.
  if (typeof testid === 'string') {
    for (const [clave, motivo] of mapa) {
      const prefijo = `${pantalla}/${clase}/testid:`;
      if (clave.startsWith(prefijo) && testid.startsWith(clave.slice(prefijo.length))) {
        return motivo;
      }
    }
  }
  // Y por clase entera, para lo que desborda en bloque: una rejilla que no cabe se
  // reporta una vez, no una por celda.
  const porClase = mapa.get(`${pantalla}/${clase}`);
  if (porClase !== undefined) return porClase;
  return undefined;
};

/** Deuda conocida (se va a arreglar) o exención razonada (la regla no aplica). */
const excusa = (pantalla, clase, detalle, testid) => {
  const exenta = buscar(EXENCIONES, pantalla, clase, detalle, testid);
  if (exenta !== undefined) return { motivo: exenta, exento: true };
  const deuda = buscar(DEUDA, pantalla, clase, detalle, testid);
  if (deuda !== undefined) return { motivo: deuda, exento: false };
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
      // Antes eran 3.000 ms fijos. Ahora se espera a que Inicio esté montado: en una
      // máquina lenta tarda lo que tarde en vez de seguir con la sesión a medias.
      await pagina.locator('[data-testid="sign-in-demo"]').click();
      await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
      entrado = true;
    }

    await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
    /*
     * `obligatorio: false` A PROPÓSITO: si esta pantalla no aparece, la guarda de abajo
     * lo anota con su nombre y el arnés SIGUE midiendo las demás. Reventar aquí dejaría
     * las otras seis sin medir y el informe se leería como si estuvieran bien.
     */
    await esperarPantalla(pagina, marcador, { asentar: 400, obligatorio: false });

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
    let deudas = 0;
    let exentos = 0;

    const anotar = (clase, detalle, mensaje, testid) => {
      const excusada = excusa(pantalla, clase, detalle, testid);
      if (excusada !== undefined) {
        if (excusada.exento) {
          exentos += 1;
          exencionesVistas.add(excusada.motivo);
        } else {
          deudas += 1;
          deudaVista.add(excusada.motivo);
        }
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

    /*
     * Se cuentan APARTE, y no por pedantería: decir «7 de deuda conocida» cuando son
     * siete exenciones razonadas hace pensar que hay siete cosas por arreglar en esa
     * pantalla. Quien lee esta salida decide con ella.
     */
    const nuevos =
      m.fuera.length +
      m.recortes.length +
      m.tactiles.length +
      m.scrollers.length -
      deudas -
      exentos;
    console.log(
      `  ${String(ancho).padStart(4)} ${pantalla.padEnd(12)} ${String(m.medidos).padStart(4)} ` +
        `elementos, ${nuevos === 0 ? 'todo cabe y se lee' : `${nuevos} PROBLEMAS`}` +
        `${deudas > 0 ? ` (${deudas} de deuda conocida)` : ''}` +
        `${exentos > 0 ? ` (${exentos} exentos por regla)` : ''}`,
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

/*
 * SEGUNDA PASADA: LAS HOJAS.
 *
 * Solo en los tres anchos donde una hoja aprieta —los dos teléfonos y el iPad vertical—
 * y no en los siete: en un monitor la hoja tiene su ancho fijo y lo que pase ahí ya lo
 * dice el iPad. Cuatro hojas × tres anchos son doce aperturas, medio minuto.
 *
 * Si una hoja no se puede abrir NO SE CALLA: se reporta. Un arnés que se salta en
 * silencio lo que no encuentra acaba midiendo la mitad y diciendo que todo está bien,
 * que es como el panel llevaba meses con dieciocho fallos de ancho.
 */
for (const [nombreAncho, ancho, alto] of ANCHOS.filter(([, a]) => a <= 768)) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const pagina = await ctx.newPage();
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });

  for (const [pantalla, ruta, abridor, hoja] of HOJAS) {
    await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
    const cargada = await esperarPantalla(pagina, MARCADORES[ruta], {
      asentar: 400,
      obligatorio: false,
    });
    if (!cargada) {
      problemas.push(`${nombreAncho}, ${pantalla}/${hoja}: no se cargó la pantalla`);
      continue;
    }

    const boton = pagina.locator(abridor).first();
    if ((await boton.count()) === 0) {
      problemas.push(
        `${nombreAncho}, ${pantalla}: no se encontró «${abridor}», así que «${hoja}» ` +
          'se quedó sin medir',
      );
      continue;
    }
    await boton.click();
    const abierta = await esperarPantalla(
      pagina,
      { testid: hoja, visible: true },
      {
        asentar: 500,
        obligatorio: false,
      },
    );
    if (!abierta) {
      problemas.push(`${nombreAncho}, ${pantalla}: «${abridor}» no abrió «${hoja}»`);
      continue;
    }

    const m = await pagina.evaluate(MEDIR_HOJA, hoja);
    if (m === null || m.medidos < 5) {
      problemas.push(`${nombreAncho}, ${hoja}: la hoja se abrió vacía`);
      continue;
    }
    for (const f of m.fuera) {
      problemas.push(
        `${nombreAncho} (${ancho}px), ${hoja}: «${f.texto}» se sale ${f.sale}px de la hoja ` +
          `(la hoja mide ${m.ancho}px)`,
      );
    }
    for (const r of m.recortes) {
      problemas.push(`${nombreAncho} (${ancho}px), ${hoja}: «${r.texto}» se recorta ${r.px}px`);
    }
    console.log(
      `  ${String(ancho).padStart(4)} ${hoja.padEnd(20)} ${String(m.medidos).padStart(3)} ` +
        `elementos, ${m.fuera.length + m.recortes.length === 0 ? 'todo cabe en la hoja' : 'NO CABE'}`,
    );
    await pagina.keyboard.press('Escape');
    await pagina.waitForTimeout(200);
  }
  await ctx.close();
}

await navegador.close();
await cerrar();

for (const exento of exencionesVistas) {
  console.log(`  exento por regla — ${exento}`);
}
for (const deuda of deudaVista) {
  console.log(`  deuda: se topó y se dejó pasar — ${deuda}`);
}

if (problemas.length > 0) {
  console.error('\nNO CABE O NO SE LEE:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  `\nOK: ${PANTALLAS.length} pantallas × ${ANCHOS.length} anchos y ${HOJAS.length} hojas. ` +
    'Nada se sale, nada se recorta sin querer, y todo lo que se pulsa llega al mínimo táctil.',
);
