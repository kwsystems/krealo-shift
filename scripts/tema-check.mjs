/**
 * ¿Se pone oscuro TODO, o solo la mitad?
 *
 * EL FALLO QUE CAZA, Y QUE PASÓ DE VERDAD
 * `StyleSheet.create({ card: { backgroundColor: colors.surface } })` se evalúa una vez,
 * al cargar el módulo. El color queda congelado ahí para siempre. Cambiar el tema
 * después no lo toca, y NO SE ROMPE NADA: no lanza, no sale en consola, no se queda en
 * blanco. La pantalla simplemente aparece con la mitad de sus superficies del otro tema.
 *
 * La primera captura en oscuro de este proyecto lo enseñó tal cual: la página oscura y
 * las insignias de estado en crema y verde pálido, porque el mapa que las pintaba vivía
 * en un objeto constante dentro de `tokens.ts`.
 *
 * CÓMO SE MIDE
 * Se abre cada pantalla en los dos temas y se recorre el DOM midiendo el fondo REAL
 * —`getComputedStyle`— de cada superficie grande. En oscuro, ninguna superficie grande
 * puede ser clara; en claro, ninguna puede ser oscura. No se comparan capturas: una
 * captura cambia con la hora que pinta el reloj, y perseguir eso acaba en un arnés que
 * se ignora.
 *
 * Uso:
 *   npm run demo:export
 *   node scripts/tema-check.mjs dist-demo
 */
import { servirExport, cargarPlaywright } from './lib/arnes-web.mjs';

const DIR = process.argv[2];
if (DIR === undefined) {
  console.error('Uso: node scripts/tema-check.mjs <export-demo>');
  process.exit(2);
}

const RUTAS = [
  ['inicio', '/'],
  ['equipo', '/team'],
  ['horario', '/schedule'],
  ['horas', '/hours'],
  ['reportes', '/reports'],
  ['mas', '/more'],
];

/** Una superficie por debajo de esto es un detalle, no el fondo de nada. */
const AREA_MINIMA = 12000;

const problemas = [];
const { base, cerrar } = await servirExport(DIR, 8128);
const { chromium } = cargarPlaywright();
const navegador = await chromium.launch();

for (const tema of ['light', 'dark']) {
  const contexto = await navegador.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: tema,
  });
  const pagina = await contexto.newPage();

  await pagina.goto(base + '/', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1500);
  await pagina.locator('[data-testid="sign-in-demo"]').click();
  await pagina.waitForTimeout(2800);

  for (const [nombre, ruta] of RUTAS) {
    await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
    await pagina.waitForTimeout(2400);

    const medidas = await pagina.evaluate((areaMinima) => {
      // Luminancia relativa WCAG: 0 es negro, 1 es blanco.
      const canal = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const luz = (rgb) => {
        const n = rgb.match(/\d+(\.\d+)?/g);
        if (n === null || n.length < 3) return null;
        // Transparente: no pinta nada, no se mide.
        if (n.length >= 4 && Number.parseFloat(n[3]) < 0.5) return null;
        const [r, g, b] = n.slice(0, 3).map((v) => Number.parseInt(v, 10) / 255);
        return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
      };

      /*
       * UN FONDO TAPADO NO SE VE, Y POR TANTO NO ES UN FALLO.
       *
       * React Navigation trae su propio tema y pinta un `rgb(242,242,242)` en la raíz
       * del navegador. No se puede cambiar desde aquí —el paquete no es dependencia
       * directa del proyecto, viene dentro de expo-router— pero el contenido del Stack,
       * que sí sigue el tema, lo cubre entero: cero píxeles de ese gris en la captura.
       *
       * Se comprueba, no se da por bueno: un elemento solo se perdona si tiene un hijo
       * OPACO que lo cubre por completo. Meterlo en una lista blanca por su color sería
       * ocultar el día que deje de estar tapado.
       */
      /*
       * UN FONDO TAPADO NO SE VE, Y POR TANTO NO ES UN FALLO.
       *
       * React Navigation trae su propio tema y pinta un `rgb(242,242,242)` en la raíz
       * del navegador. No se puede cambiar desde aquí: el paquete no es dependencia
       * directa del proyecto —viene dentro de expo-router— así que no hay forma de
       * importar su `ThemeProvider`. Pero el contenido del Stack, que sí sigue el tema,
       * lo cubre entero.
       *
       * SE COMPRUEBA POR ORDEN REAL DE PINTADO, no por parentesco. Se muestrean nueve
       * puntos de la caja y en cada uno se pregunta al navegador QUÉ ELEMENTO ESTÁ
       * ENCIMA (`elementFromPoint`), subiendo hasta el primero con fondo opaco. Si en
       * los nueve puntos lo que se ve es otra superficie del tema correcto, ese fondo
       * no llega a la pantalla.
       *
       * Se hace así y no con una lista blanca por color: una lista blanca seguiría
       * callando el día que ese gris deje de estar tapado, que es justo el día en que
       * importa.
       */
      const fondoVisibleEn = (x, y) => {
        let n = document.elementFromPoint(x, y);
        while (n !== null) {
          const l = luz(getComputedStyle(n).backgroundColor);
          if (l !== null) return { el: n, luz: l };
          n = n.parentElement;
        }
        return null;
      };

      const estaTapado = (el, caja) => {
        for (const fx of [0.1, 0.5, 0.9]) {
          for (const fy of [0.1, 0.5, 0.9]) {
            const x = caja.left + caja.width * fx;
            const y = caja.top + caja.height * fy;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            const visto = fondoVisibleEn(x, y);
            // Si lo que se ve en ese punto es este mismo elemento, su fondo llega a
            // la pantalla: no está tapado.
            if (visto === null || visto.el === el) return false;
          }
        }
        return true;
      };

      const fuera = [];
      for (const el of document.querySelectorAll('div, section, main')) {
        const caja = el.getBoundingClientRect();
        if (caja.width * caja.height < areaMinima) continue;
        const l = luz(getComputedStyle(el).backgroundColor);
        if (l === null) continue;
        fuera.push({
          luz: Number(l.toFixed(3)),
          fondo: getComputedStyle(el).backgroundColor,
          tapado: estaTapado(el, caja),
          texto: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        });
      }
      return fuera;
    }, AREA_MINIMA);

    // En oscuro ninguna superficie grande puede ser clara, y al revés.
    const delOtroTema = medidas.filter((m) => (tema === 'dark' ? m.luz > 0.5 : m.luz < 0.5));
    const intrusas = delOtroTema.filter((m) => !m.tapado);
    const tapadas = delOtroTema.length - intrusas.length;
    if (intrusas.length > 0) {
      const peor = intrusas.sort((a, b) => (tema === 'dark' ? b.luz - a.luz : a.luz - b.luz))[0];
      problemas.push(
        `${nombre} en ${tema}: ${intrusas.length} superficie(s) del tema equivocado. ` +
          `La peor: ${peor.fondo} (luz ${peor.luz}) en «${peor.texto}»`,
      );
    }

    console.log(
      `  ${tema.padEnd(5)} ${nombre.padEnd(9)} ${String(medidas.length).padStart(3)} superficies, ` +
        `${intrusas.length === 0 ? 'todas del tema' : `${intrusas.length} DEL OTRO TEMA`}` +
        `${tapadas > 0 ? ` (${tapadas} del otro tema pero tapada)` : ''}`,
    );
  }
  await contexto.close();
}

await navegador.close();
await cerrar();

if (problemas.length > 0) {
  console.error('\nEL TEMA NO SE APLICA ENTERO:');
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log('\nOK: las dos versiones se pintan enteras, sin mezclar temas.');
