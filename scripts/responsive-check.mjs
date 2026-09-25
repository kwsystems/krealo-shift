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
  /*
   * El selector de alcance entró aquí tarde y por un motivo que vale la pena dejar escrito:
   * es la hoja MÁS nueva y la que más aprieta —lista de empresas, lista de sedes y dos
   * acciones de alta, todo en una pantalla de 360— y aun así se pasó cuatro días sin medir,
   * porque al añadirla al encabezado nadie la añadió a esta lista. El arnés seguía diciendo
   * «4 hojas, todo cabe» con la verdad de antes: una lista de hojas no se actualiza sola, y
   * mientras no se actualiza, sigue dando un verde que ya no cubre lo que se acaba de tocar.
   *
   * Se abre desde `inicio` porque la barra vive en todas las pantallas del panel; da igual
   * cuál, y esa es justamente la razón por la que importa que quepa.
   */
  ['inicio', '/', '[data-testid="scope-open"]', 'scope-sheet'],
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
/*
 * VACÍA A PROPÓSITO, y la forma se queda. Las dos líneas que había —la rejilla de la
 * semana arrastrándose por debajo de 1120 px— ya no son deuda: se decidió (opción «a» de
 * la tarea de decisión) que la rejilla se arrastre con la columna de nombres FIJA, y eso
 * está hecho y medido, así que bajan a `EXENCIONES` con su guarda. Ver ahí.
 *
 * Se deja el mapa vacío y no se borra el mecanismo: la diferencia entre deuda y exención
 * es lo que mantiene honesta esta salida, y el día que haya una deuda de verdad hace
 * falta saber cómo se escribe. Una lista de excusas VIVA, en cambio, es una trampa: el
 * camino cómodo pasa a ser añadirse a ella en vez de arreglar nada.
 */
const DEUDA = new Map([]);

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
/*
 * LA SEGUNDA EXENCIÓN, la de la rejilla del horario, es la que más cuesta ganarse, así
 * que va escrita entera.
 *
 * La regla general dice que un contenedor que scrollea en horizontal esconde contenido sin
 * avisar. En la rejilla de la semana el arrastre es la respuesta CORRECTA, y está medido
 * por qué: para meter siete días en un portátil de 1280 hacen falta columnas de 116 px, y
 * descontando relleno quedan 84 px de texto, donde ya no cabe ni «Publicado». Por debajo
 * de 136 px los turnos dejan de leerse, y un horario con turnos ilegibles es peor que uno
 * que se arrastra. No es un ancho que ajustar: es cuántos días caben.
 *
 * Lo que SÍ era un fallo —y lo que hacía que esto fuera deuda y no exención— es que al
 * arrastrar se iba también la columna de empleados: dejabas de ver de quién era la fila.
 * Arreglado fijándola (`position: sticky`), así que arrastrar ya no pierde información,
 * solo pide un gesto.
 *
 * Y POR ESO ESTA EXENCIÓN TIENE GUARDA, que es lo que la separa de una excusa: la cuarta
 * pasada de este mismo arnés arrastra la rejilla de verdad en 768, 1024 y 1280 y mide que
 * los ocho nombres siguen en su sitio. El día que dejen de estarlo, el arnés se pone rojo
 * y esta exención cae con él.
 */
