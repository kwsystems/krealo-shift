import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { formatWeekdayNarrow, type DateKey } from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { chart, chartMarks } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * LA TIRA DE LA SEMANA: las horas de una persona, día por día, en la fila de Equipo.
 *
 * Lo pidió Andree el 30-sep: «no solo ver que ha hecho 36 horas, sino cada día cuántas».
 * Un total no dice si son cinco jornadas de siete horas o tres maratones y dos ausencias;
 * siete columnas pequeñas lo dicen sin leer un número, como la tarjeta de marcación de
 * papel, que tenía un casillero por día.
 *
 * TODAS LAS FILAS MIDEN CONTRA LA MISMA ESCALA (`escala`, que da la lista): así la
 * columna del martes de una persona se compara con la del martes de la de arriba. Con una
 * escala por fila, dos horas y diez horas se verían igual de altas.
 *
 * Un día trabajado es una columna; uno sin horas, la línea base sola; uno que todavía no
 * ha llegado, ni eso. La inicial de hoy va en color, porque su columna aún crece.
 * Las cifras exactas están en la ficha: esto es para ver la forma de la semana.
 */

export type DiaDeLaTira = {
  dia: DateKey;
  minutos: number;
  esHoy: boolean;
  futuro: boolean;
};

const ALTO = 24;

export function TiraDeLaSemana({
  dias,
  escala,
  language,
  testID,
}: {
  dias: readonly DiaDeLaTira[];
  /** Los minutos que llenan la columna entera. */
  escala: number;
  language: SupportedLanguage;
  testID?: string;
}) {
  const { colors } = useTheme();
  const estilos = useEstilos();
  const tope = escala > 0 ? escala : 1;

  return (
    // Sin nombre accesible propio: el de la fila ya dice las horas de cada día.
    <View style={estilos.tira} testID={testID} aria-hidden>
      {dias.map((dia) => {
        const alto = dia.minutos > 0 ? Math.max(3, Math.min(1, dia.minutos / tope) * ALTO) : 0;
        return (
          <View key={dia.dia} style={estilos.casilla}>
            <View style={estilos.trazado}>
              {alto > 0 ? (
                <View
                  style={[estilos.barra, { height: alto, backgroundColor: chart(colors).series1 }]}
                  testID={testID === undefined ? undefined : `${testID}-${dia.dia}`}
                />
              ) : null}
              {dia.futuro ? null : <View style={estilos.base} />}
            </View>
            <AppText
              variant="label"
              tone={dia.esHoy ? 'primary' : 'subtle'}
              style={dia.esHoy ? estilos.inicialDeHoy : null}
            >
              {formatWeekdayNarrow(dia.dia, language)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** Lo que mide la tira: siete casillas de 14 px con 3 de hueco. La fila le guarda sitio. */
export const ANCHO_DE_LA_TIRA = 7 * 14 + 6 * 3;

const useEstilos = estilosDelTema((colors) => ({
  tira: { flexDirection: 'row', gap: 3, width: ANCHO_DE_LA_TIRA, flexShrink: 0 },
  casilla: { width: 14, alignItems: 'center', gap: 2 },
  trazado: { height: ALTO, width: 14, justifyContent: 'flex-end', alignItems: 'center' },
  // Solo el extremo del dato se redondea; el que apoya en la base, cuadrado.
  barra: {
    width: 8,
    borderTopLeftRadius: chartMarks.endRadius,
    borderTopRightRadius: chartMarks.endRadius,
  },
  base: { height: 1, width: 14, backgroundColor: chart(colors).grid },
  inicialDeHoy: { fontWeight: '700' },
}));
