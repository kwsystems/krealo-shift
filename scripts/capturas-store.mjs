/**
 * Capturas para la App Store, en los tamanos exactos que Apple exige.
 *
 * POR QUE UN SCRIPT Y NO CAPTURAS A MANO
 * Las capturas caducan: cada cambio de la pantalla de reposo del kiosco las deja
 * mintiendo, y rehacerlas a mano en dos idiomas y tres tamanos son 24 capturas que nadie
 * va a repetir. Asi que se generan, y el trabajo que no se pudre es este archivo.
 *
 * TAMANOS. App Store Connect acepta un juego de iPhone 6.9" y uno de iPad 13":
 *   iPhone 6.9"        1290 x 2796   (vertical)
 *   iPad 13" vertical  2048 x 2732
 *   iPad 13" horizontal 2732 x 2048
 * Se llega a esos pixeles con un viewport en puntos por un factor de escala, igual que
 * un dispositivo real. Y NO SE DA POR BUENO: al final se lee la cabecera de cada PNG y
 * se compara con el tamano pedido, porque Apple rechaza una captura de un pixel de mas y
 * un script que afirma un tamano sin comprobarlo es exactamente el tipo de asercion que
 * no acusa nada.
 *
 * QUE SE PUEDE CAPTURAR SIN SERVIDOR, Y QUE NO
 * El kiosco y el acceso, si: el kiosco se abre sembrando su credencial en localStorage,
 * igual que el chequeo de interaccion. El PANEL ADMINISTRATIVO no, porque necesita una
 * sesion real contra un Supabase real.
 *
 * Por eso el script acepta credenciales por entorno y, si estan, entra y captura tambien
 * el panel:
 *   KS_SHOT_EMAIL=... KS_SHOT_PASSWORD=... node scripts/capturas-store.mjs <dir-export>
 * Sin ellas hace el juego del kiosco y del acceso, y dice claramente que faltan las del
 * panel en lugar de entregar capturas de una pantalla de inicio de sesion como si fueran
 * el producto.
 *
 * USO
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx expo export --platform web --clear --output-dir /tmp/ks-web
 *   node scripts/capturas-store.mjs /tmp/ks-web [--salida DIR]
 */

import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { cargarPlaywright, sembrarKiosco, servirExport } from './lib/arnes-web.mjs';

const RAIZ = process.argv[2];
if (!RAIZ) {
  console.error('Uso: node scripts/capturas-store.mjs <directorio-del-export> [--salida DIR]');
  process.exit(2);
}

const iSalida = process.argv.indexOf('--salida');
const SALIDA = iSalida > 0 ? process.argv[iSalida + 1] : '/tmp/ks-capturas-store';
const PUERTO = 8123;

/**
 * Los tres formatos que pide App Store Connect.
 *
 * `escala` es el `deviceScaleFactor`: el viewport va en puntos y el PNG sale en pixeles
 * fisicos, igual que en el dispositivo. 430 x 932 a 3x son los 1290 x 2796 del iPhone
 * 6.9"; 1024 x 1366 a 2x son los 2048 x 2732 del iPad 13".
 */
const FORMATOS = [
  { id: 'iphone-6.9', ancho: 430, alto: 932, escala: 3, esperado: [1290, 2796] },
  { id: 'ipad-13-vertical', ancho: 1024, alto: 1366, escala: 2, esperado: [2048, 2732] },
  { id: 'ipad-13-horizontal', ancho: 1366, alto: 1024, escala: 2, esperado: [2732, 2048] },
];

const IDIOMAS = ['es-PE', 'en'];

/**
 * Las pantallas, en el orden en que cuentan la historia de la app.
 *
 * `kiosco` es la primera a proposito: es la que explica el producto en un segundo —un
 * reloj grande y un teclado— y la que un comprador reconoce.
 */
const PANTALLAS = [
  { id: '1-kiosco', ruta: '/kiosk', kiosco: true, espera: /\d{2}:\d{2}/ },
  { id: '2-kiosco-ayuda', ruta: '/kiosk/help', kiosco: true },
  { id: '3-activar-ipad', ruta: '/kiosk/setup', kiosco: false },
  { id: '4-acceso', ruta: '/sign-in', kiosco: false },
];

/** Solo con credenciales: el panel necesita una sesion real. */
const PANTALLAS_PANEL = [
  { id: '5-panel-inicio', ruta: '/' },
  { id: '6-panel-equipo', ruta: '/team' },
  { id: '7-panel-horario', ruta: '/schedule' },
  { id: '8-panel-horas', ruta: '/hours' },
];

