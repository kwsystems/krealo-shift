import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { SegmentedControl } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { LanguageSwitch } from '@/components/ui/language-switch';
import { AppScreen, Card, ResponsiveContainer, Row, Stack } from '@/components/ui/layout';
import { useResponsive } from '@/hooks/use-responsive';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, radii, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * MANUAL DE USO, EN LA APP Y SIN CONTRASEÑA.
 *
 * POR QUÉ NO ES UN PDF NI UN DOCUMENTO. Lo que hay que explicar no es la app en general:
 * son cuatro marcas al día y seis cosas que pueden pasar en el mostrador con alguien
 * esperando. Eso se consulta EN EL MOMENTO, desde el celular de quien está trabajando, y
 * un PDF en un chat no se encuentra cuando hace falta. Además se queda viejo en silencio:
 * esta página se despliega con la app, así que cuando cambia el botón cambia el manual.
 *
 * ABIERTA A PROPÓSITO, y es una decisión con consecuencias que conviene decir en voz alta:
 * se comparte por enlace y no pide sesión. Lo que cuenta es CÓMO se usa la app —los pasos,
 * los avisos, qué hacer si olvidaste marcar—, no un dato de nadie: ni nombres, ni horarios,
 * ni PIN, ni el nombre de la tienda. Si alguna vez hay que poner algo de una empresa
 * concreta aquí, entonces esta página deja de poder ser pública.
 *
 * DOS PÚBLICOS EN UNA PÁGINA, con un selector arriba. Quien ficha entra por «Marcar mi
 * asistencia» y no tiene que pasar por cómo se publica un horario; quien administra tiene
 * lo suyo a un toque. Un solo enlace que sirve para los dos, que es lo que se pidió.
 *
 * SE LEE EN UN TELÉFONO: una columna, sin tablas, sin nada que se arrastre en horizontal.
 * El arnés `manual:check` lo mide a 390, 768 y 1440 px.
 *
 * Y EN PANTALLA ANCHA, A DOS COLUMNAS. Era una tira de 520 px en medio de un monitor, con
 * todo el resto vacío: lo dijo Andree el 29-sep, «en web se ve mal». Ahora, cuando el
 * contenido tiene sitio (760 px o más), lo que va junto se pone junto —las cuatro marcas
 * al lado del paso a paso, los casos en tarjetas de dos en dos—. El ancho se mide en un
 * contenedor EXTERIOR: dentro del panel el menú lateral se come parte de la ventana, así
 * que la ventana no dice cuánto sitio hay.
 */
