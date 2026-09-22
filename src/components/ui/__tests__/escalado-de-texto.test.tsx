import { renderWithProviders } from '@/test-utils/render';

import { AppText } from '../app-text';

/**
 * EL ESCALADO DE TEXTO DEL SISTEMA SE CORTA DONDE EL TAMAÑO YA SE CALCULÓ.
 *
 * Esta prueba existe porque el fallo que previene solo aparece en un aparato real con
 * el texto del sistema agrandado, y ahí ya es tarde: el reloj de fichaje es un iPad
 * atornillado a la pared, y su teclado pasa `kiosco:check` con DIEZ píxeles de holgura
 * en 320×568. Diez píxeles no sobreviven a un multiplicador de texto, y el síntoma
 * sería la última fila —«Borrar», «0» y el borrado de dígito— fuera de la pantalla.
 * Nadie podría fichar y no habría nada que tocar para arreglarlo.
 *
 * Ni `tsc` ni el linter ni ningún arnés de navegador pueden ver esto: `allowFontScaling`
 * no existe en web y no cambia nada de lo que se pinta aquí. Lo único comprobable sin
 * un aparato es la REGLA, y es lo que se fija: dónde se corta y dónde NO.
 *
 * La otra mitad importa igual. Apagarlo en todas partes sería quitar una función de
 * accesibilidad de verdad: en el panel el texto se lee, y crecer solo ayuda.
 */

describe('el tope del escalado de texto del sistema', () => {
  const escala = async (elemento: Parameters<typeof renderWithProviders>[0]) => {
    const vista = await renderWithProviders(elemento);
    // Se lee la propiedad del nodo pintado, no un estilo: `allowFontScaling` no tiene
    // efecto en web y no cambia nada de lo que se ve aquí. Lo que se comprueba es la
    // decisión que el componente le pasa a React Native.
    return vista.getByTestId('medido').props.allowFontScaling;
  };

  it('se corta cuando el llamante calculó el tamaño desde la pantalla', async () => {
    // Es el caso del reloj (`scaleFont`, `scaleFontAlto`) y de los dígitos del teclado,
    // cuyo tamaño sale del diámetro de su tecla.
    await expect(escala(<AppText testID="medido" size={48} />)).resolves.toBe(false);
  });

  it('se corta en las variantes del reloj, aunque no se pase tamaño', async () => {
    await expect(escala(<AppText testID="medido" variant="kioskClock" />)).resolves.toBe(false);
    await expect(escala(<AppText testID="medido" variant="kioskTitle" />)).resolves.toBe(false);
  });

  it('NO se corta en el texto del panel, que es donde crecer ayuda', async () => {
    for (const variant of ['title', 'section', 'body', 'bodyStrong', 'help', 'label'] as const) {
      await expect(escala(<AppText testID="medido" variant={variant} />)).resolves.toBe(true);
    }
  });

  it('`enCajaFija` corta el escalado SIN tocar la tipografía', async () => {
    /*
     * Es el caso de «Borrar» en el teclado del reloj: caja fija, tamaño no calculado.
     * Las dos mitades de esta prueba salen de un error que cometí: el primer intento
     * fue pasarle un `size` con el número que ya tenía, y `size` reescribe TAMBIÉN el
     * alto de línea con otro multiplicador. La etiqueta habría pasado de 21 a 16 px sin
     * que nadie lo pidiera, y yo lo había escrito como «no cambia nada de lo que se
     * ve». Así que aquí se comprueba lo que se quería y lo que NO se quería.
     */
    const vista = await renderWithProviders(<AppText testID="medido" variant="help" enCajaFija />);
    const conCaja = vista.getByTestId('medido').props;
    await vista.unmount();

    const suelta = await renderWithProviders(<AppText testID="medido" variant="help" />);
    const sinCaja = suelta.getByTestId('medido').props;

    expect(conCaja.allowFontScaling).toBe(false);
    expect(sinCaja.allowFontScaling).toBe(true);
    // Y la tipografía es la MISMA: es lo único que cambió respecto del primer intento.
    const medidas = (props: Record<string, unknown>) => {
      const plano = Object.assign({}, ...[props.style].flat(3).filter(Boolean)) as {
        fontSize?: number;
        lineHeight?: number;
      };
      return { fontSize: plano.fontSize, lineHeight: plano.lineHeight };
    };
    expect(medidas(conCaja)).toEqual(medidas(sinCaja));
  });

  it('el tamaño explícito manda sobre la variante del panel', async () => {
    // Un texto del panel al que alguien le calcula el tamaño deja de escalar, porque el
    // cálculo ya decidió cuánto mide. Es la misma regla, no una excepción.
    await expect(escala(<AppText testID="medido" variant="body" size={20} />)).resolves.toBe(false);
  });
});
