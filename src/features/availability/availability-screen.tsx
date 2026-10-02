import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  ChipDeDisponibilidad,
  TONO_DE_DISPONIBILIDAD,
} from '@/components/availability/chip-de-disponibilidad';
import {
  HojaDeDisponibilidad,
  nombreDelDiaDeSemana,
  type ValoresIniciales,
} from '@/components/availability/hoja-de-disponibilidad';
import { AsyncSection } from '@/components/schedule/data-states';
import { AppText } from '@/components/ui/app-text';
import { AnclaDePersona } from '@/components/ui/ancla';
import { GhostButton, SecondaryButton } from '@/components/ui/buttons';
import {
  AppScreen,
  Card,
  ResponsiveContainer,
  Row,
  Stack,
  useRespuestaAlPuntero,
} from '@/components/ui/layout';
import { dateKeyOf, formatDateKeyShort, type DateKey } from '@/features/schedules/week';
import { useTeam } from '@/features/team/hooks';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { currentLanguage } from '@/i18n';
import { estilosDelTema } from '@/theme/estilos';
import { useTonos, type Tono } from '@/theme/tonos';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { useDisponibilidad, useMutacionesDeDisponibilidad } from './api';
import { diaDeSemanaIso, type Disponibilidad } from './disponibilidad';
import { PestanasDeEquipo } from './pestanas-de-equipo';

/**
 * EQUIPO → DISPONIBILIDAD (1-oct), el apartado de Homebase que pidió Andree: «donde todos
 * los vendedores pueden poner sus comentarios en los días, diciendo qué días tienen
 * problemas para trabajar».
 *
 * DOS PARTES, porque se miran distinto:
 *   - CADA SEMANA: la tabla de siempre —personas en filas, días en columnas— con lo que
 *     cada una dijo de cada día. Es lo que se consulta al armar el horario.
 *   - DÍAS PUNTUALES: lo que viene por fecha —una cita, un examen—, en orden.
 *
 * Lo nuevo —lo que escribió la persona y nadie miró todavía— lleva un punto naranja, y
 * arriba se cuenta y se da por visto de una vez. Tocar cualquier cosa la abre para verla
 * entera, cambiarla o quitarla; tocar un hueco agrega ahí mismo.
 */

const DIAS = [1, 2, 3, 4, 5, 6, 7] as const;

