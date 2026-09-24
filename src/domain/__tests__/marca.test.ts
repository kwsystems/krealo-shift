import { contraste, distanciaPerceptual, rampaDeMarca, SEPARACION_MINIMA } from '@/domain/marca';
import { darkColors, lightColors } from '@/theme/tokens';

/**
 * EL COLOR DE MARCA DE UNA EMPRESA.
 *
 * Lo que se prueba aquí no son valores concretos —el tono exacto que sale de derivar un
 * color se puede afinar sin que nada esté mal— sino las tres PROMESAS que hacen que esto
 * se pueda ofrecer a un cliente sin cruzar los dedos:
 *
 *   1. Pase lo que pase con el color que elija, lo que se pinta encima SE LEE.
 *   2. Su color sigue siendo reconociblemente el suyo: se cede en luminosidad, no en tono.
 *   3. Si su marca se parece a un color de ESTADO, se le dice, con el número.
 *
 * La primera es la que de verdad importa y es la que ningún competidor de esta categoría
 * garantiza: «sube tu color» y a ver qué sale.
 */

const ESTADOS_CLARO = {
  trabajando: lightColors.success600,
  pausa: lightColors.warning600,
  tarde: lightColors.danger600,
};
const ESTADOS_OSCURO = {
  trabajando: darkColors.success600,
  pausa: darkColors.warning600,
  tarde: darkColors.danger600,
};

/** Un barrido de tonos por toda la rueda, con croma y luminosidad variados. */
function coloresDePrueba(): string[] {
  const salida: string[] = [];
  for (let h = 0; h < 360; h += 15) {
    for (const [s, l] of [
      [0.9, 0.5],
      [0.45, 0.75],
      [1, 0.25],
    ] as const) {
      salida.push(hslAHex(h, s, l));
    }
  }
  return salida;
}

