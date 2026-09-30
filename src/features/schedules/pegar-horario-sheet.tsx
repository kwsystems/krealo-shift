import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  parsearHorarioPegado,
  problemaBloquea,
  type DescansoPegado,
  type EmpleadoConocido,
  type ProblemaPegado,
  type TurnoPegado,
} from './pegar-horario';
import { formatDateKeyShort, shiftInstants, type DateKey } from './week';
import { AdminSheet, InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import type { SupportedLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { minutesToHHmm } from '@/utils/time';

/**
 * Pegar la tabla de la semana y ver QUE va a entrar antes de que entre.
 *
 * La vista previa no es cortesía: es la única forma de que quien pega sepa que la app
 * leyó su tabla como él la escribió. Un importador que crea 25 turnos y dice «listo»
 * obliga a comprobarlos uno a uno en la rejilla para confiar en él, o sea a hacer a mano
 * el trabajo que venía a ahorrar.
 *
 * Por eso el resumen enseña las horas POR PERSONA junto a las que declara la tabla: es
 * la cifra que quien hizo el horario ya tiene en la cabeza, y verla cuadrar es lo que
 * convierte «parece que lo entendió» en «lo entendió».
 */
export function PegarHorarioSheet({
  dias,
  empleados,
  timezone,
  language,
  saving,
  turnosExistentes,
  existentes,
  onClose,
  onSubmit,
}: {
  dias: DateKey[];
  empleados: EmpleadoConocido[];
  timezone: string;
  language: SupportedLanguage;
  saving: boolean;
  /** Turnos que ya hay en la semana: pegar añade, no reemplaza, y conviene decirlo. */
  turnosExistentes: number;
  /** Esos turnos, para no crear encima de ellos: ver «PEGAR DOS VECES», abajo. */
  existentes: { employeeId: string; startsAt: string; endsAt: string }[];
  onClose: () => void;
  onSubmit: (datos: { turnos: TurnoPegado[]; descansos: DescansoPegado[] }) => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const [texto, setTexto] = useState('');

  const horario = useMemo(
    () => (texto.trim() === '' ? null : parsearHorarioPegado({ texto, dias, empleados, timezone })),
    [texto, dias, empleados, timezone],
  );

  const bloqueantes = horario?.problemas.filter(problemaBloquea) ?? [];
  const avisos = horario?.problemas.filter((problema) => !problemaBloquea(problema)) ?? [];
  const turnos = horario?.turnos ?? [];
  const descansos = horario?.descansos ?? [];
  /*
   * PEGAR DOS VECES LA MISMA SEMANA NO PUEDE DUPLICARLA (30-sep). Pasó: la tabla entró dos
   * veces, 56 turnos uno encima de otro, y el único aviso era el de «ya hay turnos», que no
   * bloquea porque pegar una segunda tabla —otra sede, otra persona— es legítimo. Lo que
   * nunca es legítimo es crear un turno que se pisa con uno que ya tiene esa persona. Eso
   * sí bloquea, y dice quiénes.
   */
  const pisados = [
    ...new Set(
      turnos
        .filter((turno) => {
          const instantes = shiftInstants({
            dateKey: turno.dateKey,
            startTime: turno.startTime,
            endTime: turno.endTime,
            timezone,
          });
          if (instantes === null) return false;
          const desde = Date.parse(instantes.startsAt);
          const hasta = Date.parse(instantes.endsAt);
          return existentes.some(
            (otro) =>
              otro.employeeId === turno.employeeId &&
              Date.parse(otro.startsAt) < hasta &&
              Date.parse(otro.endsAt) > desde,
          );
        })
        .map((turno) => turno.nombre),
    ),
  ];
  const puedeCrear =
    turnos.length + descansos.length > 0 && bloqueantes.length === 0 && pisados.length === 0;

  return (
    <AdminSheet
      visible
      title={t('schedule.pasteWeek')}
      onClose={onClose}
      testID="paste-week-sheet"
      footer={
        <PrimaryButton
          label={
            turnos.length > 0
              ? t('schedule.pasteCreate', { count: turnos.length })
              : descansos.length > 0
                ? t('schedule.pasteMarkRest', { count: descansos.length })
                : t('schedule.pasteCreateEmpty')
          }
          onPress={() => onSubmit({ turnos, descansos })}
          disabled={!puedeCrear}
          loading={saving}
          testID="paste-week-confirm"
        />
      }
    >
      <AppText variant="help" tone="subtle">
        {t('schedule.pasteHint', {
          from: formatDateKeyShort(dias[0] ?? '', language),
          to: formatDateKeyShort(dias[dias.length - 1] ?? '', language),
        })}
      </AppText>

      <View style={estilos.ejemplo}>
        <AppText variant="help" tone="subtle">
          {t('schedule.pasteExample')}
        </AppText>
      </View>

      <FormField
        label={t('schedule.pasteLabel')}
        value={texto}
        onChangeText={setTexto}
        multiline
        numberOfLines={8}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('schedule.pastePlaceholder')}
        style={estilos.cuadro}
        testID="paste-week-input"
      />

      {turnosExistentes > 0 ? (
        <InlineNotice
          tone="warning"
          icon="layers-outline"
          body={t('schedule.pasteAlreadyHasShifts', { count: turnosExistentes })}
          testID="paste-week-existing"
        />
      ) : null}

      {pisados.length > 0 ? (
        <InlineNotice
          tone="late"
          icon="copy-outline"
          body={t('schedule.pasteOverlapsExisting', { names: pisados.join(', ') })}
          testID="paste-week-overlap"
        />
      ) : null}

      {bloqueantes.map((problema, indice) => (
        <InlineNotice
          key={`bloqueante-${indice}`}
          tone="late"
          icon="alert-circle-outline"
          body={textoDelProblema(problema, t, language)}
          testID="paste-week-blocker"
        />
      ))}

      {avisos.map((problema, indice) => (
        <InlineNotice
          key={`aviso-${indice}`}
          tone="warning"
          icon="warning-outline"
          body={textoDelProblema(problema, t, language)}
          testID="paste-week-warning"
        />
      ))}

      {horario !== null && horario.resumen.length > 0 ? (
        <Stack gap={spacing.xs}>
          <AppText variant="label" tone="muted">
            {t('schedule.pastePreview')}
          </AppText>
          {horario.resumen.map((fila) => (
            <Row
              key={fila.employeeId}
              gap={spacing.sm}
              align="center"
              justify="space-between"
              style={estilos.fila}
            >
              <AppText variant="bodyStrong">{fila.nombre}</AppText>
              <AppText variant="label" tone="subtle">
                {t('schedule.pasteRowSummary', {
                  count: fila.turnos,
                  hours: minutesToHHmm(fila.minutos),
                })}
                {fila.descansos === 0
                  ? ''
                  : ` · ${t('schedule.pasteRowRest', { count: fila.descansos })}`}
                {fila.minutosDeclarados === null
                  ? ''
                  : fila.minutosDeclarados === fila.minutos
                    ? ` · ${t('schedule.pasteMatchesTable')}`
                    : ` · ${t('schedule.pasteTableSays', {
                        hours: minutesToHHmm(fila.minutosDeclarados),
                      })}`}
              </AppText>
            </Row>
          ))}
          {turnos.length > 0 && descansos.length > 0 ? (
            <AppText variant="label" tone="subtle" testID="paste-week-rest-total">
              {t('schedule.pasteRestAlso', { count: descansos.length })}
            </AppText>
          ) : null}
          <AppText variant="help" tone="subtle">
            {t('schedule.pasteBreakRule')}
          </AppText>
        </Stack>
      ) : null}
    </AdminSheet>
  );
}

function textoDelProblema(
  problema: ProblemaPegado,
  t: (clave: string, opciones?: Record<string, unknown>) => string,
  language: SupportedLanguage,
): string {
  switch (problema.clave) {
    case 'nadaQueLeer':
      return t('schedule.pasteNothingRead');
    case 'nombreDesconocido':
      return t('schedule.pasteUnknownName', { name: problema.texto });
    case 'nombreAmbiguo':
      return t('schedule.pasteAmbiguousName', {
        name: problema.texto,
        options: problema.candidatos.join(', '),
      });
    case 'celdaIlegible':
      return t('schedule.pasteBadCell', {
        name: problema.nombre,
        day: formatDateKeyShort(problema.dia, language),
        text: problema.texto,
      });
    case 'semanaDistinta':
      return t('schedule.pasteWrongWeek', { days: problema.dias, header: problema.cabecera });
    case 'solape':
      return t('schedule.pasteOverlap', { name: problema.nombre });
    case 'totalDiscrepa':
      return t('schedule.pasteTotalMismatch', {
        name: problema.nombre,
        read: minutesToHHmm(problema.leido),
        declared: minutesToHHmm(problema.declarado),
      });
  }
}

const useEstilos = estilosDelTema((colors) => ({
  ejemplo: {
    backgroundColor: colors.canvas,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  cuadro: { minHeight: 160, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  fila: {
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
}));