const EXENCIONES = new Map([
  [
    'reportes/tactil/testid:day-column-',
    'marcas del gráfico: les aplica el mínimo de 24×24 de WCAG 2.5.8, y miden 25×24',
  ],
  [
    'horario/scroller',
    'la rejilla de la semana se arrastra a propósito (comprimir más deja los turnos ' +
      'ilegibles) y la columna de nombres se queda fija: lo mide la cuarta pasada',
  ],
  [
    'horario/fuera',
    'la rejilla de la semana se arrastra a propósito (comprimir más deja los turnos ' +
      'ilegibles) y la columna de nombres se queda fija: lo mide la cuarta pasada',
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

/*
 * TERCERA PASADA: CON UN NOMBRE DE EMPRESA DE VERDAD.
 *
 * POR QUÉ HACE FALTA UNA PASADA ENTERA PARA ESTO.
 * Las dos de arriba miden la demostración, y la demostración se llama «Café Demostración»:
 * diecisiete caracteres que caben en cualquier sitio. El nombre de la empresa NO lo
 * escribimos nosotros —lo escribe quien contrata la app— y con uno largo la barra superior
 * ensanchaba la página 160 px por encima de la pantalla, también en un monitor de 1920.
 * El arnés estuvo verde toda la semana sobre ese fallo, y no por flojo: el caso difícil
 * estaba fuera de los datos con los que medía. Un arnés solo cubre los datos que le das.
 *
 * LA REGLA AQUÍ ES DISTINTA, y la diferencia es el fondo del asunto:
 *
 *   - Que algo SE SALGA de la ventana sigue siendo un fallo. Un nombre largo puede ocupar
 *     menos sitio, nunca más del que hay.
 *   - Que un nombre se RECORTE con puntos suspensivos NO lo es, y por eso esta pasada no
 *     mira los recortes. Es la decisión correcta para un dato que el cliente controla y
 *     que está entero en otro sitio —en el nombre accesible del botón y en la hoja, que
 *     envuelve—. Aplicar aquí la regla general de la primera pasada obligaría a que la
 *     barra creciera con el nombre, que es exactamente el fallo que se acaba de arreglar.
 *
 * Tres anchos y no siete: el estrecho, el del aparato de la tienda y el ancho. Lo que
 * importa es que el fallo no dependía del ancho, así que basta con cubrir los tres tramos.
 */
const PANTALLAS_LARGAS = [
  ['inicio', '/', 'Para que lo sepas'],
  ['equipo', '/team', 'Agregar empleado'],
  ['horario', '/schedule', 'Copiar semana anterior'],
];

for (const [nombreAncho, ancho, alto] of ANCHOS.filter(([, a]) => a === 360 || a === 768 || a === 1920)) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const pagina = await ctx.newPage();
  /*
   * LA LLAVE VIAJA EN CADA NAVEGACIÓN, y no solo en la primera: el cliente de la
   * demostración lee la URL una vez por CARGA de pestaña, y cada `goto` es una carga
   * nueva. Sin repetirla, se entraría con nombres largos y se mediría con los cortos, o
   * sea otra vez el verde que no cubre nada.
   */
  await pagina.goto(base + '/?nombres=largos', { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });

  for (const [pantalla, ruta, marcador] of PANTALLAS_LARGAS) {
    await pagina.goto(base + ruta + '?nombres=largos', { waitUntil: 'networkidle' });
    await esperarPantalla(pagina, marcador, { asentar: 400, obligatorio: false });

    const texto = ((await pagina.evaluate(() => document.body.innerText)) || '').replace(
      /\s+/g,
      ' ',
    );
    /*
     * LA GUARDA, y aquí es doble: que se cargó la pantalla que toca Y que de verdad trae
     * el nombre largo. Sin lo segundo, un fallo de la llave dejaría esta pasada midiendo
     * la demostración normal —que ya está verde— y diciendo que el caso difícil pasa.
     */
    if (!texto.includes(marcador)) {
      problemas.push(`${nombreAncho}, ${pantalla} con nombres largos: no se cargó esa pantalla`);
      continue;
    }
    if (!texto.includes('Universo Tutu Perú y Canadá')) {
      problemas.push(
        `${nombreAncho}, ${pantalla}: «?nombres=largos» no llegó a la pantalla, así que el ` +
          'caso del nombre largo NO se midió',
      );
      continue;
    }

    const m = await pagina.evaluate(MEDIR, MINIMO_TACTIL);
    let vistos = 0;
    let perdonados = 0;
    /*
     * PASA POR LA MISMA LISTA DE DEUDA Y DE EXENCIONES que las otras pasadas, y no por una
     * suya. Con una lista aparte, la rejilla de la semana —que ya está anotada como deuda
     * con su tarea— saldría aquí como hallazgo nuevo, y una deuda que reaparece con otro
     * nombre en cada pasada deja de ser deuda: se convierte en ruido que se aprende a
     * ignorar, y con él se ignora lo que sí es nuevo.
     */
    const anotarLargo = (clase, detalle, mensaje, testid) => {
      const excusada = excusa(pantalla, clase, detalle, testid);
      if (excusada !== undefined) {
        perdonados += 1;
        if (excusada.exento) exencionesVistas.add(excusada.motivo);
        else deudaVista.add(excusada.motivo);
        return;
      }
      vistos += 1;
      problemas.push(`${nombreAncho} (${ancho}px), ${pantalla} con nombre largo: ${mensaje}`);
    };

    for (const f of m.fuera) {
      anotarLargo('fuera', f.texto, `«${f.texto}» se sale ${f.derecha - m.vw}px por la derecha`);
    }
    for (const sc of m.scrollers) {
      anotarLargo(
        'scroller',
        sc.texto,
        `hay ${sc.contenido}px de contenido en ${sc.visible}px visibles («${sc.texto}»)`,
      );
    }
    for (const t of m.tactiles) {
      anotarLargo(
        'tactil',
        t.texto,
        `«${t.texto || t.testid}» mide ${t.ancho}×${t.alto}, por debajo del mínimo táctil`,
        t.testid,
      );
    }
    console.log(
      `  ${String(ancho).padStart(4)} ${(pantalla + ' (nombre largo)').padEnd(22)} ` +
        `${vistos === 0 ? 'nada se sale' : `${vistos} PROBLEMAS`}` +
        `${perdonados > 0 ? ` (${perdonados} ya anotados)` : ''}`,
    );
  }
  await ctx.close();
}

/*
 * CUARTA PASADA: LA REJILLA DE LA SEMANA SE ARRASTRA, Y POR ESO HAY QUE MIRARLA MÁS.
 *
 * Esta pasada existe para que la exención de más arriba no sea una excusa. La regla
 * general dice que un contenedor que scrollea en horizontal esconde contenido sin avisar,
 * y en la rejilla del horario se acepta que scrollee: comprimir siete días por debajo de
 * 136 px deja los turnos ilegibles, y un horario ilegible es peor que uno que se arrastra.
 *
 * Pero eso solo vale MIENTRAS la columna de nombres se quede fija. Si se va con el resto,
 * arrastrar deja de ser «pedir un gesto» y pasa a ser «perder de quién es la fila», que es
 * el fallo de verdad. O sea: la exención depende de un hecho, así que el hecho se mide, y
 * si deja de ser cierto esto se pone rojo y la exención cae con él.
 *
 * Una exención sin guarda es el permiso para no mirar.
 */
const ANCHOS_QUE_ARRASTRAN = [768, 1024, 1280];

for (const [nombreAncho, ancho, alto] of ANCHOS.filter(([, a]) =>
  ANCHOS_QUE_ARRASTRAN.includes(a),
)) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const pagina = await ctx.newPage();
  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await esperarPantalla(pagina, MARCADORES['/'], { asentar: 400 });
  await pagina.goto(base + '/schedule', { waitUntil: 'networkidle' });
  const cargada = await esperarPantalla(pagina, MARCADORES['/schedule'], {
    asentar: 500,
    obligatorio: false,
  });
  if (!cargada) {
    problemas.push(`${nombreAncho}, horario: no se cargó, así que la columna fija NO se midió`);
    await ctx.close();
    continue;
  }

  const r = await pagina.evaluate(() => {
    const cabecera = document.querySelector('[data-testid="grid-name-header"]');
    if (cabecera === null) return { error: 'no existe la cabecera de la columna de nombres' };

    /*
     * EL SCROLLER SE BUSCA SUBIENDO DESDE LA CABECERA, y no por un selector: así se mide
     * el contenedor que de verdad arrastra a ESTA columna. Buscarlo por clase o por ser
     * «el primero que scrollea» mediría cualquier otro y el arnés diría que sí sin haber
     * mirado la rejilla.
     */
    let scroller = cabecera.parentElement;
    while (scroller !== null && scroller.scrollWidth <= scroller.clientWidth + 1) {
      scroller = scroller.parentElement;
    }
    if (scroller === null) {
      return { arrastra: false };
    }

    const izquierdaAntes = cabecera.getBoundingClientRect().left;
    scroller.scrollLeft = scroller.scrollWidth;
    // Forzar el reflow antes de volver a medir.
    void scroller.offsetWidth;
    const caja = cabecera.getBoundingClientRect();
    const cajaScroller = scroller.getBoundingClientRect();

    const nombres = Array.from(document.querySelectorAll('[data-testid^="grid-name-"]')).filter(
      (n) => n.getAttribute('data-testid') !== 'grid-name-header',
    );
    const filasVisibles = nombres.filter((n) => {
      const c = n.getBoundingClientRect();
      return c.width > 0 && c.left >= cajaScroller.left - 2 && c.left < cajaScroller.right;
    }).length;

    return {
      arrastra: true,
      movida: Math.round(caja.left - izquierdaAntes),
      desplazado: Math.round(scroller.scrollLeft),
      filas: nombres.length,
      filasVisibles,
      texto: (cabecera.textContent ?? '').trim(),
    };
  });

  if (r.error !== undefined) {
    problemas.push(`${nombreAncho}, horario: ${r.error}`);
  } else if (r.arrastra === false) {
    // Cabe entera: no hay nada que fijar, y decirlo es más honesto que un OK mudo.
    console.log(`  ${String(ancho).padStart(4)} horario: cabe entera, no se arrastra`);
  } else if (r.desplazado === 0) {
    problemas.push(
      `${nombreAncho}, horario: la rejilla no se dejó arrastrar, así que NO se comprobó ` +
        'que la columna de nombres se queda fija',
    );
  } else if (r.movida !== 0) {
    problemas.push(
      `${nombreAncho} (${ancho}px), horario: al arrastrar ${r.desplazado}px la columna de ` +
        `nombres se movió ${r.movida}px: se pierde de vista de quién es cada fila`,
    );
  } else if (r.filasVisibles < r.filas) {
    problemas.push(
      `${nombreAncho} (${ancho}px), horario: tras arrastrar solo ${r.filasVisibles} de ` +
        `${r.filas} nombres siguen en su sitio`,
    );
  } else {
    console.log(
      `  ${String(ancho).padStart(4)} horario: arrastrada ${r.desplazado}px, los ` +
        `${r.filas} nombres siguen delante`,
    );
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
  `\nOK: ${PANTALLAS.length} pantallas × ${ANCHOS.length} anchos, ${HOJAS.length} hojas y ` +
    `${PANTALLAS_LARGAS.length} pantallas con un nombre de empresa largo. ` +
    'Nada se sale, nada se recorta sin querer, y todo lo que se pulsa llega al mínimo táctil.',
);
