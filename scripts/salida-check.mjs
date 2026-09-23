#!/usr/bin/env node
/**
 * ¿PREGUNTA EL RELOJ POR QUÉ TE VAS ANTES DE HORA?
 *
 * POR QUÉ EXISTE ESTE ARNÉS Y NO BASTA CON LAS OTRAS PRUEBAS
 * El fallo que vigila no es que la regla esté mal —eso lo cubren las pruebas de
 * `src/domain/early-departure-reason.ts`, y que el motivo se guarde lo cubre la prueba
 * con emulador—. Es el fallo propio de este proyecto: que el dato exista en los dos
 * extremos y la pantalla no aparezca nunca. Ya pasó cinco veces con `flags`,
 * `shiftEndsAt`, `openBreak`, `jobRoleName` y `paidBreakReasons`: cinco campos
 * declarados, compilando y muertos.
 *
 * Aquí se ficha una salida DE VERDAD en un navegador y se comprueba que la hoja sale,
 * que trae los seis motivos, y que elegir uno lleva a la confirmación en vez de dejar
 * la pantalla colgada. Y también el otro lado, que es la mitad que se olvida: que
 * CANCELAR no fiche la salida.
 *
 * USO
 *   npm run demo:export
 *   node scripts/salida-check.mjs dist-demo
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { cargarPlaywright, sembrarKiosco, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-demo';
const PUERTO = 8212;
const CAPTURAS = process.env.SALIDA_SHOTS ?? '/tmp/ks-salida';

/** Los seis motivos, tal como los nombra `src/domain/early-departure-reason.ts`. */
const MOTIVOS = ['agreed_end', 'errand', 'medical', 'permit', 'emergency', 'other'];

const problemas = [];
const fallar = (caso, detalle) => {
  problemas.push(`${caso}: ${detalle}`);
  console.log(`FALLA  ${caso}\n       ${detalle}`);
};
const pasa = (caso, detalle = '') =>
  console.log(`ok     ${caso}${detalle ? `  — ${detalle}` : ''}`);

await mkdir(CAPTURAS, { recursive: true });

const { base, cerrar } = await servirExport(RAIZ, PUERTO);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

/**
 * Teclea los seis dígitos. En la demostración cualquier PIN entra.
 *
 * ESPERA A QUE EL TECLADO SEA VISIBLE, no a que exista: tras un fichaje el reloj deja la
 * tarjeta de resultado cuatro segundos y vuelve solo a reposo (§9.5). Durante esos
 * segundos los botones del teclado están en el árbol pero ocultos, así que buscarlos por
 * existencia los encuentra y el clic no llega a ninguna parte.
 */
async function teclearPin(pagina) {
  await pagina.locator('[data-testid="keypad-1"]:visible').waitFor({ timeout: 40000 });
  for (const digito of ['1', '2', '3', '4', '5', '6']) {
    await pagina.locator(`[data-testid="keypad-${digito}"]:visible`).click();
  }
}

/**
 * Deja la pantalla de acciones abierta con una jornada YA EMPEZADA.
 *
 * Hay que fichar la entrada primero: la demostración arranca fuera de turno, y estando
 * fuera de turno la única acción que ofrece es entrar. O sea que para llegar a probar la
 * salida hay que hacer antes la jornada completa que hace una persona —PIN, entrada,
 * esperar a que el reloj vuelva a reposo, PIN otra vez— y eso es exactamente lo que
 * conviene que haga el arnés, porque es el camino real.
 */
async function hastaLasAcciones(pagina) {
  await sembrarKiosco(pagina);
  await pagina.goto(base + '/kiosk', { waitUntil: 'networkidle' });

  await teclearPin(pagina);

  const salida = pagina.locator('[data-testid="kiosk-action-clock_out"]:visible');
  const entrada = pagina.locator('[data-testid="kiosk-action-clock_in"]:visible');
  await Promise.race([
    salida.waitFor({ timeout: 20000 }).catch(() => undefined),
    entrada.waitFor({ timeout: 20000 }).catch(() => undefined),
  ]);

  if ((await salida.count()) > 0) return true;
  if ((await entrada.count()) === 0) return false;

  // Fuera de turno: se ficha la entrada y se espera a que el reloj vuelva al teclado.
  await entrada.click();
  const cuenta = pagina.locator('[data-testid="kiosk-confirm-countdown"]:visible');
  const sinFoto = pagina.locator('[data-testid="kiosk-photo-required"]:visible');
  await Promise.race([
    cuenta.waitFor({ timeout: 15000 }).catch(() => undefined),
    sinFoto.waitFor({ timeout: 15000 }).catch(() => undefined),
  ]);
  if ((await sinFoto.count()) > 0) return false;

  await pagina
    .locator('[data-testid="kiosk-result"]:visible')
    .waitFor({ timeout: 20000 })
    .catch(() => undefined);

  await teclearPin(pagina);
  await salida.waitFor({ timeout: 20000 }).catch(() => undefined);
  return (await salida.count()) > 0;
}

