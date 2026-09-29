/**
 * QUE UN PAQUETE SIN CONFIGURACIÓN NO PUEDA LLEGAR A SER UN DESPLIEGUE.
 *
 * POR QUÉ EXISTE, y la fecha importa porque es la SEGUNDA vez.
 *
 * El 21-sep-2026 se desplegó un paquete construido sin `.env`: `expo export` horneó las
 * variables de Firebase vacías y https://krealo-shift.web.app dejó de enseñar la
 * aplicación para enseñar «Falta configuración del entorno». El arreglo de entonces fue
 * añadir esa comprobación a `despliegue:check`.
 *
 * El 28-sep-2026 pasó EXACTAMENTE LO MISMO. El contenedor de la sesión se recicló, se
 * llevó el `.env` —que no está versionado, y con razón—, `npm run web:build` terminó
 * diciendo «Exported: dist», y se publicó una web muerta. Lo cazó `despliegue:check`...
 * después de publicarla.
 *
 * Y AHÍ ESTÁ LA LECCIÓN, que no es «acuérdate del .env»: el guardián estaba un paso
 * tarde las dos veces. Una comprobación que corre después de publicar no evita la caída,
 * solo la nombra. Un build que se queda sin su configuración y aun así responde «éxito»
 * convierte un archivo que falta en una caída de producción.
 *
 * DOS MODOS, y los dos hacen falta:
 *
 *   --antes    Se mira `.env` ANTES de exportar. No evita nada que no evite el otro, pero
 *              falla en un segundo en vez de en tres minutos, y dice qué hacer. Un
 *              guardián que tarda lo que el build es un guardián que se acaba saltando.
 *
 *   --despues  Se mira DENTRO de `dist/`, que es el único modo honesto: mide el artefacto
 *              y no la intención. `.env` puede existir, estar a medias, tener la variable
 *              vacía o llamarse distinto; el paquete o lleva la clave o no la lleva.
 *              Si no la lleva, se BORRA `dist/`: un paquete roto en disco es un despliegue
 *              esperando a que alguien ejecute el comando de subir sin mirar la salida.
 *
 * Uso (va enganchado a `npm run web:build`, no hace falta llamarlo a mano):
 *   node scripts/paquete-check.mjs --antes
 *   node scripts/paquete-check.mjs --despues
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  faltaEnElPaquete,
  sobraEnElPaquete,
  VARIABLES_EXIGIDAS,
} from './lib/configuracion-horneada.mjs';

const MODO = process.argv[2];
const DIST = 'dist';

/**
 * Se lee `.env` a mano y no con una librería: este script corre ANTES de que arranque
 * nada del proyecto, y pedir una dependencia para leer seis líneas de texto es cambiar
 * una comprobación barata por una que también puede fallar por su cuenta.
 */
function leerEnv(ruta) {
  const valores = new Map();
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (limpia === '' || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte === -1) continue;
    valores.set(limpia.slice(0, corte).trim(), limpia.slice(corte + 1).trim());
  }
  return valores;
}

if (MODO === '--antes') {
  if (!existsSync('.env')) {
    console.error('\nNO SE PUEDE CONSTRUIR: falta `.env`.');
    console.error('  Sin él, `expo export` hornea las variables de Firebase VACÍAS y el');
    console.error('  paquete resultante arranca en «Falta configuración del entorno».');
    console.error('  Así se rompió producción el 21-sep y otra vez el 28-sep.');
    console.error('\n  Arréglalo con:  cp .env.example .env');
    console.error('  La plantilla ya trae los valores reales: la configuración web de');
    console.error('  Firebase es pública por diseño y `.env.example` lo explica.');
    process.exit(1);
  }

  const env = leerEnv('.env');
  const vacias = VARIABLES_EXIGIDAS.filter((v) => {
    const valor = process.env[v] ?? env.get(v);
    return valor === undefined || valor === '';
  });
  if (vacias.length > 0) {
    console.error(`\nNO SE PUEDE CONSTRUIR: \`.env\` existe pero ${vacias.length} variable(s)`);
    console.error('que la app necesita para arrancar están vacías o no están:');
    for (const v of vacias) console.error(`  - ${v}`);
    console.error('\n  Compáralo con `.env.example`, que las trae todas con su valor.');
    process.exit(1);
  }

  console.log(`\`.env\` completo: las ${VARIABLES_EXIGIDAS.length} variables de Firebase están.`);
  process.exit(0);
}

if (MODO === '--despues') {
  const carpeta = join(DIST, '_expo', 'static', 'js', 'web');
  if (!existsSync(carpeta)) {
    console.error(`\nFALLA: no existe ${carpeta}; algo cambió en el empaquetado.`);
    process.exit(1);
  }
  const entrada = readdirSync(carpeta).find((f) => /^entry-[a-f0-9]+\.js$/.test(f));
  if (entrada === undefined) {
    console.error('\nFALLA: no encontré el paquete de entrada; algo cambió en el empaquetado.');
    process.exit(1);
  }

  const texto = readFileSync(join(carpeta, entrada), 'utf8');
  const sobran = sobraEnElPaquete(texto);
  if (sobran.length > 0) {
    console.error(`\nFALLA: el paquete construido lleva ${sobran.join(' y ')}.`);
    console.error('  Con eso horneado nadie puede entrar: la app hablaría con un emulador que');
    console.error('  no existe fuera de esta máquina. Quita `EXPO_PUBLIC_AUTH_EMULATOR_URL` de');
    console.error('  `.env` y del entorno, y vuelve a construir.');
    rmSync(DIST, { recursive: true, force: true });
    console.error(`\n  Se borró \`${DIST}/\` para que no se pueda desplegar por error.`);
    process.exit(1);
  }

  const faltan = faltaEnElPaquete(texto);
  if (faltan.length > 0) {
    console.error(`\nFALLA: el paquete construido no lleva ${faltan.join(' ni ')}.`);
    console.error('  Se construyó sin configuración, así que desplegarlo dejaría el sitio');
    console.error('  en «Falta configuración del entorno».');
    /*
     * SE BORRA, y no es celo: `web:deploy` no es la única forma de subir esto. Dejar en
     * disco un `dist/` roto es dejar cargado el accidente para el siguiente que ejecute
     * el comando de desplegar a mano —que es justo lo que pasó el 28-sep—.
     */
    rmSync(DIST, { recursive: true, force: true });
    console.error(`\n  Se borró \`${DIST}/\` para que no se pueda desplegar por error.`);
    process.exit(1);
  }

  console.log(`El paquete construido lleva su configuración dentro (${entrada}).`);
  process.exit(0);
}

console.error('Uso: node scripts/paquete-check.mjs --antes | --despues');
process.exit(2);
