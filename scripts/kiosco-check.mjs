/**
 * ¿Cabe el teclado del reloj de fichaje en la pantalla?
 *
 * POR QUÉ EXISTE
 * En una pantalla de 360×640 la última fila del teclado —"Borrar", "0" y el borrado de
 * dígito— quedaba CORTADA por abajo. Un empleado con ese teléfono no podía terminar de
 * teclear su PIN: la función entera de la aplicación, rota, sin un solo error en
 * consola y con la pantalla pintándose perfecta. Ningún chequeo anterior lo veía porque
 * todos miraban si había contenido, no DÓNDE terminaba.
 *
 * Esto mide la posición real del último botón contra el alto de la ventana. Es la única
 * forma de comprobarlo: el tamaño de fuente que decide el layout se calcula en tiempo de
 * ejecución a partir de las dimensiones, así que no hay nada que un test de unidad pueda
 * inspeccionar sin reimplementar el cálculo —y entonces se estaría comprobando la copia,
 * no el original—.
 *
 * Se prueban tamaños REALES, de menor a mayor, incluido un iPhone SE de primera
 * generación: si funciona ahí, funciona en cualquier teléfono que alguien ponga en el
 * mostrador.
 *
 * Y CON UNA CÁMARA FALSA. Desde e3d5a2a el reloj en web exige foto para fichar y la
 * cuenta atrás no arranca sin ella, así que sin cámara ningún fichaje termina. Chromium
 * se lanza con un dispositivo de vídeo sintético y el permiso concedido: es lo único
 * que permite recorrer el fichaje entero en un servidor de CI. De paso es la ÚNICA
 * verificación del camino feliz de la foto en web —la tarjeta llegando a la cuenta
 * atrás es la prueba de que se tomó—. La primera vez que corrió encontró que
 * `takePictureAsync` fallaba siempre en web (ver `photo-capture.tsx`).
 *
 * Y EN LOS DOS TEMAS, por dos razones distintas. El layout, porque el tema cambia pesos
 * y bordes y podría mover el último botón unos píxeles. El contraste, porque el kiosco
 * se lee A UN BRAZO DE DISTANCIA, de pie y con gente detrás: un reloj que en el
 * escritorio «se distingue» aquí es directamente ilegible, y quien no puede leerlo no
 * puede fichar.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/kiosco-check.mjs dist-demo
 */
import { servirExport, cargarPlaywright, sembrarKiosco, medirContraste } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/kiosco-check.mjs <directorio-del-export>');
  process.exit(2);
}

const TAMANOS = [
  ['iPhone SE 1ª gen', 320, 568],
  ['teléfono pequeño', 360, 640],
  ['teléfono normal', 390, 844],
  ['teléfono grande', 414, 896],
  ['iPad vertical', 834, 1112],
  ['iPad horizontal', 1112, 834],
];

/** §25: por debajo de esto un botón deja de ser un objetivo táctil usable. */
const MINIMO_TACTIL = 44;

/** Los dos temas. El kiosco no se libra de ninguno: de noche se usa el oscuro. */
const TEMAS = ['light', 'dark'];

/**
 * Contraste mínimo de texto (WCAG 1.4.3).
 *
 * 4,5:1 para texto normal y 3:1 para el grande. GRANDE aquí es >= 24 px y nada más:
 * la regla real incluye «>= 18,7 px en negrita», pero el peso lo lleva la FAMILIA
 * —`Inter_600SemiBold`— y no el `font-weight`, que sigue diciendo 400. Preguntar por
 * el peso daría 400 en textos que son negrita de verdad, así que se aplica el umbral
 * estricto a todo lo que no llegue a 24 px. Equivocarse hacia el lado exigente es lo
 * correcto en una pantalla que se lee a un brazo.
 */
const MINIMO_TEXTO = 4.5;
const MINIMO_TEXTO_GRANDE = 3;
const TAMANO_GRANDE = 24;

