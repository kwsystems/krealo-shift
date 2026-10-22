import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AdminSheet, Chip, SegmentedControl } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Mitad, Row, Stack } from '@/components/ui/layout';
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
import { horaEscrita } from '@/domain/hora-escrita';
import { minutosEscritos } from '@/domain/duracion-escrita';
import { duracion } from '@/features/timesheets/duracion';
import { contarFaltas, type Falta } from '@/features/timesheets/faltas';
import { porQueNoSeRegistro } from '@/features/timesheets/por-que-no-se-registro';
import {
  MOTIVOS_DE_CUMPLIDO,
  NOTA_MAXIMA_DE_CUMPLIDO,
  type MotivoDeCumplido,
} from '@/domain/motivos-de-cumplido';
import { motivoDeCumplido } from '@/features/timesheets/textos-de-cumplido';
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

/** Un refrigerio como se escribe a mano: «1 h», «30», «1:30». Lo lee `minutosEscritos`. */
function textoDeMinutos(minutos: number): string {
  if (minutos === 0) return '0';
  if (minutos % 60 === 0) return `${minutos / 60} h`;
  if (minutos < 60) return String(minutos);
  return `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, '0')}`;
}
/** Lo que se tolera de reloj adelantado, como el servidor. */
const MARGEN_FUTURO_MS = 5 * 60_000;

