import { useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { CalendarioDeDias } from '@/components/schedule/calendario-de-dias';
import { AdminSheet, Chip, InlineNotice, SegmentedControl } from '@/components/schedule/fields';
import { MonthNavigator } from '@/components/schedule/week-tools';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton } from '@/components/ui/buttons';
import { Row, Stack } from '@/components/ui/layout';
import { addDaysToKey, dayOfWeek, type DateKey } from '@/features/schedules/week';
import { useDailySummaries } from '@/features/timesheets/hooks';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { radii, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { DIAS_MAXIMOS, diasDeDistancia, diasEntre, periodoDeDias } from './periodo';
import { etiquetaDeDias } from './etiqueta-del-periodo';

/**
 * ELEGIR LOS DÍAS DE UN REPORTE (Andree, 30-sep: «por día o varios días o ciertos días en
 * específico»).
 *
 * DOS MANERAS DE TOCAR, porque son dos preguntas distintas:
 *   - «Seguidos»: el primer toque es el primer día y el segundo el último. Es «del 7 al 12».
 *   - «Sueltos»: cada toque pone o quita un día. Es «el lunes 7, el jueves 10 y el sábado
 *     12», o —tocando la cabecera— «los sábados del mes».
 * Se puede pasar de una a otra sin perder lo marcado: elegir del 1 al 30 seguidos y luego,
 * en sueltos, quitar los domingos.
 *
 * EL REPORTE NO CAMBIA A CADA TOQUE, sino al pulsar «Ver». Recalcular el tablero entero
 * —y pedir sus consultas— por cada día marcado sería un parpadeo por toque, y lo que se
 * quiere ver es el resultado de la elección, no sus pasos.
 */

type Modo = 'seguidos' | 'sueltos';

export function ElegirDiasSheet({
  inicial,
  hoy,
  weekStartsOn,
  timezone,
  language,
  locationId,
  onApply,
  onClose,
}: {
  inicial: readonly DateKey[];
  hoy: DateKey;
  weekStartsOn: number;
  timezone: string;
  language: SupportedLanguage;
  locationId: string | null;
  onApply: (dias: DateKey[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [modo, setModo] = useState<Modo>('seguidos');
  const [elegidos, setElegidos] = useState<ReadonlySet<DateKey>>(() => new Set(inicial));
  // El primer día de un tramo a medias, en «Seguidos»: el siguiente toque lo cierra.
  const [ancla, setAncla] = useState<DateKey | null>(null);
  const [mes, setMes] = useState<DateKey>(() => {
    const ultimo = [...inicial].sort().at(-1) ?? hoy;
    return `${ultimo.slice(0, 7)}-01`;
  });

  const primero = `${mes.slice(0, 7)}-01`;
  const ultimoDelMes = addDaysToKey(desplazarMes(primero, 1), -1);
  const delMes = useDailySummaries({ locationId, from: primero, to: ultimoDelMes });
  const conHoras = new Set(
    (delMes.data ?? []).filter((fila) => fila.net_minutes > 0).map((fila) => fila.work_date),
  );

  const lista = [...elegidos].sort();
  const periodo = periodoDeDias(lista, timezone);
  const demasiado = periodo !== null && diasDeDistancia(periodo.from, periodo.to) > DIAS_MAXIMOS;

  const tocarDia = (dia: DateKey) => {
    if (modo === 'sueltos') {
      setElegidos((actual) => {
        const siguiente = new Set(actual);
        if (siguiente.has(dia)) siguiente.delete(dia);
        else siguiente.add(dia);
        return siguiente;
      });
      return;
    }
    if (ancla === null) {
      setElegidos(new Set([dia]));
      setAncla(dia);
      return;
    }
    setElegidos(new Set(diasEntre(ancla, dia)));
    setAncla(null);
  };

  /* Los sábados del mes: si ya estaban todos, se quitan; si no, se ponen. Solo hasta hoy. */
  const tocarColumna = (diaDeSemana: number) => {
    const delDia = diasEntre(primero, ultimoDelMes).filter(
      (dia) => dayOfWeek(dia) === diaDeSemana && dia <= hoy,
    );
    if (delDia.length === 0) return;
    setElegidos((actual) => {
      const siguiente = new Set(actual);
      const todos = delDia.every((dia) => siguiente.has(dia));
      for (const dia of delDia) {
        if (todos) siguiente.delete(dia);
        else siguiente.add(dia);
      }
      return siguiente;
    });
  };

  const atajo = (dias: number) => {
    setElegidos(new Set(diasEntre(addDaysToKey(hoy, -(dias - 1)), hoy)));
    setAncla(null);
    setMes(`${hoy.slice(0, 7)}-01`);
  };
  const esAtajo = (dias: number) =>
    periodo !== null && periodo.seguidos && periodo.to === hoy && periodo.dias.length === dias;

  return (
    <AdminSheet
      visible
      title={t('reports.pickDaysTitle')}
      onClose={onClose}
      testID="report-days-sheet"
      footer={
        <Stack gap={spacing.sm}>
          <PrimaryButton
            label={
              periodo === null
                ? t('reports.pickDaysNone')
                : t('reports.pickDaysApply', { count: periodo.dias.length })
            }
            onPress={() => {
              if (periodo !== null && !demasiado) onApply(periodo.dias);
            }}
            disabled={periodo === null || demasiado}
            testID="report-days-apply"
          />
          <GhostButton
            label={t('reports.pickDaysClear')}
            onPress={() => {
              setElegidos(new Set());
              setAncla(null);
            }}
            disabled={elegidos.size === 0}
            testID="report-days-clear"
          />
        </Stack>
      }
    >
      <SegmentedControl
        label={t('reports.pickDaysMode')}
        value={modo}
        options={[
          { value: 'seguidos', label: t('reports.pickDaysRange') },
          { value: 'sueltos', label: t('reports.pickDaysLoose') },
        ]}
        onChange={(valor) => {
          setModo(valor);
          setAncla(null);
        }}
        testID="report-days-mode"
      />
      <AppText variant="help" tone="subtle" testID="report-days-how">
        {modo === 'seguidos'
          ? ancla === null
            ? t('reports.pickDaysRangeHow')
            : t('reports.pickDaysRangeSecond')
          : t('reports.pickDaysLooseHow')}
      </AppText>

      <Row gap={spacing.sm} wrap>
        {[7, 15, 30].map((dias) => (
          <Chip
            key={dias}
            label={t('reports.pickDaysLast', { count: dias })}
            selected={esAtajo(dias)}
            onPress={() => atajo(dias)}
            testID={`report-days-last-${dias}`}
          />
        ))}
      </Row>

      <MonthNavigator
        monthStart={primero}
        language={language}
        isCurrentMonth={primero === `${hoy.slice(0, 7)}-01`}
        onPrevious={() => setMes(desplazarMes(primero, -1))}
        onNext={() => setMes(desplazarMes(primero, 1))}
        onGoToCurrent={() => setMes(`${hoy.slice(0, 7)}-01`)}
        testIDPrefix="report-days-month"
      />

      <CalendarioDeDias
        mes={primero}
        elegidos={elegidos}
        hoy={hoy}
        weekStartsOn={weekStartsOn}
        language={language}
        conHoras={conHoras}
        onDia={tocarDia}
        onDiaDeSemana={modo === 'sueltos' ? tocarColumna : undefined}
        testID="report-days-calendar"
      />
      <AppText variant="label" tone="subtle">
        {t('reports.pickDaysDotLegend')}
      </AppText>

      {/*
        LO ELEGIDO, DICHO CON PALABRAS, aunque el mes que se ve sea otro: al pasar de mes
        los días marcados del anterior no se ven, y sin esta línea no habría forma de
        saber que siguen ahí.
      */}
      <AppText variant="bodyStrong" testID="report-days-summary">
        {periodo === null ? t('reports.pickDaysEmpty') : etiquetaDeDias(periodo, language, t)}
      </AppText>
      {demasiado ? (
        <InlineNotice
          tone="warning"
          body={t('reports.pickDaysTooLong', { count: DIAS_MAXIMOS })}
          testID="report-days-too-long"
        />
      ) : null}
    </AdminSheet>
  );
}

function desplazarMes(primero: DateKey, meses: number): DateKey {
  const indice = Number(primero.slice(0, 4)) * 12 + Number(primero.slice(5, 7)) - 1 + meses;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * EL MANDO DE LOS DÍAS ELEGIDOS, en el sitio donde los otros periodos llevan sus flechas.
 * Dice qué se está mirando —«Del 7 sep al 12 sep · 6 días»— y al tocarlo abre el
 * calendario: los días elegidos no se navegan de uno en uno, se cambian.
 */
export function BotonDeDiasElegidos({
  etiqueta,
  onPress,
}: {
  etiqueta: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilosDelBoton();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('reports.periodDaysOpen', { days: etiqueta })}
      onPress={onPress}
      testID="report-days-open"
      style={({ pressed }) => [estilos.boton, pressed ? estilos.pulsado : null]}
    >
      <Ionicons name="calendar-outline" size={20} color={colors.primary700} />
      <AppText variant="section" style={estilos.texto} testID="report-days-label">
        {etiqueta}
      </AppText>
      <Ionicons name="chevron-down" size={18} color={colors.ink700} />
    </Pressable>
  );
}

const useEstilosDelBoton = estilosDelTema((colors) => ({
  boton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.hundido,
    flexShrink: 1,
    minWidth: 0,
  },
  pulsado: { backgroundColor: colors.primary50 },
  /* El texto cede antes que los iconos: en un teléfono envuelve en dos líneas. */
  texto: { flexShrink: 1, minWidth: 0 },
}));