// ---------------------------------------------------------------------------
// 1. Al salir antes de hora, el reloj pregunta
// ---------------------------------------------------------------------------
{
  const caso = 'la hoja de motivo sale al fichar salida antes de hora';
  const ctx = await navegador.newContext({ viewport: { width: 1024, height: 1366 } });
  const pagina = await ctx.newPage();

  if (!(await hastaLasAcciones(pagina))) {
    fallar(caso, 'no llegué al botón de salida: la demostración no dejó una jornada abierta');
  } else {
    await pagina.locator('[data-testid="kiosk-action-clock_out"]:visible').click();

    const hoja = pagina.locator('[data-testid="early-departure-sheet"]:visible');
    await hoja.waitFor({ timeout: 10000 }).catch(() => undefined);
    // La hoja entra con animación: sin este respiro la captura sale del fotograma cero.
    await pagina.waitForTimeout(700);
    await pagina.screenshot({ path: join(CAPTURAS, 'hoja-motivo.png') });

    if ((await hoja.count()) === 0) {
      const texto = (await pagina.innerText('body')).replace(/\s+/g, ' ').slice(0, 200);
      fallar(caso, `la hoja no apareció en 10 s. Pantalla: ${texto}`);
    } else {
      const faltan = [];
      for (const motivo of MOTIVOS) {
        if ((await pagina.locator(`[data-testid="departure-reason-${motivo}"]`).count()) === 0) {
          faltan.push(motivo);
        }
      }
      if (faltan.length > 0) {
        fallar(caso, `la hoja salió pero le faltan motivos: ${faltan.join(', ')}`);
      } else {
        // Y que diga a qué hora terminaba el turno: es el dato que justifica la pregunta.
        const texto = await hoja.innerText();
        if (!/\d{1,2}[:.]\d{2}/.test(texto)) {
          fallar(
            caso,
            `la hoja no dice a qué hora termina el turno. Texto: ${texto.slice(0, 160)}`,
          );
        } else {
          pasa(caso, `${MOTIVOS.length} motivos y la hora de fin`);
        }
      }
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2. Elegir un motivo lleva a la confirmación, no a una pantalla colgada
// ---------------------------------------------------------------------------
{
  const caso = 'elegir un motivo continúa a la confirmación';
  const ctx = await navegador.newContext({ viewport: { width: 1024, height: 1366 } });
  const pagina = await ctx.newPage();

  if (!(await hastaLasAcciones(pagina))) {
    fallar(caso, 'no llegué al botón de salida');
  } else {
    await pagina.locator('[data-testid="kiosk-action-clock_out"]:visible').click();
    const boton = pagina.locator('[data-testid="departure-reason-errand"]:visible');
    await boton.waitFor({ timeout: 10000 }).catch(() => undefined);

    if ((await boton.count()) === 0) {
      fallar(caso, 'no salió el motivo «Mandado / otra sede»');
    } else {
      await boton.click();
      /*
       * La confirmación es la cuenta atrás cancelable, o directamente la pantalla de
       * «hace falta foto» si la cámara no está: las dos son un estado final legítimo.
       * Lo que NO puede pasar es quedarse en la hoja.
       */
      const cuenta = pagina.locator('[data-testid="kiosk-confirm-countdown"]:visible');
      const sinFoto = pagina.locator('[data-testid="kiosk-photo-required"]:visible');
      await Promise.race([
        cuenta.waitFor({ timeout: 15000 }).catch(() => undefined),
        sinFoto.waitFor({ timeout: 15000 }).catch(() => undefined),
      ]);
      await pagina.screenshot({ path: join(CAPTURAS, 'tras-elegir-motivo.png') });

      const llego = (await cuenta.count()) > 0 || (await sinFoto.count()) > 0;
      const sigueLaHoja =
        (await pagina.locator('[data-testid="early-departure-sheet"]:visible').count()) > 0;

      if (!llego) {
        fallar(caso, sigueLaHoja ? 'se quedó en la hoja de motivos' : 'no llegó a ningún estado');
      } else {
        pasa(caso, (await cuenta.count()) > 0 ? 'cuenta atrás' : 'pidió foto');
      }
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. Cancelar NO ficha la salida
// ---------------------------------------------------------------------------
//
// LA MITAD QUE SE OLVIDA. Una hoja que se cierra pero deja el fichaje hecho es peor que
// no preguntar: la persona cree que canceló y ya está fuera de turno.
{
  const caso = 'cancelar la hoja no ficha la salida';
  const ctx = await navegador.newContext({ viewport: { width: 1024, height: 1366 } });
  const pagina = await ctx.newPage();

  if (!(await hastaLasAcciones(pagina))) {
    fallar(caso, 'no llegué al botón de salida');
  } else {
    await pagina.locator('[data-testid="kiosk-action-clock_out"]:visible').click();
    const hoja = pagina.locator('[data-testid="early-departure-sheet"]:visible');
    await hoja.waitFor({ timeout: 10000 }).catch(() => undefined);

    if ((await hoja.count()) === 0) {
      fallar(caso, 'la hoja no apareció, así que no hay nada que cancelar');
    } else {
      await hoja.getByRole('button').last().click();
      await pagina.waitForTimeout(800);
      await pagina.screenshot({ path: join(CAPTURAS, 'tras-cancelar.png') });

      const cuenta = await pagina
        .locator('[data-testid="kiosk-confirm-countdown"]:visible')
        .count();
      const resultado = await pagina.locator('[data-testid="kiosk-result"]:visible').count();
      const vuelveLaSalida = await pagina
        .locator('[data-testid="kiosk-action-clock_out"]:visible')
        .count();

      if (cuenta > 0 || resultado > 0) {
        fallar(caso, 'cancelar acabó fichando la salida igualmente');
      } else if (vuelveLaSalida === 0) {
        fallar(caso, 'cancelar cerró la hoja pero no devolvió a la pantalla de acciones');
      } else {
        pasa(caso, 'vuelve a acciones sin fichar');
      }
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 4. Fichar no deja pantallas colgadas
// ---------------------------------------------------------------------------
//
// EL RELOJ NO SE APAGA EN TODO EL DIA, y la pantalla de reposo repinta su reloj cada
// segundo. Con `push` al entrar y `replace` al volver, la pila crecia y quedaba una
// pantalla de reposo montada e invisible por debajo: dos temporizadores corriendo, uno
// de ellos para nada.
//
// Y ademas envenena cualquier prueba: un `testID` del reloj pasa a encontrar DOS
// elementos, uno invisible, y los clics se van al que no se ve. Costo un rato descubrirlo
// al escribir este mismo arnes.
{
  const caso = 'fichar no deja pantallas de reposo colgadas';
  const ctx = await navegador.newContext({ viewport: { width: 1024, height: 1366 } });
  const pagina = await ctx.newPage();

  const contar = () =>
    pagina.evaluate(() => document.querySelectorAll('[data-testid="kiosk-idle"]').length);

  await sembrarKiosco(pagina);
  await pagina.goto(base + '/kiosk', { waitUntil: 'networkidle' });
  /*
   * SE ESPERA A QUE LA PANTALLA ESTÉ, no un número de milisegundos. Con una espera fija
   * de 1200 ms una pasada contó CERO pantallas de reposo antes de fichar, y cero contra
   * cero habría dado este caso por bueno sin medir nada. Un arnés que puede pasar por
   * llegar temprano no es un arnés.
   */
  await pagina
    .locator('[data-testid="kiosk-idle"]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => undefined);
  const antes = await contar();

  if (antes !== 1) {
    // No es un fallo del reloj: es que el arnés no está midiendo lo que cree.
    fallar(caso, `al abrir el reloj esperaba 1 pantalla de reposo montada y conté ${antes}`);
  } else if (!(await hastaLasAcciones(pagina))) {
    fallar(caso, 'no llegué a fichar');
  } else {
    // Volver a reposo: se ficha la salida y se espera a que el reloj vuelva solo.
    await pagina.locator('[data-testid="kiosk-action-clock_out"]:visible').click();
    const hoja = pagina.locator('[data-testid="early-departure-sheet"]:visible');
    await hoja.waitFor({ timeout: 10000 }).catch(() => undefined);
    if ((await hoja.count()) > 0) {
      await pagina.locator('[data-testid="departure-reason-agreed_end"]:visible').click();
    }
    await pagina
      .locator('[data-testid="kiosk-result"]:visible')
      .waitFor({ timeout: 20000 })
      .catch(() => undefined);
    await teclearPin(pagina).catch(() => undefined);

    const despues = await contar();
    if (despues > antes) {
      fallar(
        caso,
        `antes de fichar había ${antes} pantalla(s) de reposo montada(s) y después ${despues}: ` +
          'la pila del reloj está creciendo',
      );
    } else {
      pasa(caso, `${antes} montada(s) antes de fichar y ${despues} después: no crece`);
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 5. Lo que se ficha en el reloj APARECE en el panel
// ---------------------------------------------------------------------------
//
// EL PRIMER RECORRIDO QUE INTENTA CUALQUIERA: marco, y lo veo. Estaba roto y lo encontró
// Andree probando — fichó entrada y preguntó dónde verlo, y la respuesta era «en ningún
// sitio»: el reloj de la demostración solo guardaba el estado, no creaba ni el evento ni
// la sesión.
//
// Se comprueba EN EL PANEL y no en el almacén: que la fila exista no sirve de nada si la
// pantalla no la pinta, que es justo la clase de fallo que este proyecto persigue.
//
// Va dentro de una función para poder RENDIRSE A MEDIAS con un `return`. Con banderas
// quedaba un caso que anotaba el fallo y seguía ejecutando pasos sobre una pantalla que
// ya no era la que esperaba, y el segundo error tapaba al primero.
await (async () => {
  const caso = 'lo que se ficha en el reloj aparece en el panel';
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 1000 } });
  const pagina = await ctx.newPage();
  const rendirse = async (detalle) => {
    fallar(caso, detalle);
    await pagina.screenshot({ path: join(CAPTURAS, 'panel-sin-fichaje.png') }).catch(() => {});
    await ctx.close();
  };

  /*
   * SE FICHA AQUÍ MISMO Y SE LEE LA HORA DEL RESULTADO: «Entrada registrada a las 09:51».
   * Esa hora es lo que ata este caso al fichaje que se acaba de hacer.
   *
   * DOS INTENTOS ANTERIORES NO SERVÍAN, y las dos lecciones valen:
   *  - comprobar solo que Horas enseñara «alguna» sesión pasaba igual con la
   *    reconstrucción apagada, porque la semilla ya trae 14. Lo desmintió el control, y
   *    es el patrón de los campos muertos en forma de arnés;
   *  - leer «Trabajando desde …» de la pantalla de acciones tampoco: en la demostración
   *    ese dato sale de la respuesta enlatada del PIN —una sesión de hace tres horas— y
   *    no del fichaje recién hecho.
   */
  await sembrarKiosco(pagina);
  await pagina.goto(base + '/kiosk', { waitUntil: 'networkidle' });
  /*
   * El teclado se espera con `catch`: una vez tardó más de los 40 s en aparecer en este
   * quinto contexto del navegador y `teclearPin` lanzó, matando el guion entero con una
   * traza en vez de un fallo con nombre. Un arnés tiene que decir QUÉ falló.
   */
  try {
    await teclearPin(pagina);
  } catch {
    return rendirse('el teclado del reloj no apareció a tiempo');
  }
  await pagina.waitForTimeout(2500);

  const accion = pagina.locator('[data-testid^="kiosk-action-"]:visible').first();
  await accion.waitFor({ timeout: 20000 }).catch(() => undefined);
  if ((await accion.count()) === 0) return rendirse('no llegué a los botones de fichar');
  await accion.click();

  // Una salida abre antes la hoja de motivo; se elige uno y sigue.
  const hojaMotivo = pagina.locator('[data-testid="early-departure-sheet"]:visible');
  await hojaMotivo.waitFor({ timeout: 4000 }).catch(() => undefined);
  if ((await hojaMotivo.count()) > 0) {
    await pagina.locator('[data-testid="departure-reason-agreed_end"]:visible').click();
  }

  const resultado = pagina.locator('[data-testid="kiosk-result"]:visible');
  await resultado.waitFor({ timeout: 25000 }).catch(() => undefined);
  if ((await resultado.count()) === 0) return rendirse('el fichaje no llegó a un resultado');

  const textoResultado = (await resultado.innerText()).replace(/\s+/g, ' ');
  const alas = /a las (\d{1,2}:\d{2})/.exec(textoResultado)?.[1];
  if (alas === undefined) {
    return rendirse(`el resultado no dice la hora. Texto: ${textoResultado.slice(0, 160)}`);
  }

  /*
   * TODO EL CAMINO DE VUELTA ES DENTRO DE LA APP, sin un solo `goto`.
   *
   * Dos razones, y las dos se descubrieron haciendo fallar este caso:
   *  - el almacén de la demostración vive en memoria, así que una recarga lo reinicia y
   *    el fichaje se pierde (el aviso amarillo lo dice);
   *  - y con el reloj montado, `app/index.tsx` REDIRIGE cualquier ruta del panel a
   *    `/kiosk`. Escribir `/hours` en la barra devuelve el teclado, que es lo correcto
   *    —un reloj de la pared no debe poder llegar al panel— pero hace que un `goto` no
   *    sirva para probar esto.
   *
   * El camino real es el gesto oculto: mantener pulsado el logo abre la salida del
   * kiosco, y al desactivarlo se vuelve al panel con el almacén intacto.
   */
  // El reloj vuelve solo a reposo cuatro segundos después del resultado (§9.5).
  const reposo = pagina.locator('[data-testid="kiosk-idle"]').first();
  await reposo.waitFor({ timeout: 20000 }).catch(() => undefined);
  if ((await reposo.count()) === 0) return rendirse('no volví a la pantalla de reposo');

  const logo = pagina.locator('[data-testid="kiosk-logo"]').first();
  if ((await logo.count()) === 0) return rendirse('no encontré el logo del reloj');
  const caja = await logo.boundingBox();
  if (caja === null) return rendirse('el logo del reloj no tiene tamaño en pantalla');

  await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  /*
   * TRES SEGUNDOS Y MEDIO, no uno y medio. El gesto pide `EXIT_LONG_PRESS_MS = 3000`
   * (`app/kiosk/index.tsx`) y con 1500 ms no disparaba: el clic se contaba como pulsación
   * corta, la pantalla no cambiaba, y el PIN que se teclea a continuación entraba por el
   * teclado del RELOJ en vez de por el de la salida — así que el caso acababa en
   * `/kiosk/actions` diciendo que no encontraba el botón de salir. Son tres segundos
   * largos a propósito: es un gesto oculto que no puede dispararse por accidente.
   */
  await pagina.mouse.down();
  await pagina.waitForTimeout(3500);
  await pagina.mouse.up();
  await pagina.waitForTimeout(1500);

  // La salida pide el PIN de un gerente. En demostración cualquiera entra.
  if ((await pagina.locator('[data-testid="keypad-1"]:visible').count()) > 0) {
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      await pagina.locator(`[data-testid="keypad-${d}"]:visible`).click();
    }
    await pagina.waitForTimeout(2000);
  }

  const salir = pagina.locator('[data-testid="kiosk-exit-confirm"]:visible');
  await salir.waitFor({ timeout: 10000 }).catch(() => undefined);
  if ((await salir.count()) === 0) {
    return rendirse(
      `no llegué al botón de salir del kiosco (ruta ${new URL(pagina.url()).pathname})`,
    );
  }
  await salir.click();
  await pagina.waitForTimeout(3000);

  const acceso = pagina.locator('[data-testid="sign-in-demo"]:visible');
  if ((await acceso.count()) > 0) {
    await acceso.click();
    await pagina.waitForTimeout(2500);
  }

  // Y a Horas por el menú, que también es navegación interna.
  await pagina
    .getByText('Horas', { exact: true })
    .locator('visible=true')
    .first()
    .click()
    .catch(() => undefined);
  await pagina.waitForTimeout(3000);
  await pagina.screenshot({ path: join(CAPTURAS, 'horas-tras-fichar.png') });

  const filas = await pagina.locator('[data-testid^="session-"]').count();
  if (filas === 0) {
    const texto = (await pagina.innerText('body')).replace(/\s+/g, ' ');
    return rendirse(`Horas no enseñó ninguna sesión. Pantalla: ${texto.slice(0, 200)}`);
  }

  // Y que esté LA DEL FICHAJE, no solo las sembradas: la que empieza a esa hora.
  const enHoras = (await pagina.innerText('body')).replace(/\s+/g, ' ');
  if (!enHoras.includes(alas)) {
    return rendirse(
      `Horas enseña ${filas} sesión(es) pero ninguna a las ${alas}, que es la hora ` +
        'del fichaje que acabo de hacer en el reloj',
    );
  }

  pasa(caso, `la sesión de las ${alas} está entre las ${filas} de Horas`);
  await ctx.close();
})();

await navegador.close();
await cerrar();

console.log(`\nCapturas en ${CAPTURAS}\n`);
if (problemas.length > 0) {
  console.log(`${problemas.length} problema(s):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('El reloj pregunta por qué te vas antes, y cancelar no ficha.');
