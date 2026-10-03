import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AdminSheet, Chip, SegmentedControl } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack } from '@/components/ui/layout';
import { StatusBadge } from '@/components/ui/states';
import {
  motivosDe,
  NOTA_MAXIMA_DE_FALTA,
  type MotivoDeFalta,
  type TipoDeFalta,
} from '@/domain/motivos-de-falta';
import {
  addDaysToKey,
  formatDateKeyShort,
  localDateTimeToInstant,
  localTimeOf,
} from '@/features/schedules/week';
import { contarFaltas, type Falta } from '@/features/timesheets/faltas';
import {
  etiquetaDeFalta,
  iconoDeFalta,
  motivoDeFalta,
  tonoDeFalta,
} from '@/features/timesheets/textos-de-falta';
import type { SupportedLanguage } from '@/i18n';
import { useResponsive } from '@/hooks/use-responsive';
import { formatShiftRange, type TimeFormatPreference } from '@/utils/time';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * LAS FALTAS DE LA SEMANA, en Horas (1-oct): cada turno que terminó sin ninguna marca, con
 * quién, qué día y de qué hora a qué hora. Qué es una falta, en `features/timesheets/faltas.ts`.
 *
 * NO HAY BOTÓN DE «QUITAR LA FALTA», y es a propósito. Una falta no es un caso que se dé por
 * visto: es un hecho, y deja de serlo solo si la persona vino. Para ese caso —vino y no
 * marcó— está «Vino y no marcó», que registra su entrada y su salida con las horas de su
 * turno ya puestas y el motivo que se escriba: dos fichajes manuales, los mismos que se
 * pondrían a mano uno por uno, con su corrección en el historial. Con eso la falta se va
 * sola de aquí, de Horario, de Equipo, de Reportes y de su celular.
 *
 * LAS DOS MARCAS A LA VEZ, y no solo la entrada: con la entrada sola, la persona quedaba
 * «trabajando» desde aquel día en Inicio y en Horas hasta que alguien pusiera la salida.
 *
 * Es la misma decisión que tomó el servidor con «Registrar como cumplido»: después del día
 * en que la sede empezó a usar el reloj, marcar una falta como trabajada no puede ser un
 * clic.
 *
 * «¿POR QUÉ FALTÓ?» (2-oct) es la otra salida, para cuando de verdad faltó: justificada o
 * no, y el motivo. No quita la falta —no hubo horas—, la explica, y lo explicado sale en
 * Horario, Equipo, Reportes, el bono y su celular. Cada fila lleva su estado en una
 * píldora con icono, y el título cuenta las que nadie ha revisado todavía: es lo que le
 * queda por hacer a quien mira.
 */
