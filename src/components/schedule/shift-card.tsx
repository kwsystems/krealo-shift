import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { Row, useRespuestaAlPuntero } from '@/components/ui/layout';
import type { ShiftRow } from '@/features/schedules/api';
import type { ScheduleWarning } from '@/features/schedules/conflicts';
import type { EstadoDelTurno } from '@/features/schedules/en-turno';
import { CLAVE_DE_ESTADO, ICONO_DE_ESTADO } from '@/features/timesheets/en-curso';
import { estadoDeFalta, type Falta } from '@/features/timesheets/faltas';
import { iconoDeFalta, rotuloDeFaltaEnTurno } from '@/features/timesheets/textos-de-falta';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { estilosDelTema } from '@/theme/estilos';
import { useTonos, type Tono } from '@/theme/tonos';
import { useTheme } from '@/theme/use-theme';
import { localTimeOf } from '@/features/schedules/week';
import { formatShiftRange, minutesToHHmm, type TimeFormatPreference } from '@/utils/time';
import { minutesBetween } from '@/utils/time';

/**
 * EL DÍA DE LA TIENDA EN UNA SEMANA, en minutos desde la medianoche: de la primera entrada
 * a la última salida de sus turnos, redondeado a la hora. Es la regla contra la que cada
 * turno pinta su franja.
 */
export type VentanaDelDia = { desde: number; hasta: number };