const CORREO = process.env.KS_SHOT_EMAIL ?? '';
const CLAVE = process.env.KS_SHOT_PASSWORD ?? '';
const conPanel = CORREO !== '' && CLAVE !== '';

/** Ancho y alto reales de un PNG, leidos de su cabecera IHDR. */
async function tamanoPng(ruta) {
  const buffer = await readFile(ruta);
  // Los 8 primeros bytes son la firma; el IHDR empieza en el 16 con ancho y alto BE32.
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

const { cerrar: cerrarServidor } = await servirExport(RAIZ, PUERTO);
await mkdir(SALIDA, { recursive: true });

const pw = cargarPlaywright();
const browser = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
});

let hechas = 0;
const problemas = [];

for (const formato of FORMATOS) {
  for (const idioma of IDIOMAS) {
    const pantallas = conPanel ? [...PANTALLAS, ...PANTALLAS_PANEL] : PANTALLAS;

    for (const pantalla of pantallas) {
      // Un contexto nuevo por captura: con una sola pagina navegando, los manejadores
      // de OPFS de la ruta anterior no se liberan y la siguiente falla con
      // NoModificationAllowedError. Es un fallo del arnes que parece de la app.
      const context = await browser.newContext({
        viewport: { width: formato.ancho, height: formato.alto },
        deviceScaleFactor: formato.escala,
        locale: idioma === 'en' ? 'en-US' : 'es-PE',
      });
      const page = await context.newPage();

      // El idioma se siembra en el almacenamiento, no se pulsa el conmutador: pulsar
      // depende de encontrar un boton en cada pantalla, y aqui hay ocho.
      await page.addInitScript((valor) => {
        localStorage.setItem(
          'krealo-shift.dev.app.preferences',
          JSON.stringify({ language: valor, timeFormat: '24h' }),
        );
      }, idioma);

      if (pantalla.kiosco) await sembrarKiosco(page);

      const nombre = `${formato.id}_${idioma}_${pantalla.id}.png`;
      try {
        await page.goto(`http://127.0.0.1:${PUERTO}${pantalla.ruta}`, {
          waitUntil: 'networkidle',
          timeout: 30_000,
        });

        if (conPanel && pantalla.ruta === '/sign-in') {
          await page.getByTestId('sign-in-email').fill(CORREO);
          await page.getByTestId('sign-in-password').fill(CLAVE);
          await page.getByTestId('sign-in-submit').click();
        }

        if (pantalla.espera !== undefined) {
          // Se espera a que la pantalla tenga CONTENIDO, no solo a que cargue: una
          // captura tomada un instante antes sale con el reloj en blanco.
          await page.waitForFunction(
            (patron) => new RegExp(patron).test(document.body.innerText),
            pantalla.espera.source,
            { timeout: 15_000 },
          );
        }
        await page.waitForTimeout(900);

        const destino = join(SALIDA, nombre);
        await page.screenshot({ path: destino });

        const [ancho, alto] = await tamanoPng(destino);
        const [okAncho, okAlto] = formato.esperado;
        if (ancho !== okAncho || alto !== okAlto) {
          problemas.push(`${nombre}: salio ${ancho}x${alto} y App Store pide ${okAncho}x${okAlto}`);
        } else {
          hechas += 1;
        }
      } catch (error) {
        problemas.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await context.close();
      }
    }
  }
}

await browser.close();
cerrarServidor();

const archivos = (await readdir(SALIDA)).filter((f) => f.endsWith('.png')).sort();
console.log(`\n${archivos.length} capturas en ${SALIDA}`);
for (const formato of FORMATOS) {
  const suyas = archivos.filter((f) => f.startsWith(formato.id + '_'));
  console.log(
    `  ${formato.id.padEnd(20)} ${formato.esperado.join('x').padEnd(11)} ${suyas.length} archivos`,
  );
}

if (!conPanel) {
  console.log(
    '\nFALTAN las del panel administrativo: necesita una sesion real. Con un Supabase\n' +
      'configurado y una cuenta:\n' +
      '  KS_SHOT_EMAIL=tu@correo KS_SHOT_PASSWORD=... node scripts/capturas-store.mjs <export>',
  );
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nLas ${hechas} capturas tienen el tamano exacto que pide App Store Connect.`);