export function AvailabilityScreen() {
  const { t } = useTranslation();
  const language = currentLanguage();
  const scope = useManagerScope();
  const estilos = useEstilos();
  const tonos = useTonos();
  const { density } = useResponsive();
  /*
   * LA TABLA, SOLO EN PANTALLA MUY ANCHA: en un iPad no caben siete columnas legibles
   * junto al menú, y una tabla que se arrastra de lado esconde los días (`responsive:check`).
   * Por debajo, la lista por persona, que es lo mismo dicho en vertical.
   */
  const ancha = density === 'extraWide';
  /* Y aun así, solo si caben siete columnas de 120 px y la de nombres: medido, no supuesto. */
  const [anchoDeLaTabla, setAnchoDeLaTabla] = useState(0);
  const caben = anchoDeLaTabla >= 160 + 7 * 120;
  const ahora = useLiveClock('minute');
  const hoy = dateKeyOf(ahora.toISOString(), scope.timezone);
  const organizationId = scope.organization?.id ?? null;

  const locationIds = useMemo(
    () => scope.allLocations.map((location) => location.id),
    [scope.allLocations],
  );
  const team = useTeam({ organizationId, locationIds });
  const consulta = useDisponibilidad(organizationId);
  const mutaciones = useMutacionesDeDisponibilidad();
  const [hoja, setHoja] = useState<ValoresIniciales | null>(null);

  // Las personas de la sede que se mira, activas: las mismas que Equipo enseña.
  const personas = team.members
    .filter(
      (persona) =>
        persona.status === 'active' &&
        (scope.locationId === null || persona.locationIds.includes(scope.locationId)),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const deLaSede = new Set(personas.map((persona) => persona.id));
  const filas = (consulta.data ?? []).filter((fila) => deLaSede.has(fila.employee_id));
  const semanales = filas.filter((fila) => fila.kind === 'weekly');
  const puntuales = filas
    .filter((fila) => fila.kind === 'date' && (fila.date ?? '') >= hoy)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nuevas = filas.filter((fila) => fila.status === 'new');
  const nombre = (id: string) => personas.find((p) => p.id === id)?.displayName ?? '';
  const opcionesDePersona = personas.map((p) => ({ value: p.id, label: p.displayName }));

  const abrir = (fila: Disponibilidad) => setHoja({ fila, employeeId: fila.employee_id });
  const agregar = (extra: Partial<ValoresIniciales> = {}) =>
    setHoja({ fila: null, employeeId: null, ...extra });

  return (
    <AppScreen tone="canvas" scroll>
      <ResponsiveContainer width={ancha ? 'full' : 'content'}>
        <Stack gap={spacing.md}>
          <Row justify="space-between" align="flex-start" gap={spacing.md} wrap>
            <AppText variant="title" accessibilityRole="header">
              {t('availability.title')}
            </AppText>
            <SecondaryButton
              label={t('availability.add')}
              onPress={() => agregar()}
              fullWidth={false}
              testID="disponibilidad-agregar"
            />
          </Row>
          <PestanasDeEquipo activa="disponibilidad" />
          <ComoLoAgregan />

          {/* LO NUEVO, contado y a un toque de darse por visto. */}
          {nuevas.length > 0 ? (
            <Row
              gap={spacing.sm}
              align="center"
              wrap
              style={StyleSheet.flatten([
                estilos.barraNueva,
                // Fondo de superficie, borde naranja: sobre el naranja, en oscuro, el botón
                // morado quedaba a 4,22:1 (`contraste:check`).
                {
                  backgroundColor: estilos.fondoDeSuperficie.backgroundColor,
                  borderColor: tonos.naranja.solido,
                },
              ])}
              testID="disponibilidad-nuevas"
            >
              <Ionicons name="sparkles-outline" size={18} color={tonos.naranja.tinta} />
              <AppText variant="bodyStrong" style={[estilos.crece, { color: tonos.naranja.tinta }]}>
                {t('availability.newCount', { count: nuevas.length })}
              </AppText>
              <GhostButton
                label={t('availability.markAllSeen')}
                onPress={() => mutaciones.marcarVistas.mutate(nuevas.map((fila) => fila.id))}
                loading={mutaciones.marcarVistas.isPending}
                fullWidth={false}
                testID="disponibilidad-marcar-todas"
              />
            </Row>
          ) : null}

          <Resumen
            noPueden={filas.filter((fila) => fila.type === 'unavailable').length}
            prefieren={filas.filter((fila) => fila.type === 'preferred').length}
            comentarios={filas.filter((fila) => fila.type === 'note').length}
          />

          <AsyncSection
            isPending={consulta.isPending || team.isPending}
            error={consulta.error ?? team.error}
            onRetry={() => {
              void consulta.refetch();
              team.refetch();
            }}
          >
            <Stack gap={spacing.md}>
              <Card>
                <CabeceraDeSeccion
                  icono="repeat-outline"
                  tono="turquesa"
                  titulo={t('availability.weekly')}
                  cuenta={semanales.length}
                />
                <View onLayout={(evento) => setAnchoDeLaTabla(evento.nativeEvent.layout.width)} />
                {ancha && caben ? (
                  <TablaSemanal
                    personas={personas.map((p) => ({ id: p.id, nombre: p.displayName }))}
                    filas={semanales}
                    diaDeHoy={diaDeSemanaIso(hoy)}
                    language={language}
                    onAbrir={abrir}
                    onAgregar={(employeeId, weekday) =>
                      agregar({ employeeId, kind: 'weekly', weekday })
                    }
                  />
                ) : (
                  <ListaSemanal
                    personas={personas.map((p) => ({ id: p.id, nombre: p.displayName }))}
                    filas={semanales}
                    language={language}
                    onAbrir={abrir}
                  />
                )}
              </Card>

              <Card>
                <CabeceraDeSeccion
                  icono="calendar-number-outline"
                  tono="azul"
                  titulo={t('availability.dates')}
                  cuenta={puntuales.length}
                />
                {puntuales.length === 0 ? (
                  <AppText variant="help" tone="subtle" testID="disponibilidad-sin-puntuales">
                    {t('availability.emptyDates')}
                  </AppText>
                ) : (
                  <Stack gap={0}>
                    {puntuales.map((fila, indice) => (
                      <FilaPuntual
                        key={fila.id}
                        fila={fila}
                        nombre={nombre(fila.employee_id)}
                        conRegla={indice > 0}
                        language={language}
                        onAbrir={() => abrir(fila)}
                      />
                    ))}
                  </Stack>
                )}
              </Card>
            </Stack>
          </AsyncSection>
        </Stack>
      </ResponsiveContainer>

      {hoja !== null && organizationId !== null ? (
        <HojaDeDisponibilidad
          key={hoja.fila?.id ?? `nueva-${hoja.employeeId ?? ''}-${hoja.weekday ?? ''}`}
          inicial={hoja}
          organizationId={organizationId}
          personas={opcionesDePersona}
          hoy={hoy}
          weekStartsOn={scope.weekStartsOn}
          language={language}
          onClose={() => setHoja(null)}
        />
      ) : null}
    </AppScreen>
  );
}

/**
 * CÓMO LLEGA AQUÍ LO QUE ESCRIBEN (2-oct). Andree preguntó «pueden entrar la gente a poner
 * sus cosas, no?»: sí, y la pantalla tiene que decirlo sin que haya que preguntarlo. Quien
 * la mira es quien arma el horario, y lo que necesita saber es de dónde viene lo de la tabla
 * y qué decirle a su equipo.
 */
function ComoLoAgregan() {
  const { t } = useTranslation();
  const tonos = useTonos();
  const estilos = useEstilos();
  return (
    <Row gap={spacing.md} align="center" style={estilos.como} testID="disponibilidad-como">
      <View
        style={[
          estilos.baldosa,
          { backgroundColor: tonos.turquesa.fondo, borderColor: tonos.turquesa.borde },
        ]}
      >
        <Ionicons name="phone-portrait-outline" size={20} color={tonos.turquesa.tinta} />
      </View>
      <Stack gap={2} style={estilos.crece}>
        <AppText variant="bodyStrong">{t('availability.howTitle')}</AppText>
        <AppText variant="help" tone="muted">
          {t('availability.howBody')}
        </AppText>
      </Stack>
    </Row>
  );
}

/**
 * EL RESUMEN ES LA LEYENDA: cada color con su palabra y CUÁNTOS hay. Una leyenda sola dice
 * qué significa el rojo; con la cuenta dice además si hay que mirarlo. Nunca solo color.
 * Lo nuevo no se cuenta aquí: ya lo cuenta la barra naranja de encima.
 */
function Resumen({
  noPueden,
  prefieren,
  comentarios,
}: {
  noPueden: number;
  prefieren: number;
  comentarios: number;
}) {
  const { t } = useTranslation();
  const tonos = useTonos();
  const estilos = useEstilos();
  const piezas = [
    {
      clave: 'no-puede',
      tono: tonos[TONO_DE_DISPONIBILIDAD.unavailable],
      icono: 'close-circle-outline' as const,
      texto: t('availability.countUnavailable', { count: noPueden }),
    },
    {
      clave: 'prefiere',
      tono: tonos[TONO_DE_DISPONIBILIDAD.preferred],
      icono: 'time-outline' as const,
      texto: t('availability.countPreferred', { count: prefieren }),
    },
    {
      clave: 'comentario',
      tono: tonos[TONO_DE_DISPONIBILIDAD.note],
      icono: 'chatbubble-ellipses-outline' as const,
      texto: t('availability.countNote', { count: comentarios }),
    },
  ];
  return (
    <Row gap={spacing.sm} wrap align="center" testID="disponibilidad-leyenda">
      {piezas.map((pieza) => (
        <View
          key={pieza.clave}
          style={[
            estilos.pieza,
            { backgroundColor: pieza.tono.fondo, borderColor: pieza.tono.borde },
          ]}
          testID={`disponibilidad-cuenta-${pieza.clave}`}
        >
          <Ionicons name={pieza.icono} size={16} color={pieza.tono.tinta} />
          <AppText variant="label" style={{ color: pieza.tono.tinta }} tabular>
            {pieza.texto}
          </AppText>
        </View>
      ))}
      <Row gap={spacing.xs} align="center" style={estilos.piezaSuelta}>
        <View style={[estilos.punto, { backgroundColor: tonos.naranja.solido }]} />
        <AppText variant="label" tone="muted">
          {t('availability.legendNew')}
        </AppText>
      </Row>
    </Row>
  );
}

/** La cabecera de cada tarjeta, con su baldosa de color y cuántas cosas trae. */
function CabeceraDeSeccion({
  icono,
  tono,
  titulo,
  cuenta,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  tono: Tono;
  titulo: string;
  cuenta: number;
}) {
  const tonos = useTonos();
  const estilos = useEstilos();
  return (
    <Row gap={spacing.sm} align="center">
      <View
        style={[
          estilos.baldosaChica,
          { backgroundColor: tonos[tono].fondo, borderColor: tonos[tono].borde },
        ]}
      >
        <Ionicons name={icono} size={16} color={tonos[tono].tinta} />
      </View>
      <AppText variant="bodyStrong" accessibilityRole="header" style={estilos.crece}>
        {titulo}
      </AppText>
      <AppText variant="label" tone="subtle" tabular>
        {String(cuenta)}
      </AppText>
    </Row>
  );
}

/**
 * EL HUECO DE LA TABLA: un «+» que aparece al pasar el puntero o al llegar con el teclado.
 *
 * Eran cincuenta «+» grises a la vista a la vez —siete por persona— y la tabla parecía una
 * hoja de cálculo vacía, con lo que alguien dijo perdido entre ellos. La tabla solo sale en
 * pantalla ancha, o sea con ratón: el hueco responde al puntero y sigue siendo un botón de
 * 44 px con su nombre para el lector de pantalla.
 */
function HuecoDeLaTabla({
  onPress,
  accessibilityLabel,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const { colors } = useTheme();
  const estilos = useEstilos();
  const respuesta = useRespuestaAlPuntero();
  const [visible, setVisible] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...respuesta.props}
      onHoverIn={() => {
        respuesta.props.onHoverIn();
        setVisible(true);
      }}
      onHoverOut={() => {
        respuesta.props.onHoverOut();
        setVisible(false);
      }}
      onFocus={() => {
        respuesta.props.onFocus();
        setVisible(true);
      }}
      onBlur={() => {
        respuesta.props.onBlur();
        setVisible(false);
      }}
      style={({ pressed }) => [estilos.hueco, ...respuesta.estilo(pressed)]}
    >
      <Ionicons name="add" size={18} color={visible ? colors.ink500 : 'transparent'} />
    </Pressable>
  );
}

