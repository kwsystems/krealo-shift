import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Row, Stack } from '@/components/ui/layout';
import {
  addDaysToKey,
  dayOfWeek,
  formatDateKeyLong,
  formatWeekdayShort,
  weekDays,
  weekStartOfKey,
  type DateKey,
} from '@/features/schedules/week';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';

/**
 * EL CALENDARIO DE UN MES PARA ELEGIR DÍAS, seguidos o sueltos (Reportes, 30-sep).
 *
 * LO ELEGIDO SEGUIDO SE LEE COMO UNA BANDA, y lo suelto como casillas separadas. Dos días
 * marcados que se tocan en la misma semana pierden la esquina que los separa, así que «del
 * 7 al 12» es una sola barra y «los sábados» son cinco cuadros sueltos en una columna. La
 * forma dice lo que se eligió antes de leer ningún número.
 *
 * HOY LLEVA UN ANILLO y lo que viene después no se puede tocar: un día que todavía no ha
 * pasado no tiene horas que contar, y dejar elegirlo sería ofrecer un reporte vacío.
 *
 * EL PUNTO BAJO EL NÚMERO dice que ese día hubo horas en la sede: así se ve dónde hay algo
 * que mirar sin abrir cada día para descubrirlo.
 */

export function CalendarioDeDias({
  mes,
  elegidos,
  hoy,
  weekStartsOn,
  language,
  conHoras,
  onDia,
  onDiaDeSemana,
  testID = 'calendario',
}: {
  /** Cualquier día del mes; se pinta el mes entero. */
  mes: DateKey;
  elegidos: ReadonlySet<DateKey>;
  hoy: DateKey;
  weekStartsOn: number;
  language: SupportedLanguage;
  /** Los días con horas registradas, para el punto. */
  conHoras?: ReadonlySet<DateKey>;
  onDia: (dia: DateKey) => void;
  /**
   * Tocar la cabecera de una columna —«sáb»— elige o quita todos esos días del mes. Sin
   * esto la cabecera es solo un rótulo.
   */
  onDiaDeSemana?: (diaDeSemana: number) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();

  const primero = `${mes.slice(0, 7)}-01`;
  const ultimo = ultimoDelMes(primero);
  const cabecera = weekDays(weekStartOfKey(primero, weekStartsOn));
  const huecoInicial = (dayOfWeek(primero) - (((weekStartsOn % 7) + 7) % 7) + 7) % 7;

  const celdas: (DateKey | null)[] = [
    ...Array.from({ length: huecoInicial }, () => null),
    ...Array.from({ length: Number(ultimo.slice(8)) }, (_, i) => addDaysToKey(primero, i)),
  ];
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas = Array.from({ length: celdas.length / 7 }, (_, i) =>
    celdas.slice(i * 7, i * 7 + 7),
  );

  return (
    <Stack gap={spacing.xs} testID={testID}>
      <Row gap={0}>
        {cabecera.map((dia) => {
          const rotulo = formatWeekdayShort(dia, language);
          if (onDiaDeSemana === undefined) {
            return (
              <View key={dia} style={estilos.cabecera}>
                <AppText variant="label" tone="subtle">
                  {rotulo}
                </AppText>
              </View>
            );
          }
          return (
            <Pressable
              key={dia}
              accessibilityRole="button"
              accessibilityLabel={t('reports.pickWeekday', { day: rotulo })}
              onPress={() => onDiaDeSemana(dayOfWeek(dia))}
              testID={`${testID}-columna-${dayOfWeek(dia)}`}
              style={({ pressed }) => [
                estilos.cabecera,
                estilos.cabeceraTocable,
                pressed ? estilos.pulsado : null,
              ]}
            >
              <AppText variant="label" tone="primary">
                {rotulo}
              </AppText>
            </Pressable>
          );
        })}
      </Row>

      {semanas.map((semana, fila) => (
        <Row key={semana.find((dia) => dia !== null) ?? fila} gap={0}>
          {semana.map((dia, columna) => {
            if (dia === null)
              return <View key={`hueco-${fila}-${columna}`} style={estilos.celda} />;
            const elegido = elegidos.has(dia);
            const futuro = dia > hoy;
            const esHoy = dia === hoy;
            // La banda: sin esquina hacia el vecino elegido de la misma semana.
            const pegadoIzquierda = elegido && columna > 0 && elegidos.has(addDaysToKey(dia, -1));
            const pegadoDerecha = elegido && columna < 6 && elegidos.has(addDaysToKey(dia, 1));
            const horas = conHoras?.has(dia) === true;
            const nombre = formatDateKeyLong(dia, language);

            return (
              <Pressable
                key={dia}
                accessibilityRole="checkbox"
                aria-checked={elegido}
                aria-disabled={futuro}
                accessibilityState={{ checked: elegido, disabled: futuro }}
                accessibilityLabel={[
                  nombre,
                  esHoy ? t('reports.pickToday') : null,
                  horas ? t('reports.pickHasHours') : null,
                ]
                  .filter((parte): parte is string => parte !== null)
                  .join(', ')}
                disabled={futuro}
                onPress={() => onDia(dia)}
                testID={`${testID}-dia-${dia}`}
                style={({ pressed }) => [
                  estilos.celda,
                  elegido ? estilos.elegido : null,
                  pegadoIzquierda ? estilos.sinEsquinaIzquierda : null,
                  pegadoDerecha ? estilos.sinEsquinaDerecha : null,
                  esHoy && !elegido ? estilos.hoy : null,
                  pressed && !elegido ? estilos.pulsado : null,
                ]}
              >
                <AppText
                  variant={esHoy ? 'bodyStrong' : 'body'}
                  tone={elegido ? 'onPrimary' : futuro ? 'subtle' : 'default'}
                  tabular
                >
                  {String(Number(dia.slice(8)))}
                </AppText>
                <View
                  style={[
                    estilos.punto,
                    horas ? (elegido ? estilos.puntoSobreElegido : estilos.puntoConHoras) : null,
                  ]}
                />
              </Pressable>
            );
          })}
        </Row>
      ))}
    </Stack>
  );
}

function ultimoDelMes(primero: DateKey): DateKey {
  const siguiente =
    Number(primero.slice(5, 7)) === 12
      ? `${Number(primero.slice(0, 4)) + 1}-01-01`
      : `${primero.slice(0, 4)}-${String(Number(primero.slice(5, 7)) + 1).padStart(2, '0')}-01`;
  return addDaysToKey(siguiente, -1);
}

const useEstilos = estilosDelTema((colors) => ({
  cabecera: {
    flex: 1,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* La cabecera que se toca lo parece: color de enlace y el mismo alto táctil que un día. */
  cabeceraTocable: { minHeight: sizes.touchTargetMin, borderRadius: radii.input },
  celda: {
    flex: 1,
    minHeight: sizes.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
    gap: 2,
  },
  elegido: { backgroundColor: colors.primary600 },
  sinEsquinaIzquierda: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  sinEsquinaDerecha: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  hoy: { borderWidth: borderWidth.focus, borderColor: colors.primary600 },
  pulsado: { backgroundColor: colors.primary50 },
  /* El punto siempre ocupa su sitio, esté o no: así los números no bailan de altura. */
  punto: { width: 5, height: 5, borderRadius: 3 },
  puntoConHoras: { backgroundColor: colors.primary600 },
  puntoSobreElegido: { backgroundColor: colors.onPrimary },
}));