/**
 * DEUDA DEL TEMA CLARO, NOMBRADA PARA QUE EL ARNÉS SIGA SIRVIENDO.
 *
 * Al medir el contraste de verdad aparecieron dos tintas que no llegan, y NO son del
 * tema oscuro: son del claro, el que la app lleva usando desde siempre.
 *
 *   #16845B — `success600` en claro. «Trabajando», «entrada registrada». 4,24 y 4,31:1.
 *   #B56B00 — `warning600` en claro. El aviso de modo demostración. 3,86:1.
 *
 * Arreglarlas cambia las insignias de estado de TODA la app, que es un cambio visible
 * que tiene que ver Andree: queda en la tarea nJTTpJRad37anvPtsAZc. Aquí se nombran por
 * su valor exacto y SOLO en claro. Lo que NO se hace es bajar el mínimo: eso dejaría un
 * arnés que dice OK sin comprobar nada.
 *
 * Se excusa por el color, no por el texto: si la misma tinta floja aparece en un sitio
 * nuevo es la misma deuda, pero si el flojo es OTRO color, esto falla. Y en oscuro no se
 * excusa nada, porque el oscuro se diseñó midiendo y no hereda nada que disculpar.
 */
const DEUDA_DE_CLARO = new Map([
  ['rgb(22, 132, 91)', 'success600 en claro (nJTTpJRad37anvPtsAZc)'],
  ['rgb(181, 107, 0)', 'warning600 en claro (nJTTpJRad37anvPtsAZc)'],
]);

/**
 * Holgura mínima por debajo del teclado, en píxeles.
 *
 * NO es cero a propósito. La primera versión de este arnés pasaba con el teclado
 * acabando en 567 de 568: cabía por un píxel. Eso no es "cabe", es "todavía no se ha
 * roto": basta una traducción más larga, un aviso extra o una fuente que redondee
 * distinto para volver al fallo, y el arnés habría dicho que todo estaba bien.
 */
const HOLGURA_MINIMA = 8;

/**
 * Cámara sintética de Chromium. `--use-fake-device-for-media-stream` inventa una cámara
 * que emite un patrón de prueba —sin ella `getUserMedia` falla con NotFoundError y la
 * foto no puede existir— y `--use-fake-ui-for-media-stream` acepta solo el diálogo de
 * permiso. `CON_CAMARA` deja además el permiso como concedido para la API de permisos,
 * que es lo primero que consulta `expo-camera`: sin él la tarjeta pasa por «pedir
 * permiso» y también llega, pero ese es un camino más y no el del reloj instalado.
 * Medidos los tres estados; el control es correr esto sin `CAMARA_FALSA`, que falla
 * nombrando la foto.
 */
const CAMARA_FALSA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
const CON_CAMARA = { permissions: ['camera'] };

const { base, cerrar } = await servirExport(DIR, 8210);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch({ args: CAMARA_FALSA });
const problemas = [];

/**
 * Marca la entrada y espera a que arranque la cuenta atrás.
 *
 * En web la cuenta atrás NO arranca hasta que hay foto, así que verla aparecer es la
 * prueba de que la cámara la tomó. Si en su lugar sale «Sin foto no se puede fichar
 * aquí», la foto falló, y eso es un fallo del reloj y no del arnés: se anota con
 * nombre. Devuelve `true` si se llegó a la cuenta atrás.
 */
const marcarEntrada = async (pag, etiqueta) => {
  await pag.locator('[data-testid="kiosk-action-clock_in"]').click();
  const cuenta = pag.locator('[data-testid="kiosk-confirm-countdown"]');
  const sinFoto = pag.locator('[data-testid="kiosk-photo-required"]');
  await Promise.race([
    cuenta.waitFor({ timeout: 15000 }).catch(() => undefined),
    sinFoto.waitFor({ timeout: 15000 }).catch(() => undefined),
  ]);
  if ((await sinFoto.count()) > 0) {
    problemas.push(
      `${etiqueta}: la foto de verificación FALLÓ y el fichaje no se pudo confirmar ` +
        '(en web sin foto no hay cuenta atrás)',
    );
    return false;
  }
  if ((await cuenta.count()) === 0) {
    problemas.push(`${etiqueta}: tras marcar entrada no apareció la cuenta atrás en 15 s`);
    return false;
  }
  return true;
};

