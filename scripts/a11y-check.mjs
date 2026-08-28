/**
 * Auditoría de accesibilidad sobre la app REAL en un navegador (§21).
 *
 * Comprueba las cuatro cosas de §21 que se pueden medir sin un dispositivo:
 *   - contraste WCAG AA (4.5:1 texto normal, 3:1 texto grande);
 *   - que todo elemento interactivo tenga nombre accesible;
 *   - que ningún objetivo táctil quede por debajo de 44x44;
 *   - que con el texto al 150% no se desborde en horizontal.
 *
 * LO QUE ESTO NO SUSTITUYE, y conviene no confundirlo: VoiceOver de verdad, el
 * orden de foco percibido, y el teclado externo en iPad. Eso exige dispositivo.
 * Esto cubre lo medible, que es la mayor parte y la que se rompe sin avisar.
 *
 * USO
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx expo export --platform web --clear --output-dir /tmp/ks-web
 *   node scripts/a11y-check.mjs /tmp/ks-web
 *
 * NOTA SOBRE UN FALSO POSITIVO QUE COSTO UN RATO: la primera version marcaba el
 * icono del indicador de sincronizacion por 4.24:1 frente al minimo de 4.5. No era
 * un fallo: es un GLIFO DE FUENTE DE ICONOS, y WCAG le aplica el criterio 1.4.11
 * de contraste no textual, que pide 3:1. Los iconos se excluyen del chequeo de
 * texto y se comprueban contra 3:1. Marcar iconos como texto habria llevado a
 * "arreglar" una paleta que estaba bien.
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright/index.js');
}

const RAIZ = process.argv[2];
if (!RAIZ) {
  console.error('Uso: node scripts/a11y-check.mjs <directorio-del-export>');
  process.exit(2);
}
const PUERTO = 8111;

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.jpg': 'image/jpeg',
};

// Respaldo de SPA: el proyecto usa `web.output: 'single'`, asi que solo existe
// index.html y la ruta la resuelve el router en el navegador.
function resolver(url) {
  const limpio = decodeURIComponent(url.split('?')[0]);
  const d = join(RAIZ, limpio);
  if (existsSync(d) && statSync(d).isFile()) return d;
  if (existsSync(d) && statSync(d).isDirectory()) {
    const i = join(d, 'index.html');
    if (existsSync(i)) return i;
  }
  const raiz = join(RAIZ, 'index.html');
  return existsSync(raiz) ? raiz : null;
}

const servidor = createServer(async (req, res) => {
  const f = resolver(req.url ?? '/');
  if (!f) return res.writeHead(404).end('no');
  res.writeHead(200, { 'Content-Type': TIPOS[extname(f)] ?? 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => servidor.listen(PUERTO, '127.0.0.1', r));

const browser = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
});

const RUTAS = [
  ['kiosco', '/kiosk'],
  ['kiosco-ayuda', '/kiosk/help'],
  ['kiosco-salida', '/kiosk/exit'],
  ['kiosco-setup', '/kiosk/setup'],
  ['acceso', '/sign-in'],
  ['restablecer', '/restablecer'],
];

// ---- Contraste WCAG: relacion de luminancia relativa ----
const CONTRASTE = `(() => {
  function lum(c) {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function parse(s) {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length > 3 && p[3] === 0) return null;
    return [p[0], p[1], p[2]];
  }
  function fondoEfectivo(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg) return bg;
      n = n.parentElement;
    }
    return [255, 255, 255];
  }
  const malos = [];
  for (const el of document.querySelectorAll('*')) {
    const txt = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
      .trim();
    if (!txt) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) continue;
    const fg = parse(st.color);
    if (!fg) continue;
    const bg = fondoEfectivo(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(st.fontSize);

    // Un glifo de fuente de iconos es un ICONO, no texto: WCAG le aplica el
    // criterio 1.4.11 (contraste no textual, 3:1) y no el 1.4.3 de texto.
    const esIcono = /ionicon|material|fontawesome|feather|glyph/i.test(st.fontFamily);
    const grande = px >= 24 || (px >= 18.66 && parseInt(st.fontWeight, 10) >= 700);
    const minimo = esIcono ? 3.0 : grande ? 3.0 : 4.5;
    if (ratio < minimo) {
      malos.push({
        texto: txt.slice(0, 40),
        ratio: Math.round(ratio * 100) / 100,
        minimo,
        px: Math.round(px),
        color: st.color,
        fondo: 'rgb(' + bg.join(',') + ')',
        tipo: esIcono ? 'icono' : 'texto',
      });
    }
  }
  return malos;
})()`;

// ---- Elementos interactivos sin nombre accesible, y tamaño de objetivo ----
const INTERACTIVOS = `(() => {
  const sel = 'button, a, [role=button], [role=link], input, [tabindex]:not([tabindex="-1"])';
  const res = { sinNombre: [], pequenos: [] };
  for (const el of document.querySelectorAll(sel)) {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const nombre = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      el.getAttribute('placeholder') ||
      ''
    ).trim();

    if (!nombre) {
      res.sinNombre.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        testid: el.getAttribute('data-testid') || '',
        clase: (el.className || '').toString().slice(0, 40),
      });
    }
    if (r.width < 44 || r.height < 44) {
      res.pequenos.push({
        nombre: nombre.slice(0, 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }
  return res;
})()`;

let problemas = 0;

for (const [nombre, ruta] of RUTAS) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PUERTO}${ruta}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('\n========== ' + nombre + ' (' + ruta + ')');

  const contraste = await page.evaluate(CONTRASTE);
  problemas += contraste.length;
  if (contraste.length === 0) console.log('  contraste: todo cumple WCAG AA');
  else {
    console.log('  CONTRASTE INSUFICIENTE (' + contraste.length + '):');
    for (const c of contraste.slice(0, 8)) {
      console.log(`    "${c.texto}" ${c.ratio}:1 (min ${c.minimo}) ${c.px}px ${c.color} sobre ${c.fondo}`);
    }
  }

  const inter = await page.evaluate(INTERACTIVOS);
  problemas += inter.sinNombre.length + inter.pequenos.length;
  if (inter.sinNombre.length === 0) console.log('  nombres: todos los interactivos tienen nombre');
  else {
    console.log('  SIN NOMBRE ACCESIBLE (' + inter.sinNombre.length + '):');
    for (const e of inter.sinNombre.slice(0, 8)) console.log('   ', JSON.stringify(e));
  }
  if (inter.pequenos.length === 0) console.log('  objetivos: todos >= 44x44');
  else {
    console.log('  OBJETIVO MENOR DE 44x44 (' + inter.pequenos.length + '):');
    for (const e of inter.pequenos.slice(0, 8)) console.log(`    "${e.nombre}" ${e.w}x${e.h}`);
  }

  // Tamaño dinamico al 150%: la especificacion pide que no se corten acciones criticas.
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
  await page.waitForTimeout(600);
  const desborde = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth + 2,
    ancho: document.documentElement.scrollWidth,
    ventana: window.innerWidth,
  }));
  if (desborde.horizontal) problemas += 1;
  console.log(`  texto 150%: ${desborde.horizontal ? 'DESBORDA en horizontal (' + desborde.ancho + ' > ' + desborde.ventana + ')' : 'sin desborde horizontal'}`);

  await ctx.close();
}

await browser.close();
servidor.close();

if (problemas > 0) {
  console.error(`\n${problemas} problemas de accesibilidad.`);
  process.exit(1);
}
console.log('\nSin problemas de accesibilidad medibles.');
