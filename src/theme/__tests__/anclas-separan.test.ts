import {
  anclasDeIdentidadClaro,
  anclasDeIdentidadOscuro,
  darkColors,
  lightColors,
} from '@/theme/tokens';

/**
 * LOS TONOS DE ANCLA SE DISTINGUEN DE VERDAD, Y ESO SE CALCULA.
 *
 * Esta prueba existe porque la versión anterior de la paleta NO se distinguía y yo la di
 * por buena mirándola. Eran cinco lavados pálidos; medidos en OKLab quedaban a 1,7–3,1 de
 * separación sobre un umbral de 8, o sea el mismo color cinco veces. El fallo original
 * —«todos iguales»— lo vio Andree en una captura; que el arreglo tampoco servía solo se
 * vio calculándolo.
 *
 * Por eso la comprobación es aritmética y corre en cada ejecución, en vez de ser un
 * comentario que dice que se miró una vez. Un color se puede cambiar en un segundo y el
 * daño —una lista donde dos personas parecen la misma— no se nota hasta que alguien se
 * confunde de persona en un parte de horas.
 *
 * LOS TRES CRITERIOS, Y POR QUÉ CADA UNO:
 *
 * 1. `SEPARACION_MINIMA = 8` entre anclas. Es el umbral habitual para categorías que se
 *    distinguen por color. Por debajo, dos discos contiguos se leen como el mismo.
 *
 * 2. La misma distancia de 8 contra los colores de ESTADO. Un ancla que se parece al verde
 *    de «Trabajando» o al ámbar de «En descanso» es peor que no tener ancla: inventa un
 *    estado donde solo hay una persona.
 *
 * 3. Contraste: 4,5:1 de la letra sobre su disco (es texto pequeño) y 3:1 del disco contra
 *    su superficie (es una forma, no texto). Sin el segundo, un ancla puede separarse
 *    perfectamente de las otras cinco y aun así desaparecer en la página.
 */

const SEPARACION_MINIMA = 8;
const CONTRASTE_TEXTO = 4.5;
const CONTRASTE_FORMA = 3;

describe('los tonos de ancla se distinguen', () => {
  describe.each([
    ['claro', anclasDeIdentidadClaro, lightColors],
    ['oscuro', anclasDeIdentidadOscuro, darkColors],
  ] as const)('tema %s', (_nombre, tonos, paleta) => {
    it('cada par de anclas se separa lo suficiente para leerse como dos colores', () => {
      const flojos: string[] = [];
      for (let i = 0; i < tonos.length; i += 1) {
        for (let j = i + 1; j < tonos.length; j += 1) {
          const a = tonos[i]?.bg ?? '';
          const b = tonos[j]?.bg ?? '';
          const d = distanciaPerceptual(a, b);
          if (d < SEPARACION_MINIMA) flojos.push(`${a} y ${b}: ${d.toFixed(1)}`);
        }
      }
      expect(flojos).toEqual([]);
    });

    it('ningún ancla se confunde con un color de estado', () => {
      // Los tres que significan algo en esta app. Si un ancla se les acerca, la fila
      // parece estar diciendo «trabajando» o «tarde» cuando solo dice quién es.
      const estados = {
        trabajando: paleta.success600,
        descanso: paleta.warning600,
        tarde: paleta.danger600,
      };
      const choques: string[] = [];
      for (const tono of tonos) {
        for (const [estado, color] of Object.entries(estados)) {
          const d = distanciaPerceptual(tono.bg, color);
          if (d < SEPARACION_MINIMA) choques.push(`${tono.bg} vs ${estado} (${color}): ${d.toFixed(1)}`);
        }
      }
      expect(choques).toEqual([]);
    });

    it('la letra se lee sobre su disco y el disco se ve sobre la página', () => {
      const problemas: string[] = [];
      for (const tono of tonos) {
        const letra = contrasteWCAG(tono.fg, tono.bg);
        if (letra < CONTRASTE_TEXTO) problemas.push(`letra ${tono.fg} sobre ${tono.bg}: ${letra.toFixed(2)}`);
        const disco = contrasteWCAG(tono.bg, paleta.surface);
        if (disco < CONTRASTE_FORMA) problemas.push(`disco ${tono.bg} sobre ${paleta.surface}: ${disco.toFixed(2)}`);
      }
      expect(problemas).toEqual([]);
    });
  });
});

/**
 * Distancia perceptual en OKLab, ×100.
 *
 * NO se usa la distancia en RGB, que es la tentación obvia y la equivocada: en RGB dos
 * azules separadísimos a la vista salen más cerca que un azul y un gris que se confunden.
 * OKLab está construido para que la distancia numérica se parezca a la diferencia que ve
 * una persona, que es justo lo que aquí se quiere afirmar.
 */
function distanciaPerceptual(unColor: string, otroColor: string): number {
  const [l1, a1, b1] = aOklab(unColor);
  const [l2, a2, b2] = aOklab(otroColor);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

function aOklab(hex: string): [number, number, number] {
  const [r, g, b] = aLineal(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Contraste WCAG entre dos colores opacos. Devuelve el cociente, de 1 a 21. */
function contrasteWCAG(unColor: string, otroColor: string): number {
  const luminancias = [luminancia(unColor), luminancia(otroColor)].sort((x, y) => y - x);
  return ((luminancias[0] ?? 0) + 0.05) / ((luminancias[1] ?? 0) + 0.05);
}

function luminancia(hex: string): number {
  const [r, g, b] = aLineal(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** De `#RRGGBB` a tres canales lineales 0..1, deshaciendo la curva de sRGB. */
function aLineal(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const canales = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((valor) => {
    const c = valor / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return [canales[0] ?? 0, canales[1] ?? 0, canales[2] ?? 0];
}