export function ManualScreen({ dentroDelPanel = false }: { dentroDelPanel?: boolean } = {}) {
  const { t } = useTranslation();
  const estilos = useEstilos();
  const { isCompact } = useResponsive();
  const [parte, setParte] = useState<'trabajadora' | 'administra'>('trabajadora');
  /** Ancho que de verdad tiene el contenido: ver «A DOS COLUMNAS», arriba. */
  const [ancho, setAncho] = useState(0);
  const dos = ancho >= 760;

  /*
   * LA DIRECCIÓN SALE DEL NAVEGADOR, no de una constante. Este manual se sirve desde el
   * mismo sitio que la app, así que el origen ES la dirección buena; escribirla a mano
   * sería una copia que se queda vieja el día que cambie el dominio —y el manual es justo
   * donde esa copia haría más daño, porque es lo que alguien va a teclear en la tablet—.
   */
  const direccionDelReloj =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/kiosk`
      : null;

  const casos = [
    'casePin',
    'caseEarly',
    'caseLate',
    'caseForgot',
    'caseRest',
    'caseEarlyOut',
    'caseOffline',
  ];

  return (
    <AppScreen tone="canvas" scroll testID="manual-screen">
      <View onLayout={(evento) => setAncho(evento.nativeEvent.layout.width)} testID="manual-medida">
        <ResponsiveContainer
          width={dos ? 'content' : 'form'}
          style={dos ? estilos.ancho : undefined}
        >
          <Stack gap={spacing.lg}>
            <Stack gap={spacing.sm}>
              {/*
                DENTRO DEL PANEL NO SE REPITE LA CABECERA. «Krealo Shift» y el idioma ya
                están en la app alrededor; aquí eran una segunda cabecera. En el enlace
                abierto (`/manual`) sí van: ahí no hay app alrededor.
              */}
              {dentroDelPanel ? null : (
                <Row justify="space-between" align="center" gap={spacing.sm} wrap>
                  <AppText variant="label" tone="primary">
                    Krealo Shift
                  </AppText>
                  <LanguageSwitch />
                </Row>
              )}
              <AppText variant="title">{t('manual.title')}</AppText>
              <AppText variant="body" tone="muted" style={dos ? estilos.entradilla : undefined}>
                {t('manual.subtitle')}
              </AppText>
            </Stack>

            <SegmentedControl
              label={t('manual.title')}
              value={parte}
              options={[
                { value: 'trabajadora', label: t('manual.tabWorker') },
                { value: 'administra', label: t('manual.tabAdmin') },
              ]}
              onChange={setParte}
              testID="manual-parte"
            />

            {parte === 'trabajadora' ? (
              <Stack gap={spacing.lg}>
                <Columnas dos={dos}>
                  <Stack gap={spacing.lg}>
                    <Bloque
                      titulo={t('manual.workerWhereTitle')}
                      cuerpo={t('manual.workerWhereBody')}
                    />
                    <Seccion titulo={t('manual.marksTitle')}>
                      <Stack gap={spacing.sm}>
                        {[1, 2, 3, 4].map((numero) => (
                          <Paso
                            key={numero}
                            numero={numero}
                            titulo={t(`manual.mark${numero}`)}
                            cuerpo={t(`manual.mark${numero}When`)}
                          />
                        ))}
                      </Stack>
                      <Aviso
                        icono="alert-circle-outline"
                        titulo={t('manual.marksWhyTitle')}
                        cuerpo={t('manual.marksWhyBody')}
                      />
                    </Seccion>
                  </Stack>
                  <Seccion titulo={t('manual.howTitle')}>
                    <Stack gap={spacing.sm}>
                      {[1, 2, 3, 4, 5].map((numero) => (
                        <Paso key={numero} numero={numero} cuerpo={t(`manual.how${numero}`)} />
                      ))}
                    </Stack>
                  </Seccion>
                </Columnas>

                <Seccion titulo={t('manual.casesTitle')}>
                  {/*
                    LOS CASOS, EN TARJETAS DE DOS EN DOS en pantalla ancha: son siete cosas
                    independientes, y se busca la que te pasa, no se leen de corrido. En un
                    teléfono, una debajo de otra como siempre.
                  */}
                  {dos ? (
                    <Stack gap={spacing.base}>
                      {pares(casos).map((par) => (
                        <Columnas key={par[0]} dos>
                          {par.map((clave) => (
                            <Card key={clave} style={estilos.caso}>
                              <Bloque
                                titulo={t(`manual.${clave}Title`)}
                                cuerpo={t(`manual.${clave}Body`)}
                              />
                            </Card>
                          ))}
                        </Columnas>
                      ))}
                    </Stack>
                  ) : (
                    <Stack gap={spacing.base}>
                      {casos.map((clave) => (
                        <Bloque
                          key={clave}
                          titulo={t(`manual.${clave}Title`)}
                          cuerpo={t(`manual.${clave}Body`)}
                        />
                      ))}
                    </Stack>
                  )}
                </Seccion>

                <Columnas dos={dos}>
                  <Bloque
                    titulo={t('manual.breakReasonsTitle')}
                    cuerpo={t('manual.breakReasonsBody')}
                  />
                  <Aviso
                    icono="lock-closed-outline"
                    titulo={t('manual.pinTitle')}
                    cuerpo={t('manual.pinBody')}
                  />
                </Columnas>
              </Stack>
            ) : (
              <Stack gap={spacing.lg}>
                <Aviso
                  icono="megaphone-outline"
                  titulo={t('manual.adminPublishTitle')}
                  cuerpo={t('manual.adminPublishBody')}
                />
                {pares(['adminSchedule', 'adminTeam', 'adminHours', 'adminInbox']).map((par) => (
                  <Columnas key={par[0]} dos={dos}>
                    {par.map((clave) => (
                      <Bloque
                        key={clave}
                        titulo={t(`manual.${clave}Title`)}
                        cuerpo={t(`manual.${clave}Body`)}
                      />
                    ))}
                  </Columnas>
                ))}

                <Columnas dos={dos}>
                  <Seccion titulo={t('manual.adminKioskTitle')}>
                    <AppText variant="body">{t('manual.adminKioskBody')}</AppText>
                    {direccionDelReloj === null ? null : (
                      <View style={estilos.direccion}>
                        <AppText variant="label" tone="subtle">
                          {t('manual.adminKioskAddress')}
                        </AppText>
                        <AppText variant="bodyStrong" selectable testID="manual-clock-address">
                          {direccionDelReloj}
                        </AppText>
                      </View>
                    )}
                    <AppText variant="help" tone="muted">
                      {t('manual.adminKioskNote')}
                    </AppText>
                  </Seccion>
                  <Aviso
                    icono="time-outline"
                    titulo={t('manual.adminBreakTitle')}
                    cuerpo={t('manual.adminBreakBody')}
                  />
                </Columnas>
              </Stack>
            )}

            <AppText variant="help" tone="subtle" style={isCompact ? undefined : estilos.pie}>
              {t('manual.footer')}
            </AppText>
          </Stack>
        </ResponsiveContainer>
      </View>
    </AppScreen>
  );
}

/** De dos en dos: [a, b, c] → [[a, b], [c]]. */
function pares<T>(lista: T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += 2) salida.push(lista.slice(i, i + 2));
  return salida;
}

/**
 * Dos columnas del mismo ancho cuando hay sitio; una debajo de otra cuando no. Con una sola
 * pieza en la fila (el último caso de siete) se queda a media anchura y no se estira: una
 * tarjeta sola de 900 px leería como otra cosa que sus compañeras.
 */
function Columnas({ dos, children }: { dos: boolean; children: React.ReactNode }) {
  const estilos = useEstilos();
  if (!dos) return <Stack gap={spacing.lg}>{children}</Stack>;
  const hijos = Array.isArray(children) ? children : [children];
  return (
    <Row gap={spacing.lg} align="stretch">
      {hijos.map((hijo, i) => (
        <View key={i} style={estilos.columna}>
          {hijo}
        </View>
      ))}
      {hijos.length === 1 ? <View style={estilos.columna} /> : null}
    </Row>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Stack gap={spacing.sm}>
      <AppText variant="section">{titulo}</AppText>
      {children}
    </Stack>
  );
}

function Bloque({ titulo, cuerpo }: { titulo: string; cuerpo: string }) {
  return (
    <Stack gap={spacing.xs}>
      <AppText variant="bodyStrong">{titulo}</AppText>
      <AppText variant="body" tone="muted">
        {cuerpo}
      </AppText>
    </Stack>
  );
}

/** Un paso numerado. El número va en su círculo: la secuencia se ve antes de leerla. */
function Paso({ numero, titulo, cuerpo }: { numero: number; titulo?: string; cuerpo: string }) {
  const estilos = useEstilos();
  return (
    <Row gap={spacing.sm} align="flex-start">
      <View style={estilos.numero}>
        <AppText variant="label" tone="primary" tabular>
          {String(numero)}
        </AppText>
      </View>
      <Stack gap={spacing.xs} style={estilos.crece}>
        {titulo === undefined ? null : <AppText variant="bodyStrong">{titulo}</AppText>}
        <AppText variant="body" tone={titulo === undefined ? 'default' : 'muted'}>
          {cuerpo}
        </AppText>
      </Stack>
    </Row>
  );
}

/** Lo que no se puede leer por encima: va en una tarjeta con icono. */
function Aviso({
  icono,
  titulo,
  cuerpo,
}: {
  icono: React.ComponentProps<typeof Ionicons>['name'];
  titulo: string;
  cuerpo: string;
}) {
  const { colors } = useTheme();
  const estilos = useEstilos();
  return (
    <Card style={estilos.aviso}>
      <Row gap={spacing.sm} align="flex-start">
        <Ionicons name={icono} size={sizes.iconMobile} color={colors.primary500} />
        <Stack gap={spacing.xs} style={estilos.crece}>
          <AppText variant="bodyStrong">{titulo}</AppText>
          <AppText variant="body" tone="muted">
            {cuerpo}
          </AppText>
        </Stack>
      </Row>
    </Card>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  /* `minWidth: 0` con `flexShrink`: en web, sin él, el texto no envuelve y estira la fila. */
  crece: { flexShrink: 1, flexGrow: 1, minWidth: 0 },
  numero: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aviso: { borderColor: colors.primary500, borderWidth: borderWidth.hairline },
  direccion: {
    backgroundColor: colors.hundido,
    borderRadius: radii.input,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  pie: { paddingTop: spacing.base },
  /* A dos columnas, un ancho de lectura: con los 1200 de `content` las líneas se hacían
     eternas y la página parecía un informe, no un manual. */
  ancho: { maxWidth: 1040 },
  entradilla: { maxWidth: 680 },
  columna: { flex: 1, flexBasis: 0, minWidth: 0 },
  caso: { flex: 1 },
}));
