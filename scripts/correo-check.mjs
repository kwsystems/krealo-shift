#!/usr/bin/env node
/**
 * ¿SE ENTRA DE VERDAD CON UN ENLACE AL CORREO?
 *
 * POR QUÉ EXISTE. El 29-sep se añadió «Entrar con tu correo» para quien no usa Google.
 * Las pruebas de componente simulan Firebase, así que no ven lo que aquí importa: que el
 * enlace que manda Firebase, al abrirlo, vuelva a esta pantalla con su código y la app
 * entre. Ni que la dirección sobreviva al arranque —si algo redirigiera antes de leerla,
 * el código se perdería y el enlace no serviría para nada—.
 *
 * Se hace contra el EMULADOR DE AUTH, con un paquete construido para él y un proyecto de
 * demostración: no se manda ningún correo, no se toca producción, y el enlace se lee del
 * propio emulador, que guarda lo que habría enviado.
 *
 * Lo que se comprueba:
 *   1. el botón está, plegado, y el formulario no se sale a 390 ni a 1280;
 *   2. pedir el enlace dice a dónde llegó, y el emulador tiene un enlace para ese correo;
 *   3. abrirlo en el MISMO navegador entra sin volver a escribir nada;
 *   4. abrirlo en OTRO pide el correo, y con él entra;
 *   5. un enlace ya usado dice «ya se usó o caducó», no un error técnico.
 *
 * USO
 *   npm run correo:check
 *   (construye `dist-correo` y lo corre dentro de `emulators:exec --only auth`)
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { cargarPlaywright, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2] ?? 'dist-correo';
const PUERTO = 8219;
const CAPTURAS = process.env.CORREO_SHOTS ?? '/tmp/ks-correo';
const PROYECTO = 'demo-krealo-shift';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;

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
const navegador = await chromium.launch();

/** El último enlace que el emulador «mandó» a ese correo. */
async function enlaceDe(correo) {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${PROYECTO}/oobCodes`);
  const { oobCodes = [] } = await res.json();
  const suyos = oobCodes.filter((c) => c.email === correo && c.requestType === 'EMAIL_SIGNIN');
  return suyos.at(-1)?.oobLink ?? null;
}

/** La cuenta del emulador con ese correo, si existe. */
async function cuentaDe(correo) {
  const res = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROYECTO}/accounts:query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ returnUserInfo: true }),
    },
  );
  const { userInfo = [] } = await res.json();
  return userInfo.find((u) => u.email === correo) ?? null;
}

async function abrirAcceso(pagina) {
  await pagina.goto(`${base}/sign-in`, { waitUntil: 'networkidle' });
  await pagina.locator('[data-testid="sign-in-email-open"]').waitFor({ timeout: 30000 });
}

async function pedirEnlace(pagina, correo) {
  await pagina.locator('[data-testid="sign-in-email-open"]').click();
  await pagina.locator('[data-testid="sign-in-email-field"]').fill(correo);
  await pagina.locator('[data-testid="sign-in-email-send"]').click();
  await pagina.locator('[data-testid="sign-in-email-sent"]').waitFor({ timeout: 20000 });
}

/** Se entró: el formulario de acceso ya no está y la cuenta existe, verificada. */
async function entro(pagina, correo) {
  try {
    await pagina
      .locator('[data-testid="sign-in-google"]')
      .waitFor({ state: 'detached', timeout: 30000 });
  } catch {
    return 'la pantalla de acceso sigue ahí';
  }
  const cuenta = await cuentaDe(correo);
  if (cuenta === null) return 'el emulador no tiene la cuenta';
  if (cuenta.emailVerified !== true) return 'la cuenta no quedó con el correo verificado';
  return null;
}

try {
  /* ------------------------------------------------------------------ */
  const caso1 = 'el botón está plegado y el formulario cabe';
  const cabe = [];
  for (const [ancho, alto] of [
    [390, 844],
    [1280, 900],
  ]) {
    const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
    const pagina = await ctx.newPage();
    await abrirAcceso(pagina);
    const abierto = await pagina.locator('[data-testid="sign-in-email-field"]').count();
    await pagina.locator('[data-testid="sign-in-email-open"]').click();
    await pagina.locator('[data-testid="sign-in-email-field"]').waitFor();
    const desborde = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await pagina.screenshot({ path: join(CAPTURAS, `1-formulario-${ancho}.png`) });
    if (abierto > 0) cabe.push(`${ancho}: el formulario ya estaba abierto`);
    if (desborde > 1) cabe.push(`${ancho}: la página se arrastra ${desborde} px de lado`);
    await ctx.close();
  }
  if (cabe.length > 0) fallar(caso1, cabe.join('; '));
  else pasa(caso1, '390 y 1280 sin arrastre lateral');

  /* ------------------------------------------------------------------ */
  const caso2 = 'pedir el enlace dice a dónde llegó';
  const correoA = 'invitada-prueba@example.com';
  const ctxA = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const paginaA = await ctxA.newPage();
  await abrirAcceso(paginaA);
  await pedirEnlace(paginaA, correoA);
  const textoEnviado = await paginaA.locator('[data-testid="sign-in-email-sent"]').innerText();
  const enlaceA = await enlaceDe(correoA);
  await paginaA.screenshot({ path: join(CAPTURAS, '2-enviado.png') });
  if (!textoEnviado.includes(correoA)) fallar(caso2, `no nombra el correo: «${textoEnviado}»`);
  else if (enlaceA === null) fallar(caso2, 'el emulador no recibió ningún enlace para ese correo');
  else pasa(caso2, 'y el emulador tiene el enlace');

  /* ------------------------------------------------------------------ */
  const caso3 = 'abierto en el mismo navegador, entra sin escribir nada';
  if (enlaceA !== null) {
    await paginaA.goto(enlaceA, { waitUntil: 'networkidle' });
    const motivo = await entro(paginaA, correoA);
    await paginaA.screenshot({ path: join(CAPTURAS, '3-dentro.png') });
    if (motivo !== null) fallar(caso3, motivo);
    else {
      const url = paginaA.url();
      if (url.includes('oobCode='))
        fallar(caso3, `entró, pero la dirección conserva el código: ${url}`);
      else pasa(caso3, 'y la dirección queda limpia');
    }
  }
  await ctxA.close();

  /* ------------------------------------------------------------------ */
  const caso4 = 'abierto en otro dispositivo, pide el correo y con él entra';
  const correoB = 'otra-prueba@example.com';
  const ctxPide = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pide = await ctxPide.newPage();
  await abrirAcceso(pide);
  await pedirEnlace(pide, correoB);
  await ctxPide.close();
  const enlaceB = await enlaceDe(correoB);
  const ctxOtro = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const otro = await ctxOtro.newPage();
  if (enlaceB === null) {
    fallar(caso4, 'no hay enlace para el segundo correo');
  } else {
    await otro.goto(enlaceB, { waitUntil: 'networkidle' });
    try {
      await otro.locator('[data-testid="sign-in-email-complete"]').waitFor({ timeout: 30000 });
      await otro.screenshot({ path: join(CAPTURAS, '4-confirmar.png') });
      await otro.locator('[data-testid="sign-in-email-field"]').fill(correoB);
      await otro.locator('[data-testid="sign-in-email-complete"]').click();
      const motivo = await entro(otro, correoB);
      if (motivo !== null) fallar(caso4, motivo);
      else pasa(caso4);
    } catch {
      const texto = (await otro.innerText('body')).replace(/\s+/g, ' ').slice(0, 200);
      await otro.screenshot({ path: join(CAPTURAS, '4-error.png') });
      fallar(caso4, `no pidió el correo para confirmar. Pantalla (${otro.url()}): ${texto}`);
    }
  }
  await ctxOtro.close();

  /* ------------------------------------------------------------------ */
  const caso5 = 'un enlace ya usado lo dice en palabras';
  const ctxUsado = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const usado = await ctxUsado.newPage();
  if (enlaceA !== null) {
    await usado.goto(enlaceA, { waitUntil: 'networkidle' });
    await usado.locator('[data-testid="sign-in-email-field"]').waitFor({ timeout: 30000 });
    await usado.locator('[data-testid="sign-in-email-field"]').fill(correoA);
    await usado.locator('[data-testid="sign-in-email-complete"]').click();
    try {
      await usado.locator('[data-testid="sign-in-email-error"]').waitFor({ timeout: 20000 });
      const texto = await usado.locator('[data-testid="sign-in-email-error"]').innerText();
      await usado.screenshot({ path: join(CAPTURAS, '5-usado.png') });
      if (!/ya se usó o caducó/.test(texto)) fallar(caso5, `dice «${texto}»`);
      else pasa(caso5, texto);
    } catch {
      fallar(caso5, 'no dijo nada');
    }
  }
  await ctxUsado.close();
} catch (error) {
  fallar('el arnés no pudo completar la medida', error.message.split('\n')[0]);
} finally {
  await navegador.close();
  await cerrar();
}

if (problemas.length > 0) {
  console.error(`\nCORREO — FALLA (${problemas.length})`);
  process.exit(1);
}
console.log(
  '\nCORREO — OK: se pide el enlace, se entra con él en el mismo navegador y en otro, y uno usado lo dice.',
);
