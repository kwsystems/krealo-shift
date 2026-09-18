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

/**
 * EL KIOSCO, QUE ES EL CASO DIFÍCIL.
 *
 * No es una pantalla más: es un iPad atornillado a la pared de una tienda y se lee A UN
 * BRAZO DE DISTANCIA, de pie, a veces con prisa y con gente detrás. Un texto que en un
 * monitor «se distingue», ahí no se lee — y quien no lo lee no puede fichar.
 *
 * POR QUÉ ESTO ES UNA PRUEBA Y NO SOLO EL ARNÉS DE NAVEGADOR.
 * `scripts/kiosco-check.mjs` mide el contraste REAL de lo que se pinta, que es mejor
 * medida que esta. Pero hay estados del kiosco a los que no llega: en modo demostración
 * CUALQUIER PIN entra —`verify-pin` devuelve siempre a la misma persona, y está escrito
 * así a propósito para que la demostración se pueda recorrer—, así que el mensaje de
 * «ese PIN no es correcto» no aparece nunca por más que se teclee.
 *
 * Ese mensaje es justo el que alguien lee en el peor momento. Así que los estados que el
 * navegador no alcanza se comprueban aquí, sobre los tokens. El arnés dice en voz alta
 * cuáles visitó; esta prueba cubre el resto. Lo que no vale es que no los mire nadie.
 */
