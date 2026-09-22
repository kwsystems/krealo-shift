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

await navegador.close();
await cerrar();

console.log(`\nCapturas en ${CAPTURAS}\n`);
if (problemas.length > 0) {
  console.log(`${problemas.length} problema(s):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('El reloj pregunta por qué te vas antes, y cancelar no ficha.');