type Persona = { id: string; nombre: string };

/** La semana en tabla: personas en filas, días en columnas. Pantalla ancha. */
function TablaSemanal({
  personas,
  filas,
  language,
  onAbrir,
  onAgregar,
  diaDeHoy,
}: {
  personas: readonly Persona[];
  filas: readonly Disponibilidad[];
  language: ReturnType<typeof currentLanguage>;
  onAbrir: (fila: Disponibilidad) => void;
  onAgregar: (employeeId: string, weekday: number) => void;
  /** El día de la semana de hoy (1-7): su columna se marca, como en Horario. */
  diaDeHoy: number;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  if (personas.length === 0) {
    return (
      <AppText variant="help" tone="subtle">
        {t('team.noEmployees')}
      </AppText>
    );
  }
  return (
    /* Las siete columnas se reparten el ancho: nada se arrastra ni se queda fuera. */
    <View testID="disponibilidad-tabla">
      <View>
        <Row gap={0}>
          <View style={[estilos.cabecera, estilos.columnaDeNombre]}>
            <AppText variant="label" tone="subtle">
              {t('schedule.employee')}
            </AppText>
          </View>
          {DIAS.map((dia) => (
            <View
              key={dia}
              style={[
                estilos.cabecera,
                estilos.columnaDeDia,
                dia === diaDeHoy ? estilos.cabeceraDeHoy : null,
              ]}
              testID={dia === diaDeHoy ? 'disponibilidad-hoy' : undefined}
            >
              <AppText
                variant="label"
                tone={dia === diaDeHoy ? 'primary' : 'subtle'}
                style={dia === diaDeHoy ? estilos.negrita : null}
              >
                {dia === diaDeHoy
                  ? t('availability.todayColumn', { day: nombreDelDiaDeSemana(dia, language) })
                  : nombreDelDiaDeSemana(dia, language)}
              </AppText>
            </View>
          ))}
        </Row>
        {personas.map((persona) => (
          <Row
            key={persona.id}
            gap={0}
            align="stretch"
            testID={`disponibilidad-fila-${persona.id}`}
          >
            <View style={[estilos.celda, estilos.columnaDeNombre]}>
              <Row gap={spacing.sm} align="center">
                <AnclaDePersona semilla={persona.id} nombre={persona.nombre} tamano="sm" />
                <AppText variant="bodyStrong" style={estilos.crece}>
                  {persona.nombre}
                </AppText>
              </Row>
            </View>
            {DIAS.map((dia) => {
              const delDia = filas.filter(
                (fila) => fila.employee_id === persona.id && fila.weekday === dia,
              );
              return (
                <View
                  key={dia}
                  style={[
                    estilos.celda,
                    estilos.columnaDeDia,
                    dia === diaDeHoy ? estilos.celdaDeHoy : null,
                  ]}
                >
                  <Stack gap={spacing.xs}>
                    {delDia.map((fila) => (
                      <ChipDeDisponibilidad
                        key={fila.id}
                        fila={fila}
                        conNota
                        onPress={() => onAbrir(fila)}
                        testID={`disponibilidad-${fila.id}`}
                      />
                    ))}
                    {delDia.length === 0 ? (
                      <HuecoDeLaTabla
                        onPress={() => onAgregar(persona.id, dia)}
                        accessibilityLabel={t('availability.addFor', {
                          name: persona.nombre,
                          day: nombreDelDiaDeSemana(dia, language),
                        })}
                        testID={`disponibilidad-agregar-${persona.id}-${dia}`}
                      />
                    ) : null}
                  </Stack>
                </View>
              );
            })}
          </Row>
        ))}
      </View>
    </View>
  );
}

/** En el teléfono: una tarjeta por persona con lo que dijo, día por día. */
function ListaSemanal({
  personas,
  filas,
  language,
  onAbrir,
}: {
  personas: readonly Persona[];
  filas: readonly Disponibilidad[];
  language: ReturnType<typeof currentLanguage>;
  onAbrir: (fila: Disponibilidad) => void;
}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const conAlgo = personas.filter((persona) => filas.some((f) => f.employee_id === persona.id));
  if (conAlgo.length === 0) {
    return (
      <AppText variant="help" tone="subtle" testID="disponibilidad-sin-semanales">
        {t('availability.emptyWeekly')}
      </AppText>
    );
  }
  return (
    <Stack gap={0}>
      {conAlgo.map((persona, indice) => (
        <View
          key={persona.id}
          style={[estilos.bloque, indice > 0 ? estilos.conRegla : null]}
          testID={`disponibilidad-fila-${persona.id}`}
        >
          <Row gap={spacing.sm} align="center">
            <AnclaDePersona semilla={persona.id} nombre={persona.nombre} tamano="sm" />
            <AppText variant="bodyStrong" style={estilos.crece}>
              {persona.nombre}
            </AppText>
          </Row>
          <Stack gap={spacing.xs}>
            {filas
              .filter((fila) => fila.employee_id === persona.id)
              .map((fila) => (
                <Row key={fila.id} gap={spacing.sm} align="flex-start">
                  <AppText variant="label" tone="subtle" style={estilos.diaEnLista}>
                    {t('availability.everyWeekday', {
                      day: nombreDelDiaDeSemana(fila.weekday ?? 1, language),
                    })}
                  </AppText>
                  <View style={estilos.crece}>
                    <ChipDeDisponibilidad
                      fila={fila}
                      conNota
                      onPress={() => onAbrir(fila)}
                      testID={`disponibilidad-${fila.id}`}
                    />
                  </View>
                </Row>
              ))}
          </Stack>
        </View>
      ))}
    </Stack>
  );
}

/** Un día puntual: la fecha en su baldosa, quién, y qué dijo. */
function FilaPuntual({
  fila,
  nombre,
  conRegla,
  language,
  onAbrir,
}: {
  fila: Disponibilidad;
  nombre: string;
  conRegla: boolean;
  language: ReturnType<typeof currentLanguage>;
  onAbrir: () => void;
}) {
  const estilos = useEstilos();
  const tonos = useTonos();
  const dia = (fila.date ?? '') as DateKey;
  return (
    <Row
      gap={spacing.md}
      align="center"
      wrap
      style={StyleSheet.flatten([estilos.puntual, conRegla ? estilos.conRegla : null])}
      testID={`disponibilidad-puntual-${fila.id}`}
    >
      <View
        style={[
          estilos.baldosaDeFecha,
          { backgroundColor: tonos.azul.fondo, borderColor: tonos.azul.borde },
        ]}
      >
        <AppText variant="bodyStrong" style={{ color: tonos.azul.tinta }} tabular>
          {dia.slice(8, 10)}
        </AppText>
        <AppText variant="label" style={{ color: tonos.azul.tinta }}>
          {formatDateKeyShort(dia, language).replace(/^\d+\s*/, '')}
        </AppText>
      </View>
      <Row gap={spacing.sm} align="center" style={estilos.quien}>
        <AnclaDePersona semilla={fila.employee_id} nombre={nombre} tamano="sm" />
        <AppText variant="bodyStrong">{nombre}</AppText>
      </Row>
      <View style={estilos.crece}>
        <ChipDeDisponibilidad
          fila={fila}
          conNota
          onPress={onAbrir}
          testID={`disponibilidad-${fila.id}`}
        />
      </View>
    </Row>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  crece: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  fondoDeSuperficie: { backgroundColor: colors.surface },
  barraNueva: {
    borderRadius: radii.card,
    borderWidth: borderWidth.focus,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.base,
    paddingRight: spacing.xs,
  },
  punto: { width: 8, height: 8, borderRadius: 4 },
  como: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
  },
  baldosa: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  baldosaChica: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieza: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: borderWidth.hairline,
    maxWidth: '100%',
  },
  piezaSuelta: { paddingHorizontal: spacing.xs },
  /* Hoy, como en Horario: la cabecera en el color de la app y la columna apenas teñida. */
  cabeceraDeHoy: { backgroundColor: colors.primary50, borderBottomColor: colors.primary600 },
  celdaDeHoy: { backgroundColor: colors.primary50 },
  negrita: { fontWeight: '700' },
  hueco: {
    minHeight: sizes.touchTargetMin,
    borderRadius: radii.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cabecera: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
  },
  columnaDeNombre: { width: 160, flexShrink: 0 },
  columnaDeDia: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  celda: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
  },
  bloque: { paddingVertical: spacing.md, gap: spacing.sm },
  conRegla: { borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
  diaEnLista: { width: 96, paddingTop: spacing.sm },
  puntual: { paddingVertical: spacing.sm },
  baldosaDeFecha: {
    width: 56,
    paddingVertical: spacing.xs,
    borderRadius: radii.input,
    borderWidth: borderWidth.hairline,
    alignItems: 'center',
  },
  quien: { minWidth: 160 },
}));