describe('contraste del kiosco', () => {
  /** [qué se lee, tinta, fondo] — pares que existen de verdad en las pantallas del reloj. */
  const TEXTO: [string, ColorToken, ColorToken][] = [
    ['el reloj gigante y los títulos', 'ink900', 'primary50'],
    ['«Ingresa tu PIN personal»', 'ink700', 'primary50'],
    ['las pistas pequeñas del pie', 'ink500', 'primary50'],
    ['el dígito de cada tecla', 'ink900', 'surface'],
    ['la tecla apagada, «Borrar»', 'ink700', 'canvas'],
    // El que el navegador no puede alcanzar.
    ['«ese PIN no es correcto»', 'danger600', 'primary50'],
    ['«entrada registrada a las…»', 'success600', 'surface'],
  ];

  it.each(TEXTO)('%s llega a 4,5:1 en los dos temas', (_nombre, tinta, fondo) => {
    expect(contraste(lightColors[tinta], lightColors[fondo])).toBeGreaterThanOrEqual(4.5);
    expect(contraste(darkColors[tinta], darkColors[fondo])).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * Y EL CRITERIO PROPIO DE ESTA TAREA: el oscuro no puede quedarse con MENOS MARGEN que
   * el claro, allí donde hay poco margen.
   *
   * La primera versión de esta prueba decía «oscuro >= claro - 0,5» a secas, y fallaba
   * en tres pares: el reloj daba 17,5:1 en claro y 15,2:1 en oscuro. Los dos se leen a
   * varios metros; la regla estaba mal, no el color. A esa altura la diferencia no la
   * ve nadie, y una prueba que se queja de eso acaba desactivada.
   *
   * Lo que de verdad hay que impedir es lo otro: que el claro pase raspando y el oscuro
   * pase MÁS raspando, porque entonces la pantalla que se usa de noche —la que más
   * falta hace que se lea— es la peor de las dos y nada avisa. Así que la comparación
   * solo muerde cerca del suelo: por encima de 5:1 basta con llegar a 5:1, y por debajo
   * el oscuro tiene que igualar al claro.
   */
  const MARGEN_TEXTO = 5;

  it.each(TEXTO)('%s conserva en oscuro el margen que tenía en claro', (_nombre, tinta, fondo) => {
    const claro = contraste(lightColors[tinta], lightColors[fondo]);
    const oscuro = contraste(darkColors[tinta], darkColors[fondo]);
    expect(oscuro).toBeGreaterThanOrEqual(Math.min(claro, MARGEN_TEXTO));
  });

  /**
   * LO QUE NO ES TEXTO: la forma de la tecla y el punto del PIN.
   *
   * WCAG 1.4.11 pide 3:1 a lo que hace falta ver para entender un control. Y aquí hay
   * DEUDA, medida y anotada, que NO es del tema oscuro:
   *
   *   el aro del punto de PIN vacío, contra su relleno → 1,49 en claro · 1,39 en oscuro
   *   el aro del punto vacío, contra el fondo          → 1,35 en claro · 1,33 en oscuro
   *   el borde de la tecla, contra el fondo            → 1,15 en claro · 1,26 en oscuro
   *   la cara de la tecla, contra el fondo             → 1,10 en claro · 1,05 en oscuro
   *
   * Los cuatro fallan en los DOS temas y llevan fallando desde siempre: el oscuro no
   * empeoró nada. Lo que se lee es el dígito —15:1 y de 33 px—, y los puntos LLENOS sí
   * se ven (4,50 en claro, 5,57 en oscuro); lo flojo es contar los que faltan.
   *
   * No se arregla aquí porque arreglarlo cambia el aspecto del tema claro, que esta
   * tarea no venía a tocar, y el antes/después de las dos versiones lo tiene que ver
   * Andree: tarea KTyF83SqbWRoAEjnZmMB. Lo que sí se hace es que no pueda crecer en
   * silencio: la prueba de abajo exige que sigan siendo exactamente estos cuatro.
   */
  const NO_TEXTO: [string, ColorToken, ColorToken][] = [
    ['punto de PIN lleno contra el fondo', 'primary500', 'primary50'],
    ['punto de PIN en error contra el fondo', 'danger600', 'primary50'],
    ['aro del punto vacío contra su relleno', 'primary200', 'surface'],
    ['aro del punto vacío contra el fondo', 'primary200', 'primary50'],
    ['borde de la tecla contra el fondo', 'border', 'primary50'],
    ['cara de la tecla contra el fondo', 'surface', 'primary50'],
  ];

  /** Los que ya fallaban en claro antes del modo oscuro. Tarea aparte, ver arriba. */
  const DEUDA_NO_TEXTUAL = [
    'aro del punto vacío contra su relleno',
    'aro del punto vacío contra el fondo',
    'borde de la tecla contra el fondo',
    'cara de la tecla contra el fondo',
  ];

  it.each(NO_TEXTO)('%s llega a 3:1 en los dos temas', (nombre, tinta, fondo) => {
    if (DEUDA_NO_TEXTUAL.includes(nombre)) return;
    expect(contraste(lightColors[tinta], lightColors[fondo])).toBeGreaterThanOrEqual(3);
    expect(contraste(darkColors[tinta], darkColors[fondo])).toBeGreaterThanOrEqual(3);
  });

  it('la deuda no textual sigue siendo exactamente esos cuatro pares', () => {
    const flojos = NO_TEXTO.filter(
      ([, tinta, fondo]) =>
        contraste(lightColors[tinta], lightColors[fondo]) < 3 ||
        contraste(darkColors[tinta], darkColors[fondo]) < 3,
    ).map(([nombre]) => nombre);
    expect(flojos.sort()).toEqual([...DEUDA_NO_TEXTUAL].sort());
  });

  /**
   * Y la deuda que queda tampoco puede empeorar en oscuro. Es lo único que esta tarea
   * puede prometer sobre ella sin salirse de su alcance, y se comprueba.
   *
   * Aquí sí se compara con una tolerancia plana, y puede: estos pares viven todos entre
   * 1 y 5,6, o sea justo en la zona donde un punto de contraste es la diferencia entre
   * ver el control y adivinarlo. El problema de la regla plana era el otro extremo, y
   * aquí no hay ninguno.
   */
  it.each(NO_TEXTO)('%s tampoco empeora en oscuro', (_nombre, tinta, fondo) => {
    const claro = contraste(lightColors[tinta], lightColors[fondo]);
    const oscuro = contraste(darkColors[tinta], darkColors[fondo]);
    expect(oscuro).toBeGreaterThanOrEqual(claro - 0.5);
  });
});
