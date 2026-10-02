import { View } from 'react-native';

import { estilosDelTema } from '@/theme/estilos';
import { chart, chartMarks } from '@/theme/tokens';

/**
 * EL MEDIDOR: lo trabajado contra lo programado, en una sola barra (2-oct).
 *
 * Es la pieza que Homebase pone primero en sus reportes —programado contra real, de un
 * vistazo—, y aquí hace tres trabajos a la vez:
 *
 *   - LA PISTA es lo PROGRAMADO del periodo entero: un contorno, no un relleno, porque no
 *     es algo que pasó sino lo que se esperaba. Se lee como un hueco por llenar.
 *   - EL RELLENO es lo TRABAJADO (jornadas cerradas), en el color de las horas de toda la
 *     pantalla; detrás, en VERDE, lo que va EN CURSO —el verde de «Trabajando» en toda la
 *     app—, separado por el hueco de superficie de las barras apiladas.
 *   - LA MARCA vertical es lo programado HASTA AHORA: lo que ya tendría que estar hecho. El
 *     relleno que llega a la marca va al día; el que se queda antes, va atrás.
 *
 * Si se trabajó más de lo programado, el relleno se sale de la pista: el exceso se ve como
 * exceso, no se recorta.
 *
 * NO LLEVA NÚMEROS DENTRO: los dice quien lo usa, al lado y en tinta. El color identifica,
 * la palabra dice cuánto (ver la leyenda de `ResumenDelPeriodo`).
 */
export function Medidor({
  trabajado,
  enCurso = 0,
  programado,
  hastaAhora,
  alto = 14,
  accessibilityLabel,
  testID,
}: {
  trabajado: number;
  enCurso?: number;
  programado: number;
  /** `null` cuando no tiene sentido marcarlo: un periodo pasado ya está entero. */
  hastaAhora: number | null;
  alto?: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const estilos = useEstilos();
  const escala = Math.max(programado, trabajado + enCurso, hastaAhora ?? 0, 1);
  const pct = (minutos: number) =>
    `${Math.min(100, (Math.max(0, minutos) / escala) * 100)}%` as const;
  const radio = alto / 2;
  const marcaVisible = hastaAhora !== null && hastaAhora > 0 && hastaAhora < programado;

  return (
    <View
      style={[estilos.medidor, { height: alto + 8 }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {programado > 0 ? (
        <View
          style={[
            estilos.pista,
            { width: pct(programado), height: alto, borderRadius: radio, top: 4 },
          ]}
        />
      ) : null}
      {trabajado > 0 ? (
        <View
          style={[
            estilos.trabajado,
            {
              width: pct(trabajado),
              height: alto,
              top: 4,
              borderTopLeftRadius: radio,
              borderBottomLeftRadius: radio,
              borderTopRightRadius: enCurso > 0 ? 0 : radio,
              borderBottomRightRadius: enCurso > 0 ? 0 : radio,
            },
          ]}
          testID={testID === undefined ? undefined : `${testID}-trabajado`}
        />
      ) : null}
      {enCurso > 0 ? (
        <View
          style={[
            estilos.enCurso,
            {
              left: pct(trabajado),
              width: pct(enCurso),
              height: alto,
              top: 4,
              marginLeft: trabajado > 0 ? chartMarks.surfaceGap : 0,
              borderTopLeftRadius: trabajado > 0 ? 0 : radio,
              borderBottomLeftRadius: trabajado > 0 ? 0 : radio,
              borderTopRightRadius: radio,
              borderBottomRightRadius: radio,
            },
          ]}
          testID={testID === undefined ? undefined : `${testID}-en-curso`}
        />
      ) : null}
      {marcaVisible ? (
        <View
          style={[estilos.marca, { left: pct(hastaAhora), height: alto + 8 }]}
          testID={testID === undefined ? undefined : `${testID}-hasta-ahora`}
        />
      ) : null}
    </View>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  medidor: { position: 'relative', width: '100%' },
  /*
   * LA PISTA EN CONTORNO, con `reglaFuerte` (3,01:1 contra la tarjeta): es un elemento con
   * significado —lo programado— y por eso llega al 3:1 de los gráficos. El relleno
   * `hundido` solo la asienta; el que dice dónde acaba es el contorno.
   */
  pista: {
    position: 'absolute',
    left: 0,
    backgroundColor: colors.hundido,
    borderWidth: 1,
    borderColor: colors.reglaFuerte,
  },
  trabajado: { position: 'absolute', left: 0, backgroundColor: chart(colors).series1 },
  enCurso: { position: 'absolute', backgroundColor: colors.success600 },
  /* Dos píxeles de tinta: es la referencia, y se ve encima de cualquier relleno. */
  marca: { position: 'absolute', top: 0, width: 2, marginLeft: -1, backgroundColor: colors.ink900 },
}));