describe('rampaDeMarca', () => {
  it('lo que se pinta encima SE LEE, sea cual sea el color elegido', () => {
    /*
     * LA PROMESA GRANDE, y por eso se prueba con 72 colores de toda la rueda en vez de con
     * tres a mano: el fallo que hay que impedir es «un cliente eligió un amarillo pálido y
     * su reloj se quedó ilegible», y ese cliente no va a elegir uno de mis tres ejemplos.
     */
    const fallos: string[] = [];
    for (const [nombre, superficie, estados] of [
      ['claro', lightColors.surface, ESTADOS_CLARO],
      ['oscuro', darkColors.raised, ESTADOS_OSCURO],
    ] as const) {
      for (const base of coloresDePrueba()) {
        const v = rampaDeMarca(base, superficie, estados);
        if (v === null) {
          fallos.push(`${nombre} ${base}: no devolvió rampa`);
          continue;
        }
        const texto = contraste(v.rampa.p600, superficie);
        const forma = contraste(v.rampa.p500, superficie);
        const sobreSuave = contraste(v.rampa.p600, v.rampa.p50);
        if (texto < 4.4) fallos.push(`${nombre} ${base}: texto ${texto.toFixed(2)}`);
        if (forma < 2.9) fallos.push(`${nombre} ${base}: forma ${forma.toFixed(2)}`);
        if (sobreSuave < 4.4) fallos.push(`${nombre} ${base}: sobre el suave ${sobreSuave.toFixed(2)}`);
      }
    }
    expect(fallos).toEqual([]);
  });

  it('se cede en luminosidad y NO en tono: sigue siendo su color', () => {
    /*
     * Lo que la gente reconoce como «su» color es el TONO. Que salga un poco más oscuro
     * casi nadie lo nota; que un morado corporativo salga azul lo nota todo el mundo, y con
     * razón. Por eso la conversión baja el croma en vez de recortar cada canal, que es lo
     * obvio y lo que tuerce el tono.
     */
    const desvios: string[] = [];
    for (const base of coloresDePrueba()) {
      const v = rampaDeMarca(base, lightColors.surface, ESTADOS_CLARO);
      if (v === null) continue;
      const giro = diferenciaDeTono(base, v.rampa.p600);
      if (giro > 12) desvios.push(`${base} -> ${v.rampa.p600}: ${giro.toFixed(1)}°`);
    }
    expect(desvios).toEqual([]);
  });

  it('la escalera no se invierte: del más tenue al más fuerte, en orden', () => {
    /*
     * ESTE FALLO YA PASÓ EN ESTA APP, con los colores fijos: `primary50` acabó siendo más
     * OSCURO que `primary100` en el tema oscuro, o sea la jerarquía al revés, y está
     * escrito en `tokens.ts`. Derivando seis escalones de un color que elige un cliente,
     * el riesgo deja de ser una anécdota y pasa a ser sistemático.
     *
     * Se mide en luminancia, que es la escala en la que el ojo ordena claro y oscuro.
     */
    const desordenes: string[] = [];
    for (const [nombre, superficie, estados] of [
      ['claro', lightColors.surface, ESTADOS_CLARO],
      ['oscuro', darkColors.raised, ESTADOS_OSCURO],
    ] as const) {
      const haciaAbajo = contraste(superficie, '#000000') > contraste(superficie, '#FFFFFF');
      for (const base of coloresDePrueba()) {
        const v = rampaDeMarca(base, superficie, estados);
        if (v === null) continue;
        const pasos = [v.rampa.p50, v.rampa.p100, v.rampa.p200, v.rampa.p500, v.rampa.p600, v.rampa.p700];
        const claridades = pasos.map((c) => contraste(c, '#000000'));
        for (let i = 1; i < claridades.length; i += 1) {
          const anterior = claridades[i - 1] ?? 0;
          const actual = claridades[i] ?? 0;
          // En claro la escalera baja (cada paso más oscuro); en oscuro sube.
          const ordenado = haciaAbajo ? actual <= anterior + 0.02 : actual >= anterior - 0.02;
          if (!ordenado) desordenes.push(`${nombre} ${base}: paso ${i} rompe el orden`);
        }
      }
    }
    expect(desordenes).toEqual([]);
  });

  it('avisa cuando la marca se parece a un color de ESTADO', () => {
    // Un verde de marca queda a un paso del «Trabajando», y eso no lo arregla ninguna
    // luminosidad: cambiarlo sería cambiarle la marca al cliente, así que se avisa.
    const v = rampaDeMarca('#1FA971', lightColors.surface, ESTADOS_CLARO);
    expect(v).not.toBeNull();
    expect(v?.avisos.map((a) => a.estado)).toContain('trabajando');
    const aviso = v?.avisos.find((a) => a.estado === 'trabajando');
    expect(aviso?.distancia).toBeLessThan(SEPARACION_MINIMA);
  });

  it('un color que no se parece a ningún estado no molesta con avisos', () => {
    // El violeta de la casa: si esto avisara, el aviso sería ruido y nadie lo leería.
    const v = rampaDeMarca(lightColors.primary600, lightColors.surface, ESTADOS_CLARO);
    expect(v?.avisos).toEqual([]);
  });

  it('un gris se acepta pero se dice que dejó de ser un color', () => {
    const v = rampaDeMarca('#7A7A7A', lightColors.surface, ESTADOS_CLARO);
    expect(v?.sinColor).toBe(true);
    // Y aun así cumple el contraste: aceptar no puede significar romper.
    expect(contraste(v?.rampa.p600 ?? '#000000', lightColors.surface)).toBeGreaterThanOrEqual(4.4);
  });

  it('un valor que no es un color devuelve null en vez de adivinar', () => {
    for (const malo of ['', 'azul', '#12345', '#GGGGGG', 'rgb(1,2,3)']) {
      expect(rampaDeMarca(malo, lightColors.surface, ESTADOS_CLARO)).toBeNull();
    }
  });

  it('la distancia perceptual es la misma medida que usan las anclas', () => {
    expect(distanciaPerceptual('#FFFFFF', '#FFFFFF')).toBe(0);
    expect(distanciaPerceptual('#FFFFFF', '#000000')).toBeGreaterThan(90);
  });
});

/** HSL a `#RRGGBB`, solo para generar el barrido de prueba. */
function hslAHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

/** Cuánto giró el tono, en grados. */
function diferenciaDeTono(unColor: string, otroColor: string): number {
  const tono = (hex: string) => {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    const lineal = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const r = lineal((n >> 16) & 255);
    const g = lineal((n >> 8) & 255);
    const b = lineal(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return (Math.atan2(B, A) * 180) / Math.PI;
  };
  const d = Math.abs(tono(unColor) - tono(otroColor)) % 360;
  return d > 180 ? 360 - d : d;
}
