import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `firebase.json` tiene dos reglas que, si se caen, rompen la web publicada de una
 * forma que NO se ve navegando.
 *
 * 1. EL REENVÍO A index.html. El proyecto usa `web.output: 'single'`, así que el
 *    paquete compilado tiene un solo `index.html`: `/team` y `/schedule` no existen
 *    como archivos, solo dentro del router. Sin el reenvío, entrar directo a una ruta
 *    interna —o simplemente RECARGAR estando ahí— devuelve 404. Navegando desde la
 *    raíz todo parece perfecto, y por eso es tan fácil publicarlo roto.
 *
 * 2. index.html SIN CACHÉ. Es el único archivo sin hash en el nombre y es quien apunta
 *    a los demás. Si se cachea, la gente sigue viendo la versión vieja después de cada
 *    publicación, a veces durante días, y no hay nada que puedas decirles que lo
 *    arregle.
 *
 * ESTA PRUEBA PASABA CON LA CONFIGURACIÓN ROTA, y vale saber por qué. Comprobaba que
 * existiera una entrada con `source: '/index.html'` y `no-cache`. Existía. Pero
 * Firebase casa las cabeceras contra la ruta PEDIDA, no contra la reescrita: nadie
 * pide `/index.html` —piden `/` o `/team`—, así que esa regla no se aplicaba nunca y
 * el documento se servía con `max-age=3600`. Se descubrió pidiendo la URL publicada
 * con `fetch` y mirando la cabecera de verdad, no leyendo este archivo.
 *
 * Por eso ahora se comprueba el ORDEN y no la existencia: el `no-cache` tiene que
 * estar en el comodín —la única regla que casa con lo que la gente pide— y las de un
 * año tienen que ir DESPUÉS para ganarle solo en los archivos con hash.
 */

type ConfiguracionHosting = {
  hosting: {
    public: string;
    rewrites?: { source: string; destination: string }[];
    headers?: { source: string; headers: { key: string; value: string }[] }[];
  };
};

const configuracion = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'firebase.json'), 'utf8'),
) as ConfiguracionHosting;

describe('firebase.json', () => {
  it('reenvía TODAS las rutas a index.html, o recargar en /team da 404', () => {
    const reenvios = configuracion.hosting.rewrites ?? [];
    expect(reenvios).toContainEqual({ source: '**', destination: '/index.html' });
  });

  it('publica lo que compila `npm run web:build`', () => {
    expect(configuracion.hosting.public).toBe('dist');
  });

  it('el no-cache va en el COMODÍN, que es lo único que casa con lo que se pide', () => {
    const cabeceras = configuracion.hosting.headers ?? [];
    const comodin = cabeceras.find((entrada) => entrada.source === '**');
    const cacheControl = comodin?.headers.find((h) => h.key === 'Cache-Control');

    expect(cacheControl?.value).toMatch(/no-cache|no-store|max-age=0/);
  });

  it('los archivos con hash sí se cachean: son inmutables por construcción', () => {
    const cabeceras = configuracion.hosting.headers ?? [];
    const deExpo = cabeceras.find((entrada) => entrada.source === '/_expo/**');
    const cacheControl = deExpo?.headers.find((h) => h.key === 'Cache-Control');

    expect(cacheControl?.value).toContain('max-age=31536000');
  });

  it('y van DESPUÉS del comodín, o el no-cache les ganaría a ellos', () => {
    // El orden es la mitad del arreglo. Con las reglas de un año antes del comodín,
    // el `no-cache` se aplicaría también a los bundles con hash y se volverían a
    // descargar 6 MB en cada visita.
    const fuentes = (configuracion.hosting.headers ?? []).map((entrada) => entrada.source);

    expect(fuentes.indexOf('**')).toBeLessThan(fuentes.indexOf('/_expo/**'));
    expect(fuentes.indexOf('**')).toBeLessThan(fuentes.indexOf('/assets/**'));
  });

  it('el panel no se puede incrustar en un iframe de otro sitio', () => {
    // Un panel de administración dentro de un iframe ajeno es como se monta un
    // clickjacking: la víctima cree que pulsa otra cosa y aprueba horas.
    const cabeceras = configuracion.hosting.headers ?? [];
    const globales = cabeceras.find((entrada) => entrada.source === '**');
    const frames = globales?.headers.find((h) => h.key === 'X-Frame-Options');

    expect(frames?.value).toBe('DENY');
  });
});
