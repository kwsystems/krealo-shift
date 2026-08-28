import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { setAnalyticsSink, SPEC_EVENTS, track, type AnalyticsEvent } from '../index';

const RAIZ = join(__dirname, '../../../..');

function archivos(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivos(ruta, acumulado);
    else if (/\.tsx?$/.test(entrada) && !ruta.includes('__tests__')) acumulado.push(ruta);
  }
  return acumulado;
}

/**
 * Eventos de producto (§31).
 *
 * §31 nombra nueve eventos y NO HABÍA NINGUNO instrumentado: la sección entera estaba
 * sin hacer, y en silencio, porque nada falla cuando un evento no se envía. Eso es lo
 * que estas pruebas convierten en algo que sí falla.
 */
describe('analítica de producto', () => {
  afterEach(() => setAnalyticsSink(null));

  it('los NUEVE eventos de §31 están medidos en el código de la app', () => {
    /*
     * La prueba que importa. Un módulo de analítica perfecto que nadie llama no mide
     * nada, y es exactamente el estado en el que estaba el proyecto: nueve eventos
     * especificados, cero llamadas. Se busca cada nombre en el código real, fuera del
     * archivo que los declara.
     */
    const fuentes = [...archivos(join(RAIZ, 'src')), ...archivos(join(RAIZ, 'app'))]
      .filter((ruta) => !ruta.includes(join('lib', 'analytics')))
      .map((ruta) => readFileSync(ruta, 'utf8'))
      .join('\n');

    const sinMedir = SPEC_EVENTS.filter((nombre) => !fuentes.includes(`name: '${nombre}'`));
    expect(sinMedir).toEqual([]);
  });

  it('envía al destino conectado', () => {
    const vistos: AnalyticsEvent[] = [];
    setAnalyticsSink((event) => void vistos.push(event));

    track({ name: 'kiosk_activated' });
    track({ name: 'sync_completed', accepted: 3, pending: 0, needsReview: 1 });

    expect(vistos).toEqual([
      { name: 'kiosk_activated' },
      { name: 'sync_completed', accepted: 3, pending: 0, needsReview: 1 },
    ]);
  });

  it('un destino que revienta NO rompe el fichaje', () => {
    /*
     * `track` se llama desde el camino de una entrada al trabajo. Si la analítica puede
     * tirar ese camino, la analítica es un riesgo y no una medición: nadie acepta que un
     * empleado no pueda fichar porque el servicio de métricas devuelve un 500.
     */
    setAnalyticsSink(() => {
      throw new Error('el servicio de analitica esta caido');
    });

    expect(() => track({ name: 'kiosk_activated' })).not.toThrow();
  });

  it('un destino asíncrono que rechaza tampoco, y no deja el rechazo suelto', async () => {
    // Un `void promise()` con un rechazo dentro es una excepción sin capturar, que en
    // React Native es una pantalla roja encima del reloj de una tienda.
    const errores: unknown[] = [];
    const original = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (motivo) => errores.push(motivo));

    setAnalyticsSink(() => Promise.reject(new Error('timeout')));
    expect(() => track({ name: 'kiosk_activated' })).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));

    process.removeAllListeners('unhandledRejection');
    for (const listener of original) process.on('unhandledRejection', listener);

    expect(errores).toEqual([]);
  });

  it('NINGÚN evento puede llevar un campo de texto libre (§31)', () => {
    /*
     * §31: "No enviar nombre, PIN, foto ni notas en analítica". La garantía no es una
     * intención, es la forma del tipo: las propiedades son números, booleanos y
     * enumerados cerrados. Un solo `string` suelto —un motivo de error, un nombre de
     * ubicación— es la puerta por la que se escapa un dato personal sin que nadie lo
     * decida.
     *
     * Se comprueba leyendo el tipo. Los enumerados de literales SÍ valen: son un
     * conjunto cerrado que se puede revisar de un vistazo.
     */
    const declaracion = readFileSync(join(__dirname, '../events.ts'), 'utf8');
    const cuerpo = declaracion.slice(
      declaracion.indexOf('export type AnalyticsEvent'),
      declaracion.indexOf('export type TimeActionName'),
    );

    // `algo: string` sin comillas alrededor es texto libre; `'a' | 'b'` no lo es.
    const camposLibres = [...cuerpo.matchAll(/(\w+)\??:\s*string\b/g)].map((m) => m[1]);
    expect(camposLibres).toEqual([]);
  });

  it('la lista de §31 y el tipo no pueden separarse', () => {
    // `SPEC_EVENTS` es lo que la prueba de arriba busca en el código. Si alguien añade un
    // evento al tipo y olvida la lista, dejaría de comprobarse solo.
    const declaracion = readFileSync(join(__dirname, '../events.ts'), 'utf8');
    const enElTipo = [
      ...declaracion
        .slice(
          declaracion.indexOf('export type AnalyticsEvent'),
          declaracion.indexOf('export type TimeActionName'),
        )
        .matchAll(/name:\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);

    expect([...SPEC_EVENTS].sort()).toEqual(enElTipo.sort());
  });
});