/** Minuto del día local de un instante: «09:30» → 570. */
export function minutoDelDia(iso: string, timezone: string): number {
  const [h, m] = localTimeOf(iso, timezone).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * La ventana de unos turnos. `null` si no hay ninguno. Un turno que cruza la medianoche
 * llega hasta el día siguiente: su salida cuenta como 24 h más.
 */
export function ventanaDeLosTurnos(
  turnos: readonly ShiftRow[],
  timezone: string,
): VentanaDelDia | null {
  let desde = Number.POSITIVE_INFINITY;
  let hasta = Number.NEGATIVE_INFINITY;
  for (const turno of turnos) {
    if (turno.status === 'cancelled') continue;
    const entrada = minutoDelDia(turno.starts_at, timezone);
    const salidaDelReloj = minutoDelDia(turno.ends_at, timezone);
    const salida = salidaDelReloj <= entrada ? salidaDelReloj + 24 * 60 : salidaDelReloj;
    desde = Math.min(desde, entrada);
    hasta = Math.max(hasta, salida);
  }
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return null;
  const inicio = Math.floor(desde / 60) * 60;
  // Al menos seis horas de regla: con una sola mañana, cada turno llenaría la franja entera.
  const fin = Math.max(Math.ceil(hasta / 60) * 60, inicio + 6 * 60);
  return { desde: inicio, hasta: fin };
}

/**
 * Turno en la cuadrícula y en las listas (§11.3, §25 ShiftCard).
 *
 * Se toca para editar: no hay arrastrar y soltar, porque una interacción de toque
 * + formulario confiable es preferible a un drag-and-drop defectuoso (§11.3).
 *
 * Qué comunica cada turno, en este orden: horas, persona (si aplica), estado de
 * publicación y advertencias. El estado nunca es solo un color: lleva icono y
 * texto (§21).
 */
export function ShiftCard({
  shift,
  employeeName,
  jobRoleName,
  timezone,
  timeFormat,
  warnings = [],
  showEmployeeName = false,
  enCurso = null,
  ventana = null,
  enFila = false,
  avisoDeDisponibilidad = null,
  falta = null,
  sinLlegar = false,
  tonoDelPuesto = null,
  onPress,
  testID,
}: {
  shift: ShiftRow;
  employeeName?: string;
  jobRoleName?: string | null;
  timezone: string;
  timeFormat: TimeFormatPreference;
  warnings?: ScheduleWarning[];
  showEmployeeName?: boolean;
  /** Si la persona está dentro AHORA en este turno. Ver `estadoDelTurnoAhora`. */
  enCurso?: EstadoDelTurno;
  /** El día de la tienda en esta semana, para la franja. Ver `FranjaDelDia`. */
  ventana?: VentanaDelDia | null;
  /** La hora a la izquierda y la persona a la derecha: la lista por días del teléfono. */
  enFila?: boolean;
  /** «Dijo que no puede»: el turno choca con su disponibilidad (1-oct). */
  avisoDeDisponibilidad?: string | null;
  /**
   * FALTA (1-oct): el turno terminó sin ninguna marca suya. La regla es la de toda la app,
   * `features/timesheets/faltas.ts`; aquí solo se pinta, con la palabra.
   *
   * CON LO QUE SE DIJO DE ELLA (2-oct): en rojo mientras cuenta en contra —sin revisar o
   * sin justificar—, en ámbar si está justificada, y con el motivo escrito. Los mismos
   * textos y colores que Horas, Equipo y Reportes (`textos-de-falta.ts`).
   */
  falta?: Pick<Falta, 'resolucion'> | null;
  /**
   * «NO HA LLEGADO» (2-oct): su turno ya empezó, pasada la tolerancia, y no ha marcado. La
   * regla es la de Inicio (`turnoSinLlegar`); cuando el turno termina sin marca pasa a ser
   * `falta`. Andree miraba el turno de las 13:00 a las 15:27 y la tarjeta no decía nada.
   */
  sinLlegar?: boolean;
  /**
   * EL COLOR DE SU PUESTO (1-oct), como en Homebase: un filo a la izquierda y la franja
   * del día en ese tono. Cajero siempre del mismo color. Ver `tonoDelPuesto`.
   */
  tonoDelPuesto?: Tono | null;
  onPress?: (shift: ShiftRow) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const tonos = useTonos();
  const tono = tonoDelPuesto === null ? null : tonos[tonoDelPuesto];
  const respuesta = useRespuestaAlPuntero();
  const { t } = useTranslation();

  const range = formatShiftRange(shift.starts_at, shift.ends_at, timezone, timeFormat);
  const netMinutes = Math.max(
    0,
    minutesBetween(shift.starts_at, shift.ends_at) - shift.planned_unpaid_break_minutes,
  );

  const isChanged = shift.status === 'draft' && shift.publication_version > 0;
  const statusLabel =
    shift.status === 'cancelled'
      ? t('schedule.statusCancelled')
      : shift.status === 'published'
        ? t('schedule.statusPublished')
        : isChanged
          ? t('schedule.changedBadge')
          : t('schedule.statusDraft');

  const estadoAhora = enCurso === null ? null : t(CLAVE_DE_ESTADO[enCurso]);
  const faltaJustificada = falta !== null && estadoDeFalta(falta) === 'justificada';

  const accessibilityLabel = [
    showEmployeeName && employeeName !== undefined ? employeeName : null,
    range,
    estadoAhora,
    falta === null ? null : rotuloDeFaltaEnTurno(t, falta),
    sinLlegar ? t('schedule.notArrived') : null,
    shift.manager_note,
    shift.employee_note,
    minutesToHHmm(netMinutes),
    statusLabel,
    avisoDeDisponibilidad,
    ...warnings.map((warning) =>
      warning.kind === 'overlap' ? t('schedule.overlapShort') : t('schedule.shortRestShort'),
    ),
  ]
    .filter((part): part is string => part !== null)
    .join('. ');

  /*
   * EL ESTADO VA EN LA LÍNEA DEL PUESTO, no en una insignia debajo (1-oct). La insignia
   * «Borrador» era una tercera línea en cada turno sin publicar, y con una semana a medio
   * armar la rejilla crecía justo cuando más había que verla entera. Lo dicen el borde
   * discontinuo y la palabra con su icono: nunca solo el color (§21).
   */
  const estado =
    shift.status === 'published' ? null : (
      <Row gap={2} align="center">
        <Ionicons
          name={
            shift.status === 'cancelled'
              ? 'close-circle-outline'
              : isChanged
                ? 'sync-outline'
                : 'create-outline'
          }
          size={12}
          color={shift.status === 'cancelled' ? colors.ink500 : colors.primary600}
        />
        <AppText
          variant="label"
          tone={shift.status === 'cancelled' ? 'subtle' : 'primary'}
          numberOfLines={1}
        >
          {statusLabel}
        </AppText>
      </Row>
    );
  const puesto =
    jobRoleName !== undefined && jobRoleName !== null ? (
      <AppText variant="label" tone="subtle" numberOfLines={1}>
        {jobRoleName}
      </AppText>
    ) : null;

  const body = (
    <View
      style={[
        styles.card,
        shift.status === 'draft' ? styles.borrador : null,
        enCurso === 'trabajando' ? styles.trabajando : null,
        enCurso === 'descanso' || enCurso === 'almorzando' ? styles.enDescanso : null,
        shift.status === 'cancelled' ? styles.cancelled : null,
        warnings.length > 0 ? styles.warned : null,
        avisoDeDisponibilidad === null ? null : styles.choca,
        falta === null ? null : faltaJustificada ? styles.faltaJustificada : styles.falta,
        sinLlegar ? styles.sinLlegar : null,
        tono === null ? null : { borderLeftWidth: 4, borderLeftColor: tono.solido },
      ]}
    >
      {/*
        DOS LÍNEAS PARA LA HORA, y es lo que deja caber más días de la semana.
        Con una sola línea el texto no puede partirse, así que el ancho mínimo del
        turno es el de «03:00 – 09:00» completo —146 px medidos—, y ese mínimo sube
        hasta la columna del día: 180 px, siete de ellas más los nombres son 1426 px
        de rejilla, que no caben ni en un monitor de 1440. Dejándola partir por el
        guion, el mínimo baja a media hora y la columna vuelve a su ancho de diseño.
        La alternativa era recortar la hora, que es lo que hacía antes y es peor:
        un turno sin hora de salida no dice a qué hora se sale.
      */}
      {enFila ? (
        /*
          EN EL TELÉFONO, UNA FILA POR TURNO: la hora a la izquierda, siempre en la misma
          columna, y a la derecha quién y de qué. Eran tres líneas apiladas por turno y un
          día de cuatro turnos medía media pantalla.
        */
        <Row gap={spacing.md} align="center">
          <AppText variant="bodyStrong" tabular style={styles.horaEnFila}>
            {range}
          </AppText>
          <View style={styles.encoge}>
            {/* El nombre ENVUELVE, no se corta: con «…» dejaba de saberse de quién era. */}
            {showEmployeeName && employeeName !== undefined ? (
              <AppText variant="body">{employeeName}</AppText>
            ) : null}
            <Row gap={spacing.sm} align="center" wrap>
              {puesto}
              {estado}
            </Row>
          </View>
        </Row>
      ) : (
        /*
          LA HORA ARRIBA Y EL PUESTO DEBAJO, SIEMPRE (1-oct). Probé a ponerlos en la misma
          línea «cuando cupieran», y en una semana real unas tarjetas lo tenían al lado y
          otras debajo según el largo del puesto: la columna parecía desordenada. Dos líneas
          fijas se leen como una tabla. El estado —borrador, cambiado— va con el puesto.
        */
        <>
          <AppText variant="bodyStrong" tabular numberOfLines={2}>
            {range}
          </AppText>
          {puesto === null && estado === null ? null : (
            <Row gap={spacing.sm} align="center" wrap>
              {puesto}
              {estado}
            </Row>
          )}
        </>
      )}
      {showEmployeeName && employeeName !== undefined && !enFila ? (
        <AppText variant="help" tone="muted" numberOfLines={1}>
          {employeeName}
        </AppText>
      ) : null}

      {/*
        QUIÉN ESTÁ DENTRO AHORA, en la misma tarjeta de su turno. Verde si trabaja, ámbar si
        está en su refrigerio: los mismos dos tonos que Inicio y Horas usan para lo mismo.

        UNA LÍNEA, NO UNA INSIGNIA. La columna del día baja a 136 px y a la tarjeta le quedan
        104 de contenido; la píldora de «En descanso» pedía 106. Y el texto va en tinta, no en
        verde: el color ya lo llevan el fondo y el borde, y en tinta se lee igual con el
        puntero encima. El icono y la palabra dicen el estado sin depender del color (§21).
      */}
      {estadoAhora === null ? null : (
        <Row
          gap={spacing.xs}
          align="center"
          testID={testID === undefined ? undefined : `${testID}-ahora`}
        >
          <Ionicons
            name={enCurso === null ? 'radio-button-on' : ICONO_DE_ESTADO[enCurso]}
            size={14}
            color={enCurso === 'trabajando' ? colors.success600 : colors.warning600}
          />
          <AppText variant="label" tone="muted" numberOfLines={1}>
            {estadoAhora}
          </AppText>
        </Row>
      )}

      {/*
        LA DURACIÓN Y LA PAUSA SALEN DE LA TARJETA.

        Eran dos líneas más en una columna de 144 px, y «· 30 min de descanso» partía la
        palabra por la mitad. Ninguna de las dos añade nada al ojear la semana: la duración
        se deduce de la hora que está justo encima, y los minutos de pausa son un dato de
        nómina que se consulta al abrir el turno, no al mirar el cuadro.

        Las dos SIGUEN estando donde hacen falta: en la etiqueta accesible de esta misma
        tarjeta —así que un lector de pantalla las lee— y en la hoja de detalle, que es
        donde se editan. Y la columna de la persona sigue enseñando su total de la semana.
      */}

      {/*
        LA INSIGNIA SOLO SALE CUANDO DICE ALGO.

        Antes salía en TODOS los turnos, y la mayoría están publicados: siete columnas de
        chips verdes «Publicado» repetidos, uno debajo de otro, que es ruido con forma de
        información. Una señal que aparece en todo no señala nada.

        Ahora aparece cuando el turno NO está en su estado normal: borrador, cambiado
        después de publicar, o cancelado. O sea justo cuando hay que mirarlo.
      */}
      {warnings.length > 0 ? (
        <Row gap={spacing.xs}>
          <Ionicons name="alert-circle" size={14} color={colors.warning600} />
          <AppText variant="label" tone="warning" numberOfLines={2}>
            {warnings[0]?.kind === 'overlap'
              ? t('schedule.overlapShort')
              : t('schedule.shortRestShort')}
          </AppText>
        </Row>
      ) : null}

      {sinLlegar ? (
        <Row
          gap={spacing.xs}
          align="center"
          testID={testID === undefined ? undefined : `${testID}-sin-llegar`}
        >
          <Ionicons name="time-outline" size={14} color={colors.danger600} />
          <AppText variant="label" tone="danger" style={styles.textoDeFalta}>
            {t('schedule.notArrived')}
          </AppText>
        </Row>
      ) : null}

      {falta === null ? null : (
        <Row
          gap={spacing.xs}
          align="center"
          testID={testID === undefined ? undefined : `${testID}-falta`}
        >
          <Ionicons
            name={iconoDeFalta(falta)}
            size={14}
            color={faltaJustificada ? colors.warning600 : colors.danger600}
          />
          <AppText
            variant="label"
            tone={faltaJustificada ? 'warning' : 'danger'}
            style={styles.textoDeFalta}
          >
            {rotuloDeFaltaEnTurno(t, falta)}
          </AppText>
        </Row>
      )}

      {/*
        LOS COMENTARIOS DEL TURNO, A LA VISTA (3-oct). Solo se veían abriendo el turno, y
        Andree no sabía si lo que escribió había quedado. El privado con un candado —solo lo
        ve quien gestiona— y el de la persona con un globo: es el que ella ve en su celular.
      */}
      {[
        { texto: shift.manager_note, icono: 'lock-closed-outline' as const, clave: 'privada' },
        { texto: shift.employee_note, icono: 'chatbubble-outline' as const, clave: 'persona' },
      ]
        .filter((nota) => nota.texto !== null && nota.texto.trim() !== '')
        .map((nota) => (
          <Row
            key={nota.clave}
            gap={spacing.xs}
            align="flex-start"
            testID={testID === undefined ? undefined : `${testID}-nota-${nota.clave}`}
          >
            <Ionicons
              name={nota.icono}
              size={13}
              color={colors.ink500}
              style={styles.iconoDeNota}
            />
            <AppText variant="label" tone="muted" style={styles.textoDeFalta}>
              {nota.texto}
            </AppText>
          </Row>
        ))}

      {avisoDeDisponibilidad === null ? null : (
        <Row
          gap={spacing.xs}
          align="center"
          testID={testID === undefined ? undefined : `${testID}-choca`}
        >
          <Ionicons name="close-circle" size={14} color={colors.danger600} />
          <AppText variant="label" tone="danger">
            {avisoDeDisponibilidad}
          </AppText>
        </Row>
      )}

      {ventana === null ? null : (
        <FranjaDelDia
          ventana={ventana}
          desde={minutoDelDia(shift.starts_at, timezone)}
          hasta={minutoDelDia(shift.ends_at, timezone)}
          tenue={shift.status !== 'published'}
          color={
            tono === null ? undefined : shift.status === 'published' ? tono.solido : tono.borde
          }
        />
      )}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(shift)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={t('schedule.editShiftHint')}
      testID={testID}
      {...respuesta.props}
      /*
       * EL REALCE VA EN EL `Pressable` Y NO EN UN HIJO, al revés que en las filas de lista:
       * aquí el cuerpo ya es una tarjeta con su propio fondo y su borde, así que el color
       * de respuesta tiene que ir por encima. En una fila de lista es al revés, porque el
       * fondo lo lleva el hijo.
       */
      style={({ pressed }) => respuesta.estilo(pressed)}
    >
      {body}
    </Pressable>
  );
}

/**
 * LA FRANJA DEL DÍA (1-oct): una línea fina al pie de cada turno, con su tramo pintado en
 * la regla del día de la tienda. Se lee la semana de un vistazo —quién abre, quién cierra,
 * dónde no hay nadie— sin leer una sola hora. No sustituye a la hora, que va encima: es lo
 * que se ve antes de leerla. Decorativa para los lectores de pantalla, que ya tienen la
 * hora en la etiqueta del turno.
 */
function FranjaDelDia({
  ventana,
  desde,
  hasta,
  tenue,
  color,
}: {
  ventana: VentanaDelDia;
  desde: number;
  hasta: number;
  tenue: boolean;
  /** El del puesto, si lo tiene; si no, el acento de la app. */
  color?: string;
}) {
  const styles = useEstilos();
  const total = Math.max(1, ventana.hasta - ventana.desde);
  const fin = hasta <= desde ? hasta + 24 * 60 : hasta;
  const izquierda = Math.min(100, Math.max(0, ((desde - ventana.desde) / total) * 100));
  const ancho = Math.min(100 - izquierda, Math.max(4, ((fin - desde) / total) * 100));
  return (
    <View
      style={styles.franja}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID="franja-del-dia"
    >
      <View
        style={[
          styles.tramo,
          tenue ? styles.tramoTenue : null,
          color === undefined ? null : { backgroundColor: color },
          { left: `${izquierda}%`, width: `${ancho}%` },
        ]}
      />
    </View>
  );
}

/** Celda vacía de la cuadrícula: siempre ofrece la acción siguiente (§20). */
export function EmptyShiftSlot({
  onPress,
  accessibilityLabel,
  sutil = false,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  /**
   * EN LA REJILLA, SIN FONDO (1-oct): con las filas más bajas, cuarenta huecos grises
   * hacían un tablero de ajedrez que competía con los turnos. El «+» queda sobre el fondo
   * de la página y el gris aparece al pasar el puntero, al enfocarlo o al pulsarlo.
   */
  sutil?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const respuesta = useRespuestaAlPuntero();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...respuesta.props}
      style={({ pressed }) => [
        styles.slot,
        sutil ? styles.slotSutil : null,
        ...respuesta.estilo(pressed),
      ]}
    >
      <Ionicons name="add" size={sizes.iconMobile} color={colors.ink500} />
    </Pressable>
  );
}

/**
 * Día libre marcado: lo que antes era un hueco idéntico a un hueco sin decidir.
 *
 * ÁMBAR CON LA LUNA RELLENA, y no gris. En gris se parecía demasiado a la celda vacía de
 * al lado —las dos «aquí no se trabaja»— y repasar la semana buscando huecos obligaba a
 * leer cada celda. Con color, los días libres se cuentan de un vistazo y los huecos sin
 * decidir son lo único gris que queda. Lo pidió Andree mirando la rejilla del 29-sep.
 *
 * La palabra va en tinta y no en ámbar: ámbar sobre ámbar quedaba a 4,65:1 en reposo y por
 * debajo de 4,5 con el puntero encima. El color lo llevan el fondo, el borde y la luna.
 */
export function RestDayChip({
  label,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress?: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useEstilos();
  const respuesta = useRespuestaAlPuntero();

  const cuerpo = (
    <>
      <Ionicons name="moon" size={16} color={colors.warning600} />
      <AppText variant="label" tone="muted" numberOfLines={1}>
        {label}
      </AppText>
    </>
  );

  if (onPress === undefined) {
    return (
      <View style={styles.descanso} accessibilityLabel={accessibilityLabel} testID={testID}>
        {cuerpo}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...respuesta.props}
      style={({ pressed }) => [styles.descanso, ...respuesta.estilo(pressed, colors.warning100)]}
    >
      {cuerpo}
    </Pressable>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  card: {
    // Dos píxeles entre hora, puesto y franja: son tres líneas de un mismo dato.
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    /*
     * EL RELLENO HORIZONTAL BAJA UN PASO, y son los dos píxeles que le faltaban a la
     * hora de salida. Con `padding: spacing.md` la tarjeta dejaba 102 px de texto en
     * una columna de 144, y «03:00 – 09:00» mide 104: veinticuatro turnos de la semana
     * se leían «03:00 – 09:…». Dos píxeles, en el único dato que hace que un turno sea
     * un turno —cuándo entra y cuándo sale—, y encima en el lado de la salida.
     *
     * Se toca el relleno y no la hora: el formato sale de `formatShiftRange`, que usan
     * también la ficha del empleado y el reloj de fichaje, donde sobra sitio y el guion
     * con espacios se lee mejor. Estrechar el aire de una tarjeta es más barato que
     * cambiar cómo se escribe una hora en toda la app.
     *
     * Vertical se queda en `md`: lo que faltaba era ancho.
     */
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minHeight: sizes.touchTargetPreferred,
    justifyContent: 'center',
  },
  /* Lo que no está publicado tiene el filo discontinuo: se ve sin leer la palabra. */
  borrador: { borderStyle: 'dashed', borderColor: colors.primary500 },
  /* La hora en su columna: «03:00 – 09:00» mide 104 px y así las filas quedan alineadas. */
  horaEnFila: { minWidth: 112 },
  encoge: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  franja: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hundido,
    overflow: 'hidden',
    marginTop: 2,
  },
  tramo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: colors.primary500,
  },
  tramoTenue: { backgroundColor: colors.primary200 },
  /*
   * EL BORDE DEL MISMO TONO QUE EL FONDO. Con el gris de siempre, una tarjeta verde tenía
   * un filo que no era de ella; con el del estado se lee como una sola pieza.
   */
  trabajando: { backgroundColor: colors.success50, borderColor: colors.success600 },
  enDescanso: { backgroundColor: colors.warning50, borderColor: colors.warning600 },
  cancelled: { opacity: 0.55, borderStyle: 'dashed' },
  warned: { borderColor: colors.warning600, borderWidth: borderWidth.focus },
  /* Choca con lo que dijo la persona: el filo en rojo, y la frase dice por qué. */
  choca: { borderColor: colors.danger600, borderWidth: borderWidth.focus },
  /* Falta: el turno entero en el rojo suave de «Tarde», que es el mismo par de colores. */
  falta: { backgroundColor: colors.danger50, borderColor: colors.danger600 },
  /* No ha llegado: el borde rojo y sin relleno; el relleno rojo es para la falta, que ya pasó. */
  sinLlegar: { borderColor: colors.danger600 },
  /* Justificada: sigue siendo falta, pero ya no cuenta en contra; el ámbar de los avisos. */
  faltaJustificada: { backgroundColor: colors.warning50, borderColor: colors.warning600 },
  textoDeFalta: { flexShrink: 1, minWidth: 0 },
  // El icono a la altura de la primera línea del texto, que puede ser larga.
  iconoDeNota: { marginTop: 1 },
  pressed: { opacity: 0.7 },
  /*
   * UN HUECO TIENE QUE VERSE COMO UN HUECO, y antes medía y pesaba igual que un turno:
   * recuadro de trazo discontinuo del mismo tamaño, así que una semana cubierta parecía
   * medio vacía —cuarenta y dos recuadros punteados compitiendo con los turnos de verdad—.
   *
   * Ahora se apoya en `hundido` sin trazo, que es lo que le quita el peso, y baja de
   * `touchTargetPreferred` (48) al mínimo táctil (44).
   *
   * PROBÉ A DEJARLO EN 32 Y `responsive:check` LO TUMBÓ: «mide 192×32, por debajo del
   * mínimo táctil de 44». Mi razonamiento era que 192 px de ancho compensaban el alto, y
   * es falso —el dedo falla en la dimensión corta, no en el área— así que el alto se
   * queda en 44 y la ligereza la da el color, que era la ganancia de verdad.
   */
  slot: {
    minHeight: sizes.touchTargetMin,
    borderRadius: radii.input,
    backgroundColor: colors.hundido,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotSutil: { backgroundColor: 'transparent' },
  descanso: {
    minHeight: sizes.touchTargetMin,
    borderRadius: radii.input,
    backgroundColor: colors.warning50,
    borderWidth: borderWidth.hairline,
    borderColor: colors.warning600,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
}));