/** Espera a que la cuenta atrás termine en la tarjeta de resultado. */
const esperarResultado = async (pag, etiqueta) => {
  const resultado = pag.locator('[data-testid="kiosk-result"]');
  await resultado.waitFor({ timeout: 10000 }).catch(() => undefined);
  if ((await resultado.count()) === 0) {
    problemas.push(`${etiqueta}: la cuenta atrás no terminó en un resultado en 10 s`);
    return false;
  }
  await pag.waitForTimeout(600);
  return true;
};

for (const tema of TEMAS) {
  for (const [etiquetaBase, ancho, alto] of TAMANOS) {
    const etiqueta = `${etiquetaBase} (${tema})`;
    const ctx = await navegador.newContext({
      viewport: { width: ancho, height: alto },
      colorScheme: tema,
    });
    const pagina = await ctx.newPage();

    // Se activa el reloj por su propia pantalla, como lo haría una persona.
    await pagina.goto(base + '/kiosk/setup', { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(1500);
    const campos = pagina.locator('input');
    if ((await campos.count()) >= 2) {
      await campos.nth(0).fill('123456');
      await campos.nth(1).fill('Reloj tienda');
      await pagina.getByRole('button').first().click();
      await pagina.waitForTimeout(3000);
    }

    await pagina.goto(base + '/kiosk', { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(1800);

    const medida = await pagina.evaluate(() => {
      const textos = [...document.querySelectorAll('*')].filter(
        (el) => el.children.length === 0 && (el.textContent || '').trim() === '0',
      );
      const cero = textos[textos.length - 1];
      if (cero === undefined) return null;
      // El botón es el ancestro que de verdad tiene tamaño de botón.
      let boton = cero;
      while (boton.parentElement !== null && boton.getBoundingClientRect().height < 40) {
        boton = boton.parentElement;
      }
      const r = boton.getBoundingClientRect();
      return {
        abajo: Math.round(r.bottom),
        alto: Math.round(r.height),
        ventana: window.innerHeight,
      };
    });

    if (medida === null) {
      problemas.push(`${etiqueta} (${ancho}×${alto}): no se encontró el teclado`);
      console.log(`  ${etiqueta.padEnd(25)} SIN TECLADO`);
      await ctx.close();
      continue;
    }

    const holgura = medida.ventana - medida.abajo;
    const cabe = holgura >= HOLGURA_MINIMA;
    const tactil = medida.alto >= MINIMO_TACTIL;

    if (!cabe) {
      problemas.push(
        holgura < 0
          ? `${etiqueta} (${ancho}×${alto}): el teclado se SALE ${-holgura}px por abajo`
          : `${etiqueta} (${ancho}×${alto}): solo ${holgura}px de holgura, hacen falta ${HOLGURA_MINIMA}`,
      );
    }
    if (!tactil) {
      problemas.push(
        `${etiqueta} (${ancho}×${alto}): botón de ${medida.alto}px, por debajo del mínimo táctil de ${MINIMO_TACTIL}`,
      );
    }

    console.log(
      `  ${etiqueta.padEnd(25)} ${String(ancho).padStart(4)}×${String(alto).padEnd(4)} ` +
        `holgura ${String(holgura).padStart(4)}px  ` +
        `botón ${medida.alto}px  ${cabe && tactil ? 'OK' : 'FALLA'}`,
    );

    await ctx.close();
  }
}

/*
 * ---------------------------------------------------------------------------
 * «Otro» no se puede elegir sin explicar qué pasó
 * ---------------------------------------------------------------------------
 *
 * El servidor ya lo exige y hay pruebas SQL que lo comprueban. Esto comprueba la OTRA
 * mitad, que es la que de verdad ve una persona: que el kiosco lo pida ANTES y no
 * después. Sin esta comprobación, la regla podría vivir solo en el servidor y el
 * síntoma sería que alguien elige «Otro», confirma, espera la cuenta atrás y recibe un
 * error en la cara —con la cola detrás y sin saber qué hacer—.
 *
 * Se recorre a mano: PIN, entrada, pausa, «Otro». Es el único modo de comprobar que el
 * botón de continuar empieza apagado y dice por qué, que un texto de solo espacios no
 * lo enciende, y que escribir algo sí.
 */
{
  const ctx = await navegador.newContext({
    viewport: { width: 834, height: 1112 },
    ...CON_CAMARA,
  });
  const pag = await ctx.newPage();
  await sembrarKiosco(pag);
  await pag.goto(base + '/kiosk', { waitUntil: 'networkidle' });
  await pag.waitForTimeout(2500);

  // Hay DOS teclados en el DOM —el del PIN y el de la autorización del gerente—, así
  // que se selecciona el visible o se espera para siempre por uno oculto.
  const tecleaPin = async () => {
    await pag.waitForSelector('[data-testid="keypad-1"]:visible', { timeout: 20000 });
    for (const digito of ['1', '2', '3', '4', '5', '6']) {
      await pag.locator(`[data-testid="keypad-${digito}"]:visible`).first().click();
      await pag.waitForTimeout(180);
    }
    await pag.waitForTimeout(3000);
  };

  await tecleaPin();
  // Entrar a trabajar: la pausa solo existe estando dentro. No hay botón de confirmar,
  // hay una cuenta atrás de 3 s que se cierra sola —y en web, antes, la foto—.
  // Sin entrada no hay pausa que probar. Si la foto falló, `marcarEntrada` ya lo anotó
  // con nombre y la pantalla se queda en la tarjeta de confirmación, sin teclado al que
  // volver: seguir sería esperar 20 s por un teclado que no va a aparecer y morir con
  // un TimeoutError en vez de con el mensaje. Pasó en el control sin cámara.
  const entro =
    (await marcarEntrada(pag, 'nota de «Otro»')) && (await esperarResultado(pag, 'nota de «Otro»'));
  if (entro) {
    const listo = pag.locator('[data-testid="kiosk-result-done"]');
    if ((await listo.count()) > 0) {
      await listo.click();
      await pag.waitForTimeout(1500);
    }
    await tecleaPin();
  }

  const pausa = pag.locator('[data-testid="kiosk-action-break_start"]');
  if (entro && (await pausa.count()) === 0) {
    problemas.push('nota de pausa: no se llegó al botón de iniciar descanso');
  } else if (entro) {
    await pausa.click();
    await pag.waitForTimeout(1200);
    await pag.locator('[data-testid="break-reason-other"]').click();
    await pag.waitForTimeout(1000);

    const hoja = pag.locator('[data-testid="break-note-sheet"]');
    if ((await hoja.count()) === 0) {
      problemas.push(
        'elegir «Otro» NO pide la nota: sin ella el motivo se vuelve el cajón donde cae todo',
      );
    } else {
      const apagado = async () =>
        (await pag.locator('[data-testid="break-note-submit"]').getAttribute('aria-disabled')) ===
        'true';

      if (!(await apagado())) {
        problemas.push('el botón de continuar empieza encendido con la nota vacía');
      }

      const texto = ((await hoja.innerText()) || '').replace(/\s+/g, ' ');
      if (!texto.includes('continuar') && !texto.includes('Continuar')) {
        problemas.push('la hoja de la nota no dice qué hace falta para continuar');
      }

      // Solo espacios: es el hueco por el que se escapa cualquier campo obligatorio.
      await pag.locator('[data-testid="break-note-input"]').fill('     ');
      await pag.waitForTimeout(400);
      if (!(await apagado())) {
        problemas.push('una nota de solo espacios enciende el botón: eso no es una explicación');
      }

      await pag.locator('[data-testid="break-note-input"]').fill('Fui a la clínica');
      await pag.waitForTimeout(400);
      if (await apagado()) {
        problemas.push('con la nota escrita el botón sigue apagado: no se puede pausar');
      }

      await pag.locator('[data-testid="break-note-submit"]').click();
      await pag.waitForTimeout(1500);
      const siguiente = ((await pag.evaluate(() => document.body.innerText)) || '').replace(
        /\s+/g,
        ' ',
      );
      if ((await pag.locator('[data-testid="break-note-sheet"]').count()) > 0) {
        problemas.push('tras escribir la nota, la hoja no se cierra');
      }
      console.log(`  nota de «Otro»    pide explicación, y con ella continúa  OK`);
      if (siguiente.length < 120) problemas.push('la pantalla tras la nota quedó vacía');
    }
  }

  await ctx.close();
}

/*
 * ---------------------------------------------------------------------------
 * La pantalla no puede contradecirse a sí misma al confirmar un fichaje
 * ---------------------------------------------------------------------------
 *
 * Esto salió de recorrer el fichaje en un teléfono, no de leer el código. Al marcar la
 * entrada, la tarjeta de abajo decía «Entrada registrada a las 21:49» y la de arriba
 * seguía diciendo «Fuera de turno»: la misma pantalla afirmando las dos cosas, en el
 * único momento en que a la persona solo le importa una —si quedó registrado o no—.
 *
 * La causa: el estado de la cabecera se capturaba al teclear el PIN y no se volvía a
 * tocar, aunque el servidor devuelve el estado nuevo en la respuesta del fichaje.
 *
 * Se comprueba aquí y no en una prueba unitaria porque es una propiedad de LO QUE SE VE:
 * las dos afirmaciones están en componentes distintos y cada uno, por separado, estaba
 * bien.
 */
{
  const ctx = await navegador.newContext({
    viewport: { width: 390, height: 844 },
    ...CON_CAMARA,
  });
  const pag = await ctx.newPage();
  await sembrarKiosco(pag);
  await pag.goto(base + '/kiosk', { waitUntil: 'networkidle' });
  await pag.waitForTimeout(2500);

  await pag.waitForSelector('[data-testid="keypad-1"]:visible', { timeout: 20000 });
  for (const digito of ['1', '2', '3', '4', '5', '6']) {
    await pag.locator(`[data-testid="keypad-${digito}"]:visible`).first().click();
    await pag.waitForTimeout(180);
  }
  await pag.waitForTimeout(3000);
  if (await marcarEntrada(pag, 'confirmación')) {
    await esperarResultado(pag, 'confirmación');
  }

  const texto = ((await pag.evaluate(() => document.body.innerText)) || '').replace(/\s+/g, ' ');
  const confirma = /registrada|registrado/i.test(texto);
  const diceFuera = /Fuera de turno/i.test(texto);

  if (!confirma) {
    problemas.push('tras marcar entrada la pantalla no confirma que quedó registrada');
  }
  if (confirma && diceFuera) {
    problemas.push(
      'la pantalla dice «registrada» y «Fuera de turno» a la vez: se contradice justo ' +
        'cuando la persona solo quiere saber si quedó',
    );
  }
  console.log(
    `  confirmación      ${confirma ? 'dice que quedó registrada' : 'NO confirma'}` +
      `, estado ${diceFuera ? 'CONTRADICTORIO' : 'coherente'}`,
  );
  await ctx.close();
}

/*
 * ---------------------------------------------------------------------------
 * ¿Se lee, de verdad, a un brazo de distancia? En los dos temas
 * ---------------------------------------------------------------------------
 *
 * La medición la hace `medirContraste`, que vive en la librería compartida porque
 * `contraste-check.mjs` hace lo mismo con las pantallas del panel. Lo que es propio del
 * kiosco es POR QUÉ importa tanto aquí: es un iPad de pared y se lee de pie, a un brazo,
 * con prisa y con gente detrás. Un texto que en un monitor «se distingue», ahí no se lee
 * — y quien no lo lee no puede fichar.
 *
 * LO QUE ESTE ARNÉS NO PUEDE ALCANZAR, Y SE DICE EN VOZ ALTA.
 * El mensaje de «ese PIN no es correcto» no sale nunca aquí: en modo demostración
 * CUALQUIER PIN entra —`verify-pin` está escrito así a propósito, para que la
 * demostración se pueda recorrer— así que el estado de error es inalcanzable desde el
 * navegador. Ese par se comprueba en `src/theme/__tests__/tema.test.ts`, sobre los
 * tokens. Se imprime abajo para que nadie lea este arnés como si lo cubriera todo.
 */
/** Qué deuda conocida se ha topado de verdad, para poder decirla al final. */
const deudaVista = new Set();

for (const tema of TEMAS) {
  // iPad vertical: el aparato real. El kiosco de una tienda es esto, no un teléfono.
  const ctx = await navegador.newContext({
    viewport: { width: 834, height: 1112 },
    colorScheme: tema,
    ...CON_CAMARA,
  });
  const pag = await ctx.newPage();
  await sembrarKiosco(pag);

  /** Recorre el fichaje entero midiendo en cada parada. */
  const parar = async (nombre) => {
    const { fallos, medidos, saltados } = await medirContraste(pag, {
      minimo: MINIMO_TEXTO,
      minimoGrande: MINIMO_TEXTO_GRANDE,
      tamanoGrande: TAMANO_GRANDE,
    });
    let conocidos = 0;
    for (const f of fallos) {
      const deuda = tema === 'light' ? DEUDA_DE_CLARO.get(f.tinta) : undefined;
      if (deuda !== undefined) {
        conocidos += 1;
        deudaVista.add(deuda);
        continue;
      }
      problemas.push(
        `contraste en ${tema}, ${nombre}: «${f.texto}» a ${f.razon}:1 (hace falta ` +
          `${f.exigido}:1 con ${f.px}px) — ${f.tinta} sobre ${f.fondo}`,
      );
    }
    const nuevos = fallos.length - conocidos;
    console.log(
      `  ${tema.padEnd(5)} ${nombre.padEnd(22)} ${String(medidos).padStart(3)} textos, ` +
        `${nuevos === 0 ? 'todos legibles' : `${nuevos} ILEGIBLES`}` +
        `${conocidos > 0 ? ` (${conocidos} de deuda conocida)` : ''}` +
        `${saltados > 0 ? ` (${saltados} apagados, exentos)` : ''}`,
    );
    if (medidos === 0) {
      problemas.push(`contraste en ${tema}, ${nombre}: no se midió ni un texto`);
    }
  };

  await pag.goto(base + '/kiosk', { waitUntil: 'networkidle' });
  await pag.waitForTimeout(2800);
  await parar('reloj y teclado');

  // Con tres dígitos: puntos llenos y vacíos a la vez, que es como se ve de verdad.
  await pag.waitForSelector('[data-testid="keypad-1"]:visible', { timeout: 20000 });
  for (const d of ['1', '2', '3']) {
    await pag.locator(`[data-testid="keypad-${d}"]:visible`).first().click();
    await pag.waitForTimeout(150);
  }
  await parar('PIN a medio teclear');

  for (const d of ['4', '5', '6']) {
    await pag.locator(`[data-testid="keypad-${d}"]:visible`).first().click();
    await pag.waitForTimeout(150);
  }
  await pag.waitForTimeout(3200);
  await parar('acciones');

  // La parada de la cuenta atrás incluye el aviso de la foto y su recuadro: es la
  // tarjeta tal y como la ve quien ficha desde un navegador.
  if (await marcarEntrada(pag, `contraste en ${tema}`)) {
    await parar('cuenta atrás');
    if (await esperarResultado(pag, `contraste en ${tema}`)) {
      await parar('entrada registrada');
    }
  }

  await ctx.close();
}

console.log(
  '  nota: el estado «ese PIN no es correcto» NO se visita aquí — en demostración\n' +
    '        cualquier PIN entra. Ese contraste lo cubre src/theme/__tests__/tema.test.ts.',
);
for (const deuda of deudaVista) {
  console.log(`  deuda: se topó y se dejó pasar — ${deuda}`);
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nEL RELOJ NO ES USABLE EN:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  `\nOK: el teclado cabe y es tocable en los ${TAMANOS.length} tamaños × ${TEMAS.length} temas, ` +
    'y todo lo que se lee llega al contraste que pide su tamaño.',
);
