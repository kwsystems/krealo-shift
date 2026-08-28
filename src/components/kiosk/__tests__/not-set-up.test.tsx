import { screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KioskNotSetUpState } from '../not-set-up';
import { renderWithProviders } from '@/test-utils/render';

const RAIZ = join(__dirname, '../../../../');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

/**
 * El dispositivo no es un reloj y alguien abrió una pantalla del kiosco (§20).
 *
 * La guarda existía SOLO en `app/kiosk/index.tsx`. `/kiosk/actions` y `/kiosk/exit`
 * se alcanzan sin pasar por ahí —enlace directo, restauración de ruta al reiniciar,
 * recarga en la previsualización web— y pintaban su pantalla completa con la
 * ubicación en blanco y un teclado que, al completar el PIN, no hacía nada: los
 * manejadores empiezan con `if (binding === null) return;`.
 *
 * Lo confirmó el chequeo de interacción: con la guarda quitada, los dos casos nuevos
 * fallan con "pinta el teclado del PIN en un dispositivo sin activar".
 */
describe('estado vacío del kiosco sin credencial', () => {
  it('dice qué pasa y ofrece la siguiente acción, sin redirigir', async () => {
    await renderWithProviders(<KioskNotSetUpState />);

    expect(screen.getByTestId('kiosk-not-set-up')).toBeTruthy();
    // §20: la siguiente acción, no solo el diagnóstico. Y no una redirección: un
    // empleado que solo quería fichar no debe acabar en administración sin saber
    // por qué.
    expect(screen.getByTestId('kiosk-go-to-setup')).toBeTruthy();
  });

  it('la guarda vive en el layout del kiosco, que cubre TODAS sus rutas', () => {
    const layout = leer('app/kiosk/_layout.tsx');
    expect(layout).toContain('useKioskNotSetUp');
    expect(layout).toContain('KioskNotSetUpState');
  });

  it('y ya no está duplicada en la pantalla de reposo', () => {
    const reposo = leer('app/kiosk/index.tsx');
    expect(reposo).not.toContain('kiosk-not-set-up');
  });

  it('las rutas exentas son exactamente tres, y cada una por un motivo escrito', () => {
    /*
     * La lista de exenciones es el punto débil de una guarda de layout: si crece sin
     * control, la guarda deja de guardar. Se fija aquí para que añadir una cuarta sea
     * una decisión y no un descuido.
     *
     * setup crea la credencial; help es texto; exit la borra, y por eso comprueba lo
     * mismo por su cuenta con un flag de salida que evita pintar el estado vacío
     * encima de quien acaba de desactivar el kiosco a propósito.
     */
    const layout = leer('app/kiosk/_layout.tsx');
    const lista = /RUTAS_SIN_CREDENCIAL = new Set\(\[([^\]]*)\]\)/.exec(layout);
    expect(lista).not.toBeNull();

    const rutas = (lista?.[1] ?? '')
      .split(',')
      .map((parte) => parte.trim().replace(/^['"]|['"]$/g, ''))
      .filter((parte) => parte !== '');
    expect(rutas.sort()).toEqual(['exit', 'help', 'setup']);

    // La exenta que sí necesita credencial comprueba lo mismo por su cuenta.
    const salida = leer('app/kiosk/exit.tsx');
    expect(salida).toContain('useKioskNotSetUp');
    expect(salida).toContain('KioskNotSetUpState');
  });

  it('"olvidé marcar" no deja un formulario que no envía nada', () => {
    // Mismo fallo, otra precondición: sin sesión validada, `submit` volvía sin hacer
    // nada y el formulario se quedaba en pantalla. `actions.tsx` ya lo protegía; esta
    // pantalla se había quedado sin la misma protección.
    const olvido = leer('app/kiosk/forgot.tsx');
    expect(olvido).toContain('if (verification === null) returnToIdle();');
    expect(olvido).toContain('if (verification === null) return null;');
  });
});