export function FaltasDeLaSemana({
  faltas,
  nombres,
  timezone,
  timeFormat,
  language,
  onVino,
  onPorQue,
}: {
  faltas: readonly Falta[];
  nombres: ReadonlyMap<string, string>;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  onVino: (falta: Falta) => void;
  onPorQue: (falta: Falta) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const { density } = useResponsive();
  const ancha = density === 'extraWide';
  if (faltas.length === 0) return null;
  const cuenta = contarFaltas(faltas);
  // Todas justificadas: ya no hay nada en contra, y el rojo diría lo contrario.
  const todasJustificadas = cuenta.justificadas === cuenta.total;

  return (
    <View
      style={[estilos.caja, todasJustificadas ? estilos.cajaJustificada : null]}
      testID="faltas-de-la-semana"
    >
      <Stack gap={spacing.md}>
        <Row gap={spacing.sm} align="center" wrap>
          <Ionicons
            name="person-remove-outline"
            size={20}
            color={todasJustificadas ? colors.warning600 : colors.danger600}
          />
          <AppText variant="bodyStrong" accessibilityRole="header" style={estilos.crece}>
            {t('timesheet.absences.title', { count: faltas.length })}
          </AppText>
          {cuenta.sinRevisar > 0 ? (
            <View testID="faltas-sin-revisar">
              <StatusBadge
                label={t('absence.pendingCount', { count: cuenta.sinRevisar })}
                tone="late"
                icon="help-circle-outline"
                compact
              />
            </View>
          ) : null}
          {cuenta.justificadas > 0 ? (
            <View testID="faltas-justificadas">
              <StatusBadge
                label={t('absence.justifiedCount', { count: cuenta.justificadas })}
                tone="warning"
                icon="document-text-outline"
                compact
              />
            </View>
          ) : null}
        </Row>
        <AppText variant="help" tone="muted">
          {t('timesheet.absences.body')}
        </AppText>

        <Stack gap={0}>
          {faltas.map((falta, indice) => (
            <View
              key={falta.id}
              style={[
                estilos.fila,
                ancha ? estilos.filaAncha : null,
                indice > 0 ? estilos.conRegla : null,
              ]}
              testID={`falta-${falta.id}`}
            >
              <Stack gap={spacing.xs} style={ancha ? estilos.textoAncho : undefined}>
                <Row gap={spacing.sm} align="center" wrap>
                  <AppText variant="bodyStrong">
                    {nombres.get(falta.employeeId) ?? t('team.unknownEmployee')}
                  </AppText>
                  <AppText variant="label" tone="subtle" tabular>
                    {formatDateKeyShort(falta.dia, language)}
                  </AppText>
                  <View testID={`falta-${falta.id}-estado`}>
                    <StatusBadge
                      label={etiquetaDeFalta(t, falta)}
                      tone={tonoDeFalta(falta)}
                      icon={iconoDeFalta(falta)}
                      compact
                    />
                  </View>
                </Row>
                <AppText variant="body">
                  {t('timesheet.absences.what', {
                    range: formatShiftRange(
                      falta.turno.starts_at,
                      falta.turno.ends_at,
                      timezone,
                      timeFormat,
                    ),
                  })}
                </AppText>
                {falta.resolucion?.note ? (
                  <AppText variant="help" tone="muted" testID={`falta-${falta.id}-nota`}>
                    «{falta.resolucion.note}»
                  </AppText>
                ) : null}
              </Stack>
              <Row gap={spacing.sm} wrap align="center">
                <SecondaryButton
                  label={falta.resolucion === null ? t('absence.why') : t('absence.change')}
                  onPress={() => onPorQue(falta)}
                  fullWidth={false}
                  testID={`falta-${falta.id}-porque`}
                />
                <GhostButton
                  label={t('timesheet.absences.cameAnyway')}
                  onPress={() => onVino(falta)}
                  fullWidth={false}
                  testID={`falta-${falta.id}-vino`}
                />
              </Row>
            </View>
          ))}
        </Stack>
      </Stack>
    </View>
  );
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Lo que se tolera de reloj adelantado, como el servidor. */
const MARGEN_FUTURO_MS = 5 * 60_000;

/**
 * «VINO Y NO MARCÓ»: su entrada y su salida, con las horas del turno ya puestas. Se pueden
 * cambiar —llegó a las 18:10—, y el motivo es obligatorio como en todo fichaje manual: sin
 * él, una falta convertida en horas es indistinguible de un fraude en una auditoría.
 */
export function RegistrarQueVinoSheet({
  falta,
  nombre,
  timezone,
  language,
  ahoraISO,
  guardando,
  onGuardar,
  onClose,
}: {
  falta: Falta;
  nombre: string;
  timezone: string;
  language: SupportedLanguage;
  ahoraISO: string;
  guardando: boolean;
  onGuardar: (params: { entradaISO: string; salidaISO: string; motivo: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [entrada, setEntrada] = useState(localTimeOf(falta.turno.starts_at, timezone));
  const [salida, setSalida] = useState(localTimeOf(falta.turno.ends_at, timezone));
  const [motivo, setMotivo] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState(false);

  const entradaISO = HORA.test(entrada.trim())
    ? localDateTimeToInstant(falta.dia, entrada.trim(), timezone)
    : null;
  // Una salida «antes» de la entrada es del día siguiente: el turno de noche.
  const salidaElMismoDia = HORA.test(salida.trim())
    ? localDateTimeToInstant(falta.dia, salida.trim(), timezone)
    : null;
  const salidaISO =
    salidaElMismoDia === null || entradaISO === null
      ? null
      : salidaElMismoDia > entradaISO
        ? salidaElMismoDia
        : localDateTimeToInstant(addDaysToKey(falta.dia, 1), salida.trim(), timezone);

  const horasMal = entradaISO === null || salidaISO === null;
  const futura =
    salidaISO !== null && Date.parse(salidaISO) > Date.parse(ahoraISO) + MARGEN_FUTURO_MS;
  const motivoFalta = motivo.trim().length < 3;
  const valido = !horasMal && !futura && !motivoFalta;

  const guardar = () => {
    setIntentado(true);
    if (!valido || entradaISO === null || salidaISO === null) return;
    setFallo(false);
    onGuardar({ entradaISO, salidaISO, motivo: motivo.trim() }).catch(() => setFallo(true));
  };

  return (
    <AdminSheet
      visible
      title={t('timesheet.absences.sheetTitle', { name: nombre })}
      onClose={onClose}
      testID="falta-vino-hoja"
      footer={
        <PrimaryButton
          label={t('timesheet.absences.save')}
          onPress={guardar}
          loading={guardando}
          disabled={intentado && !valido}
          testID="falta-vino-guardar"
        />
      }
    >
      <AppText variant="body">
        {t('timesheet.absences.sheetBody', {
          day: formatDateKeyShort(falta.dia, language),
        })}
      </AppText>
      <Row gap={spacing.md} align="flex-start">
        <FormField
          label={t('timesheet.absences.clockIn')}
          value={entrada}
          onChangeText={setEntrada}
          keyboardType="numbers-and-punctuation"
          placeholder="18:00"
          testID="falta-vino-entrada"
        />
        <FormField
          label={t('timesheet.absences.clockOut')}
          value={salida}
          onChangeText={setSalida}
          keyboardType="numbers-and-punctuation"
          placeholder="21:00"
          testID="falta-vino-salida"
        />
      </Row>
      {intentado && horasMal ? (
        <AppText variant="help" tone="danger">
          {t('timesheet.absences.errorHours')}
        </AppText>
      ) : null}
      {futura ? (
        <AppText variant="help" tone="danger" testID="falta-vino-futura">
          {t('timesheet.futureTime')}
        </AppText>
      ) : null}
      <FormField
        label={t('timesheet.absences.reason')}
        value={motivo}
        onChangeText={setMotivo}
        multiline
        maxLength={280}
        placeholder={t('timesheet.absences.reasonPlaceholder')}
        error={intentado && motivoFalta ? t('timesheet.absences.reasonRequired') : undefined}
        testID="falta-vino-motivo"
      />
      {fallo ? (
        <AppText variant="help" tone="danger" testID="falta-vino-error">
          {t('timesheet.absences.failed')}
        </AppText>
      ) : null}
    </AdminSheet>
  );
}

/**
 * «¿POR QUÉ FALTÓ?»: justificada o no, el motivo y, si hace falta, un comentario. Primero
 * lo que cambia algo —si le quita el bono o no—, después el porqué; al cambiar de tipo, el
 * motivo se borra si no vale para el nuevo («No avisó» no puede ser justificada).
 *
 * «Otro motivo» pide el comentario: sin él, Reportes contaría una falta con un motivo que
 * no dice nada. El servidor exige lo mismo (`functions/src/faltas.ts`).
 */
export function JustificarFaltaSheet({
  falta,
  nombre,
  timezone,
  timeFormat,
  language,
  guardando,
  quitando,
  onGuardar,
  onQuitar,
  onClose,
}: {
  falta: Falta;
  nombre: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  guardando: boolean;
  quitando: boolean;
  onGuardar: (params: {
    kind: TipoDeFalta;
    reason: MotivoDeFalta;
    note: string | null;
  }) => Promise<void>;
  onQuitar: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tipo, setTipo] = useState<TipoDeFalta>(falta.resolucion?.kind ?? 'justified');
  const [motivo, setMotivo] = useState<MotivoDeFalta | null>(falta.resolucion?.reason ?? null);
  const [nota, setNota] = useState(falta.resolucion?.note ?? '');
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState(false);

  const motivos = motivosDe(tipo);
  const sinMotivo = motivo === null || !motivos.includes(motivo);
  const faltaLaNota = motivo === 'other' && nota.trim().length === 0;
  const valido = !sinMotivo && !faltaLaNota;

  const cambiarTipo = (nuevo: TipoDeFalta) => {
    setTipo(nuevo);
    if (motivo !== null && !motivosDe(nuevo).includes(motivo)) setMotivo(null);
  };

  const guardar = () => {
    setIntentado(true);
    if (!valido || motivo === null) return;
    setFallo(false);
    const limpia = nota.trim();
    onGuardar({ kind: tipo, reason: motivo, note: limpia.length > 0 ? limpia : null }).catch(() =>
      setFallo(true),
    );
  };

  const quitar = () => {
    setFallo(false);
    onQuitar().catch(() => setFallo(true));
  };

  return (
    <AdminSheet
      visible
      title={t('absence.sheetTitle', { name: nombre })}
      onClose={onClose}
      testID="justificar-falta-hoja"
      footer={
        <Stack gap={spacing.sm}>
          <PrimaryButton
            label={t('absence.save')}
            onPress={guardar}
            loading={guardando}
            disabled={intentado && !valido}
            testID="justificar-falta-guardar"
          />
          {falta.resolucion !== null ? (
            <GhostButton
              label={t('absence.clear')}
              onPress={quitar}
              loading={quitando}
              testID="justificar-falta-quitar"
            />
          ) : null}
        </Stack>
      }
    >
      <AppText variant="body">
        {t('absence.sheetBody', {
          day: formatDateKeyShort(falta.dia, language),
          range: formatShiftRange(falta.turno.starts_at, falta.turno.ends_at, timezone, timeFormat),
        })}
      </AppText>
      <SegmentedControl<TipoDeFalta>
        label={t('absence.kind')}
        rotuloVisible
        value={tipo}
        onChange={cambiarTipo}
        options={[
          { value: 'justified', label: t('absence.justified') },
          { value: 'unjustified', label: t('absence.unjustified') },
        ]}
        testID="justificar-falta-tipo"
      />
      <Stack gap={spacing.sm}>
        <AppText variant="label" tone="muted">
          {t('absence.reasonLabel')}
        </AppText>
        <Row wrap gap={spacing.sm} align="flex-start">
          {motivos.map((opcion) => (
            <Chip
              key={opcion}
              label={motivoDeFalta(t, opcion)}
              selected={motivo === opcion}
              onPress={() => setMotivo(opcion)}
              testID={`justificar-falta-${opcion}`}
            />
          ))}
        </Row>
        {intentado && sinMotivo ? (
          <AppText variant="help" tone="danger" testID="justificar-falta-sin-motivo">
            {t('absence.reasonMissing')}
          </AppText>
        ) : null}
      </Stack>
      <FormField
        label={motivo === 'other' ? t('absence.noteRequired') : t('absence.note')}
        value={nota}
        onChangeText={setNota}
        multiline
        maxLength={NOTA_MAXIMA_DE_FALTA}
        placeholder={t('absence.notePlaceholder')}
        error={intentado && faltaLaNota ? t('absence.noteMissing') : undefined}
        testID="justificar-falta-nota"
      />
      <AppText variant="help" tone="subtle">
        {t('absence.bonusEffect')}
      </AppText>
      {fallo ? (
        <AppText variant="help" tone="danger" testID="justificar-falta-error">
          {t('absence.failed')}
        </AppText>
      ) : null}
    </AdminSheet>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  cajaJustificada: { borderColor: colors.warning600 },
  caja: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: borderWidth.focus,
    borderColor: colors.danger600,
    padding: spacing.base,
  },
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fila: { paddingVertical: spacing.md, gap: spacing.sm },
  /*
   * EN ANCHO, TEXTO Y BOTONES EN UNA FILA… SI CABEN (3-oct). Con la ventana a 1024 y el
   * menú lateral, la fila mide unos 730 px y los botones se llevaban casi todo: el texto
   * quedaba en 50 px y partía «refrigerio» por la mitad (`responsive:check`). El texto pide
   * al menos 280 px; si no los tiene, los botones bajan a la línea siguiente.
   */
  filaAncha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.base,
    rowGap: spacing.sm,
  },
  textoAncho: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 280 },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
}));