/**
 * «VINO Y NO MARCÓ»: su entrada y su salida, con las horas del turno ya puestas. Se pueden
 * cambiar —llegó a las 18:10—, y el motivo es obligatorio como en todo fichaje manual: sin
 * él, una falta convertida en horas es indistinguible de un fraude en una auditoría.
 *
 * CON EL TURNO TODAVÍA EN CURSO, SOLO LA ENTRADA (12-oct). Andree: «hoy no ha marcado
 * porque se ha olvidado, ¿dónde lo arreglo?… y ya dejar que ella siga con todo». La salida
 * aún no ha pasado: se registra la entrada, la jornada queda abierta y ella sigue en el
 * reloj como cualquier día —refrigerio y salida—. Pedirle aquí una salida futura era
 * inventarla.
 *
 * CON EL DÍA ENTERO, TAMBIÉN SU REFRIGERIO (13-oct). Si no marcó nada, tampoco marcó la
 * comida, y sin ella la jornada contaba de más: «sin refrigerio» y «1 h más que su turno» en
 * Por resolver por una hora que no existía. El campo trae el de su turno; 0 si trabajó de
 * corrido. Lo registra el servidor en el centro de la jornada.
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
  /** `salidaISO` es `null` con el turno en curso: solo se registra la entrada. */
  onGuardar: (params: {
    entradaISO: string;
    salidaISO: string | null;
    /** El refrigerio que se le pone, en minutos; 0 con el turno en curso. */
    refrigerioMinutos: number;
    motivo: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const enCurso = Date.parse(falta.turno.ends_at) > Date.parse(ahoraISO);
  const [entrada, setEntrada] = useState(localTimeOf(falta.turno.starts_at, timezone));
  const [salida, setSalida] = useState(localTimeOf(falta.turno.ends_at, timezone));
  const [refrigerio, setRefrigerio] = useState(
    textoDeMinutos(Math.max(0, falta.turno.planned_unpaid_break_minutes)),
  );
  const [motivo, setMotivo] = useState('');
  const [intentado, setIntentado] = useState(false);
  // El motivo del servidor, en palabras: ver `porQueNoSeRegistro`.
  const [fallo, setFallo] = useState<string | null>(null);

  // Como en el resto de la app: «10», «10.30», «1030» o «6pm» valen (`horaEscrita`).
  const horaDeEntrada = horaEscrita(entrada);
  const horaDeSalida = horaEscrita(salida);
  const entradaISO =
    horaDeEntrada === null ? null : localDateTimeToInstant(falta.dia, horaDeEntrada, timezone);
  // Una salida «antes» de la entrada es del día siguiente: el turno de noche.
  const salidaElMismoDia =
    horaDeSalida === null ? null : localDateTimeToInstant(falta.dia, horaDeSalida, timezone);
  const salidaISO =
    salidaElMismoDia === null || entradaISO === null || horaDeSalida === null
      ? null
      : salidaElMismoDia > entradaISO
        ? salidaElMismoDia
        : localDateTimeToInstant(addDaysToKey(falta.dia, 1), horaDeSalida, timezone);
  const refrigerioMinutos = enCurso ? 0 : minutosEscritos(refrigerio);
  const duracionMinutos =
    entradaISO === null || salidaISO === null
      ? null
      : Math.round((Date.parse(salidaISO) - Date.parse(entradaISO)) / 60_000);
  const refrigerioMal =
    refrigerioMinutos === null ||
    (duracionMinutos !== null && refrigerioMinutos > 0 && refrigerioMinutos >= duracionMinutos);

  const horasMal = entradaISO === null || (!enCurso && salidaISO === null);
  // Con el turno en curso la que no puede ser futura es la entrada; si no, la salida.
  const ultima = enCurso ? entradaISO : salidaISO;
  const futura = ultima !== null && Date.parse(ultima) > Date.parse(ahoraISO) + MARGEN_FUTURO_MS;
  const motivoFalta = motivo.trim().length < 3;
  const valido = !horasMal && !futura && !refrigerioMal && !motivoFalta;

  const guardar = () => {
    setIntentado(true);
    if (!valido || entradaISO === null || refrigerioMinutos === null) return;
    if (!enCurso && salidaISO === null) return;
    setFallo(null);
    onGuardar({
      entradaISO,
      salidaISO: enCurso ? null : salidaISO,
      refrigerioMinutos,
      motivo: motivo.trim(),
    }).catch((error: unknown) => setFallo(porQueNoSeRegistro(t, error)));
  };

  return (
    <AdminSheet
      visible
      title={t('timesheet.absences.sheetTitle', { name: nombre })}
      onClose={onClose}
      testID="falta-vino-hoja"
      footer={
        <Stack gap={spacing.sm}>
          {intentado && !valido ? (
            <AppText variant="help" tone="danger" testID="falta-vino-por-que-no">
              {horasMal
                ? t('timesheet.absences.errorHours')
                : futura
                  ? t('timesheet.futureTime')
                  : refrigerioMal
                    ? t('timesheet.absences.breakInvalid')
                    : t('timesheet.absences.reasonRequired')}
            </AppText>
          ) : null}
          <PrimaryButton
            label={enCurso ? t('timesheet.absences.saveClockIn') : t('timesheet.absences.save')}
            onPress={guardar}
            loading={guardando}
            testID="falta-vino-guardar"
          />
        </Stack>
      }
    >
      <AppText variant="body">
        {enCurso
          ? t('timesheet.absences.sheetBodyNow')
          : t('timesheet.absences.sheetBody', {
              day: formatDateKeyShort(falta.dia, language),
            })}
      </AppText>
      <Row gap={spacing.md} align="flex-start">
        <Mitad>
          <FormField
            label={t('timesheet.absences.clockIn')}
            value={entrada}
            onChangeText={setEntrada}
            keyboardType="numbers-and-punctuation"
            placeholder="18:00"
            testID="falta-vino-entrada"
          />
        </Mitad>
        {enCurso ? null : (
          <Mitad>
            <FormField
              label={t('timesheet.absences.clockOut')}
              value={salida}
              onChangeText={setSalida}
              keyboardType="numbers-and-punctuation"
              placeholder="21:00"
              testID="falta-vino-salida"
            />
          </Mitad>
        )}
      </Row>
      {enCurso ? null : (
        <Stack gap={spacing.xs}>
          <FormField
            label={t('timesheet.absences.break')}
            value={refrigerio}
            onChangeText={setRefrigerio}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            placeholder="1 h"
            testID="falta-vino-refrigerio"
          />
          {refrigerioMinutos !== null && !refrigerioMal ? (
            <AppText
              variant="label"
              tone="primary"
              tabular
              testID="falta-vino-refrigerio-se-guarda"
            >
              {refrigerioMinutos === 0
                ? t('timesheet.absences.breakNone')
                : t('common.savedAs', { duration: duracion(t, refrigerioMinutos) })}
            </AppText>
          ) : null}
          <AppText variant="help" tone="subtle">
            {t('timesheet.absences.breakHint')}
          </AppText>
        </Stack>
      )}
      {/* Por qué no se guarda, junto al botón: ver el pie. */}
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
      {fallo !== null ? (
        <AppText variant="help" tone="danger" testID="falta-vino-error">
          {fallo}
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
  enCurso = false,
}: {
  falta: Falta;
  nombre: string;
  timezone: string;
  timeFormat: TimeFormatPreference;
  language: SupportedLanguage;
  /**
   * El turno todavía dura (12-oct): «faltó» se puede decir ya, pero «Cumplió su horario»
   * no —todavía no lo ha cumplido—, así que esa opción no sale.
   */
  enCurso?: boolean;
  guardando: boolean;
  quitando: boolean;
  onGuardar: (
    params:
      | { kind: TipoDeFalta; reason: MotivoDeFalta; note: string | null }
      /** Cumplió su horario por un motivo especial: cuenta como trabajado. Ver `creditShiftAsWorked`. */
      | { kind: 'credit'; reason: MotivoDeCumplido; note: string | null },
  ) => Promise<void>;
  onQuitar: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  /*
   * TRES RESPUESTAS Y NO DOS (4-oct). «Justificada» y «No justificada» siguen siendo faltas:
   * no hubo horas. La tercera, «Cumplió su horario», es otra cosa: el día cuenta como
   * trabajado —miembro de mesa en elecciones, trabajo fuera de la tienda— y por eso va aquí,
   * en el sitio donde se mira una falta, y no escondida en otra pantalla.
   */
  const [tipo, setTipo] = useState<TipoDeFalta | 'credit'>(falta.resolucion?.kind ?? 'justified');
  const [motivo, setMotivo] = useState<string | null>(falta.resolucion?.reason ?? null);
  const [nota, setNota] = useState(falta.resolucion?.note ?? '');
  const [intentado, setIntentado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const motivos: readonly string[] = tipo === 'credit' ? MOTIVOS_DE_CUMPLIDO : motivosDe(tipo);
  const sinMotivo = motivo === null || !motivos.includes(motivo);
  const faltaLaNota = motivo === 'other' && nota.trim().length === 0;
  const valido = !sinMotivo && !faltaLaNota;
  const notaMaxima = tipo === 'credit' ? NOTA_MAXIMA_DE_CUMPLIDO : NOTA_MAXIMA_DE_FALTA;

  const cambiarTipo = (nuevo: TipoDeFalta | 'credit') => {
    setTipo(nuevo);
    const deNuevo: readonly string[] = nuevo === 'credit' ? MOTIVOS_DE_CUMPLIDO : motivosDe(nuevo);
    if (motivo !== null && !deNuevo.includes(motivo)) setMotivo(null);
  };

  const guardar = () => {
    setIntentado(true);
    if (!valido || motivo === null) return;
    setFallo(null);
    const limpia = nota.trim();
    const comentario = limpia.length > 0 ? limpia : null;
    const enviado =
      tipo === 'credit'
        ? onGuardar({ kind: 'credit', reason: motivo as MotivoDeCumplido, note: comentario })
        : onGuardar({ kind: tipo, reason: motivo as MotivoDeFalta, note: comentario });
    enviado.catch((error: unknown) => {
      // El servidor dice por qué, con un código: «ya marcó ese día», «no terminó».
      const codigo = (error as { motivo?: unknown } | null)?.motivo;
      setFallo(
        codigo === 'CON_MARCAS'
          ? t('absence.creditHasMarks')
          : codigo === 'JORNADA_ABIERTA'
            ? t('absence.creditOpenSession')
            : t('absence.failed'),
      );
    });
  };

  const quitar = () => {
    setFallo(null);
    onQuitar().catch(() => setFallo(t('absence.failed')));
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
            label={tipo === 'credit' ? t('absence.creditSave') : t('absence.save')}
            onPress={guardar}
            loading={guardando}
            disabled={intentado && !valido}
            testID="justificar-falta-guardar"
          />
          {falta.resolucion !== null && tipo !== 'credit' ? (
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
      <SegmentedControl<TipoDeFalta | 'credit'>
        label={t('absence.kind')}
        rotuloVisible
        value={tipo}
        onChange={cambiarTipo}
        options={[
          { value: 'justified', label: t('absence.justified') },
          { value: 'unjustified', label: t('absence.unjustified') },
          ...(enCurso ? [] : [{ value: 'credit' as const, label: t('absence.creditOption') }]),
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
              label={
                tipo === 'credit'
                  ? motivoDeCumplido(t, opcion)
                  : motivoDeFalta(t, opcion as MotivoDeFalta)
              }
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
        maxLength={notaMaxima}
        placeholder={t('absence.notePlaceholder')}
        error={intentado && faltaLaNota ? t('absence.noteMissing') : undefined}
        testID="justificar-falta-nota"
      />
      <AppText variant="help" tone="subtle" testID="justificar-falta-efecto">
        {tipo === 'credit'
          ? t('absence.creditEffect', {
              range: formatShiftRange(
                falta.turno.starts_at,
                falta.turno.ends_at,
                timezone,
                timeFormat,
              ),
            })
          : t('absence.bonusEffect')}
      </AppText>
      {fallo !== null ? (
        <AppText variant="help" tone="danger" testID="justificar-falta-error">
          {fallo}
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
