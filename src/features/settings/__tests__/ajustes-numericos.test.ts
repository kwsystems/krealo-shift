import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_LOCATION_SETTINGS } from '@/hooks/use-manager-scope';

const PANEL = readFileSync(join(__dirname, '../settings-panel.tsx'), 'utf8');

/**
 * Ningún ajuste numérico de la ubicación puede quedarse sin campo en el panel (§11.6).
 *
 * El tipo de claves del panel era una unión ESCRITA A MANO con las mismas ocho claves de
 * `LocationSettings`. Una segunda copia de una lista se separa de la primera en cuanto
 * alguien añade un ajuste: el tipo lo aceptaría, el panel no lo mostraría, y el ajuste
 * nuevo quedaría en la base sin forma de cambiarlo desde la app.
 *
 * Ahora la clave se DERIVA del tipo y las etiquetas son un `Record` exhaustivo, así que
 * el compilador ya obliga. Esta prueba cubre lo que el compilador no ve: que la etiqueta
 * exista de verdad en los dos idiomas, y que la única exclusión siga siendo deliberada.
 */
describe('ajustes numéricos de la ubicación', () => {
  const numericas = Object.entries(DEFAULT_LOCATION_SETTINGS)
    .filter(([, valor]) => typeof valor === 'number')
    .map(([clave]) => clave);

  it('cada ajuste numérico tiene campo en el panel, salvo el excluido a propósito', () => {
    const sinCampo = numericas.filter(
      (clave) => clave !== 'pinLength' && !PANEL.includes(`${clave}:`),
    );
    expect(sinCampo).toEqual([]);
  });

  it('`pinLength` sigue excluido, y con su motivo escrito al lado', () => {
    /*
     * Bajarlo de 6 a 4 deja fuera a toda la tienda de golpe: los PIN guardados son
     * hashes de seis dígitos y el teclado validaría al cuarto. Si alguien lo añade al
     * panel algún día, que sea leyendo por qué no estaba.
     */
    expect(PANEL).toContain("type ClaveNumericaNoEditable = 'pinLength'");
    expect(PANEL).toMatch(/PIN/);
  });

  it('las etiquetas existen en los dos idiomas', () => {
    // Un `Record` exhaustivo garantiza que hay una CLAVE de traducción por ajuste; no
    // que esa clave exista en el JSON. Sin esto, un ajuste nuevo saldría en pantalla con
    // su propia clave como etiqueta: "settings.loQueSea".
    // `m[1]` es `string | undefined` con `noUncheckedIndexedAccess`, y el filtro lo
    // estrecha. Jest no lo habría notado —no comprueba tipos— pero `tsc` sí, y CI corre
    // `tsc`: una prueba que no compila rompe la build igual que el código.
    const claves = [...PANEL.matchAll(/'settings\.([A-Za-z0-9_]+)'/g)]
      .map((m) => m[1])
      .filter((clave): clave is string => clave !== undefined);

    for (const locale of ['es-PE', 'en']) {
      const json = JSON.parse(
        readFileSync(join(__dirname, `../../../i18n/locales/${locale}.json`), 'utf8'),
      ) as { settings: Record<string, string> };

      const faltan = claves.filter((clave) => json.settings[clave] === undefined);
      expect(faltan).toEqual([]);
    }
  });

  it('el multiplicador de horas extra es informativo y no baja de 1x', () => {
    // §13 lo pide entre las políticas configurables. Un multiplicador menor que 1
    // significaría pagar la hora extra MENOS que la normal: no es un ajuste, es un error
    // de tecleo, y el esquema lo rechaza.
    expect(DEFAULT_LOCATION_SETTINGS.overtimeMultiplierPercent).toBeGreaterThanOrEqual(100);
  });
});
