import { darkColors, lightColors, type ColorToken } from '../tokens';
import { colorsFor, resolveScheme, THEME_PREFERENCES } from '../use-theme';

/**
 * La maquinaria del tema, y sobre todo LO QUE NO SE PUEDE DESALINEAR.
 *
 * El fallo característico del modo oscuro no es una pantalla rota: es un token que
 * alguien añadió a un juego y olvidó en el otro. El tipo ya lo impide al compilar, pero
 * el tipo no ve dos cosas que sí se comprueban aquí: que ningún valor se quedó copiado
 * del juego claro por pereza, y que el contraste del texto de verdad llega.
 */

/** Contraste WCAG. Se calcula; mirarlo es como no comprobarlo. */
function contraste(a: string, b: string): number {
  const canal = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luz = (hex: string) => {
    const n = hex.replace('#', '');
    const [r, g, azul] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
    return 0.2126 * canal(r ?? 0) + 0.7152 * canal(g ?? 0) + 0.0722 * canal(azul ?? 0);
  };
  const [alto, bajo] = [luz(a), luz(b)].sort((x, y) => y - x) as [number, number];
  return (alto + 0.05) / (bajo + 0.05);
}

describe('los dos juegos de color', () => {
  it('tienen exactamente las mismas claves', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  /**
   * Un token que en oscuro vale lo mismo que en claro es casi siempre un olvido: alguien
   * copió el juego y no repasó ese. Las DOS excepciones legítimas son `black` y `white`,
   * que son colores literales y no papeles: cuando un componente pide blanco, quiere
   * blanco en los dos temas.
   */
  it('ningún papel se quedó con el valor del otro tema', () => {
    const literales: ColorToken[] = ['black', 'white'];
    const iguales = (Object.keys(lightColors) as ColorToken[]).filter(
      (clave) => !literales.includes(clave) && lightColors[clave] === darkColors[clave],
    );
    expect(iguales).toEqual([]);
  });

  it('la tarjeta es más clara que el lienzo en los dos temas, no solo en claro', () => {
    // La jerarquía se conserva aunque los valores se den la vuelta: una tarjeta que se
    // funde con el fondo deja de leerse como una tarjeta.
    const claro = contraste(lightColors.surface, lightColors.canvas);
    const oscuro = contraste(darkColors.surface, darkColors.canvas);
    expect(claro).toBeGreaterThan(1);
    expect(oscuro).toBeGreaterThan(1);
  });
});

describe('contraste del texto', () => {
  const casos: [string, ColorToken, ColorToken][] = [
    ['texto principal sobre tarjeta', 'ink900', 'surface'],
    ['texto secundario sobre tarjeta', 'ink700', 'surface'],
    ['texto apagado sobre tarjeta', 'ink500', 'surface'],
    ['texto principal sobre lienzo', 'ink900', 'canvas'],
    ['texto apagado sobre lienzo', 'ink500', 'canvas'],
    ['éxito sobre su insignia', 'success600', 'success50'],
    ['aviso sobre su insignia', 'warning600', 'warning50'],
    ['peligro sobre su insignia', 'danger600', 'danger50'],
    ['info sobre su insignia', 'info600', 'info50'],
  ];

  /**
   * DEUDA HEREDADA DEL TEMA CLARO, ANOTADA AQUÍ A PROPÓSITO.
   *
   * Al medir estos pares aparecieron dos que NO llegan, y no son del tema oscuro: son
   * del claro, el que la app lleva usando desde siempre.
   *
   *   success600 sobre success50 → 4,31:1
   *   warning600 sobre warning50 → 3,86:1
   *
   * No se arreglaron aquí porque la tarea que los encontró prometía no cambiar el
   * aspecto de ninguna pantalla, y oscurecerlos cambia las insignias de toda la app.
   * Tampoco se bajó el listón de la prueba para que pasara, que es la salida fácil y
   * deja una prueba que ya no comprueba nada.
   *
   * Así que quedan nombrados: la prueba exige 4,5:1 a TODO lo demás y a los dos temas, y
   * estas dos se saltan el lado claro con su deuda escrita. Tarea nJTTpJRad37anvPtsAZc.
   * Cuando se arreglen, se borra esta lista y la prueba vuelve a ser uniforme.
   */
  const DEUDA_EN_CLARO: ColorToken[] = ['success600', 'warning600'];

  it.each(casos)('%s llega a 4,5:1 en los DOS temas', (_nombre, tinta, fondo) => {
    if (!DEUDA_EN_CLARO.includes(tinta)) {
      expect(contraste(lightColors[tinta], lightColors[fondo])).toBeGreaterThanOrEqual(4.5);
    }
    // El oscuro no tiene excepciones: se diseñó midiendo, así que no hay nada heredado
    // que disculpar.
    expect(contraste(darkColors[tinta], darkColors[fondo])).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * Y la deuda no puede crecer en silencio: si alguien añade un tercer par flojo al tema
   * claro, esta prueba lo caza aunque la de arriba lo perdone.
   */
  it('la deuda del tema claro sigue siendo exactamente esos dos pares', () => {
    const flojos = casos
      .filter(([, tinta, fondo]) => contraste(lightColors[tinta], lightColors[fondo]) < 4.5)
      .map(([, tinta]) => tinta);
    expect(flojos.sort()).toEqual([...DEUDA_EN_CLARO].sort());
  });

  /**
   * El que obligó a inventar el token `onPrimary`. En oscuro el acento se aclara para
   * verse sobre fondo oscuro, y entonces el blanco de siempre se queda en 3,65:1: un
   * botón primario con la etiqueta a medio leer.
   */
  it('el texto encima del acento llega a 4,5:1 en los dos temas', () => {
    expect(contraste(lightColors.onPrimary, lightColors.primary600)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(darkColors.onPrimary, darkColors.primary600)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('qué tema toca', () => {
  it('una elección fija manda sobre el sistema', () => {
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });

  it('automático sigue al sistema', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
  });

  /**
   * `useColorScheme` devuelve `null` de verdad —en web antes de hidratar— y también
   * `'unspecified'`. Ante la duda, claro: es lo que la app ha sido siempre, y enseñarle
   * una pantalla oscura a quien no la pidió es peor que quedarse quieto.
   */
  it.each([[null], [undefined], ['unspecified' as const]])(
    'sin dato del sistema (%s) se queda en claro',
    (valor) => {
      expect(resolveScheme('system', valor)).toBe('light');
    },
  );

  it('devuelve el juego de color ya resuelto, no el nombre', () => {
    expect(colorsFor('dark')).toBe(darkColors);
    expect(colorsFor('light')).toBe(lightColors);
  });

  it('las tres opciones están declaradas, con automático primero', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark']);
  });
});
