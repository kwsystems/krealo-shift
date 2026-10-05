import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/ui/app-text';
import { useRespuestaAlPuntero } from '@/components/ui/layout';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { usePreferencesStore } from '@/stores/preferences-store';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, fontFamily, radii, shadows, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { contarSinVer, useAvisosStore } from './avisos-store';
import { BaldosaDelAviso, useDescribirAviso } from './piezas-del-aviso';

/**
 * LA CAMPANA DE AVISOS (5-oct), arriba a la derecha de la cabecera del panel: en TODAS las
 * vistas de quien gestiona, porque la cabecera cruza todas. Andree: «cuando alguien marca,
 * cuando alguien va a comer, a mí me debe salir una notificación arriba a la derecha».
 *
 * El número es lo que llegó desde la última vez que se abrió, en la sede que se mira. Abrir
 * la campana lo pone a cero y lo recuerda en este dispositivo (`avisosVistosHasta`): recargar
 * no vuelve a pintar lo que ya se miró.
 *
 * EL PANEL CUELGA DE LA CAMPANA en pantalla ancha y ocupa el ancho en el teléfono, siempre
 * arriba: se abre donde se pulsó y no tapa la pantalla de abajo a arriba como una hoja.
 *
 * ES PEQUEÑO SIEMPRE, también con cincuenta marcas (6-oct). Andree: «no quiero que sea grande
 * y se vea todo». La lista tiene un alto fijo de unas seis filas y se desplaza dentro; la
 * cabecera dice cuántas hay hoy y el pie cabe en una línea.
 *
 * CADA DÍA EMPIEZA VACÍA, a medianoche de la sede (ver `useVigiaDeAvisos`): es lo que pasa
 * HOY, no un archivo. El historial de todas las marcas, de todos los días, ya existe y no se
 * borra nunca: es Horas. La campana lo dice al final de la lista y lleva allí.
 */
const ANCHO_DEL_PANEL = 360;
/** Unas seis filas: lo que se ve sin desplazar. Más, y el panel deja de ser un vistazo. */
const ALTO_DE_LA_LISTA = 300;
/** Desde aquí el panel cuelga de la campana; por debajo, de borde a borde. */
const ANCHO_PARA_COLGAR = 600;

export function CampanaDeAvisos() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const respuesta = useRespuestaAlPuntero();
  const { locationId } = useManagerScope();
  const marcas = useAvisosStore((s) => s.marcas);
  const abierto = useAvisosStore((s) => s.panelAbierto);
  const abrirPanel = useAvisosStore((s) => s.abrirPanel);
  const cerrarPanel = useAvisosStore((s) => s.cerrarPanel);
  const vistasHasta = usePreferencesStore((s) =>
    locationId === null ? undefined : s.avisosVistosHasta[locationId],
  );
  const marcarAvisosVistos = usePreferencesStore((s) => s.marcarAvisosVistos);

  const campana = useRef<View>(null);
  const [ancla, setAncla] = useState<{ arriba: number; derecha: number } | null>(null);
  const { width: anchoVentana } = useWindowDimensions();

  /*
   * LO VISTO SE APUNTA AL CERRAR, no al abrir: mientras la campana está abierta, lo que
   * llegó desde la última vez sigue marcado como nuevo en la lista —que es lo que quien la
   * abre quiere distinguir—, y lo que llega con ella abierta también. Al cerrarla, todo
   * queda visto y el número se va. Abierta, el número no se pinta: la lista ya lo dice.
   */
  const sinVer = abierto ? 0 : contarSinVer(marcas, vistasHasta);
  const cerrar = () => {
    const ultima = useAvisosStore.getState().marcas.at(-1);
    if (locationId !== null && ultima !== undefined) {
      void marcarAvisosVistos(locationId, ultima.received_at);
    }
    cerrarPanel();
  };

  // Se abre desde la campana o desde un emergente: en los dos casos se mide aquí.
  useEffect(() => {
    if (!abierto) return;
    campana.current?.measureInWindow((x, y, ancho, alto) => {
      setAncla({
        arriba: y + alto + spacing.xs,
        derecha: Math.max(spacing.sm, anchoVentana - (x + ancho)),
      });
    });
  }, [abierto, anchoVentana]);

  return (
    <>
      <Pressable
        ref={campana}
        onPress={abrirPanel}
        accessibilityRole="button"
        accessibilityLabel={
          sinVer > 0 ? t('alerts.bellUnread', { count: sinVer }) : t('alerts.bell')
        }
        accessibilityState={{ expanded: abierto }}
        testID="avisos-campana"
        style={estilos.campanaPulsable}
        {...respuesta.props}
      >
        {({ pressed }) => (
          <View style={[estilos.campana, ...respuesta.estilo(pressed)]}>
            <Ionicons
              name={sinVer > 0 ? 'notifications' : 'notifications-outline'}
              size={22}
              color={sinVer > 0 ? colors.primary600 : colors.ink700}
            />
            {sinVer > 0 ? (
              <View style={estilos.contador} testID="avisos-contador">
                <AppText style={estilos.contadorTexto} tabular>
                  {sinVer > 9 ? '9+' : String(sinVer)}
                </AppText>
              </View>
            ) : null}
          </View>
        )}
      </Pressable>

      <PanelDeAvisos
        visible={abierto}
        ancla={ancla}
        vistasHasta={vistasHasta}
        colgado={anchoVentana >= ANCHO_PARA_COLGAR}
        onClose={cerrar}
      />
    </>
  );
}

function PanelDeAvisos({
  visible,
  ancla,
  vistasHasta,
  colgado,
  onClose,
}: {
  visible: boolean;
  ancla: { arriba: number; derecha: number } | null;
  /** Lo que llegó después de esto se marca como nuevo. Sin nada visto en la sede, todo. */
  vistasHasta: string | undefined;
  colgado: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { location } = useManagerScope();
  const describir = useDescribirAviso();
  const marcas = useAvisosStore((s) => s.marcas);
  const cargado = useAvisosStore((s) => s.cargado);
  const error = useAvisosStore((s) => s.error);
  const emergentes = usePreferencesStore((s) => s.avisosEmergentes);
  const setAvisosEmergentes = usePreferencesStore((s) => s.setAvisosEmergentes);

  const arriba = ancla?.arriba ?? 64;
  const posicion = colgado
    ? { top: arriba, right: ancla?.derecha ?? spacing.xl, width: ANCHO_DEL_PANEL }
    : { top: arriba, left: spacing.sm, right: spacing.sm };
  const recientes = [...marcas].reverse();
  /*
   * LA LISTA, COMO MUCHO SEIS FILAS; en una ventana bajita, lo que quepa debajo de la cabecera
   * del panel y encima del pie (los 130 px de los dos), sin que el panel se salga.
   */
  const altoDeLaLista = Math.max(
    120,
    Math.min(ALTO_DE_LA_LISTA, height - arriba - 130 - spacing.base),
  );
  const irAlHistorial = () => {
    onClose();
    router.navigate('/(manager)/hours');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[estilos.fondo, colgado ? null : estilos.fondoVelado]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('alerts.close')}
        testID="avisos-fondo"
      />
      <View style={[estilos.panel, posicion]} testID="avisos-panel" accessibilityViewIsModal>
        <View style={estilos.cabecera}>
          <View style={estilos.cabeceraTexto}>
            <AppText variant="section" style={estilos.titulo}>
              {t('alerts.title')}
            </AppText>
            <AppText variant="help" tone="subtle" numberOfLines={1} testID="avisos-subtitulo">
              {[
                location === null
                  ? t('alerts.today')
                  : t('alerts.todayAt', { location: location.name }),
                recientes.length > 0 ? t('alerts.marks', { count: recientes.length }) : null,
              ]
                .filter((parte): parte is string => parte !== null)
                .join(' · ')}
            </AppText>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('alerts.close')}
            style={estilos.cerrar}
            testID="avisos-cerrar"
          >
            <Ionicons name="close" size={22} color={colors.ink700} />
          </Pressable>
        </View>

        <ScrollView
          style={[estilos.lista, { maxHeight: altoDeLaLista }]}
          contentContainerStyle={estilos.listaContenido}
          testID="avisos-lista"
        >
          {recientes.length === 0 ? (
            <View
              style={estilos.vacio}
              testID={error && !cargado ? 'avisos-error' : 'avisos-vacio'}
            >
              <Ionicons
                name={error && !cargado ? 'cloud-offline-outline' : 'notifications-off-outline'}
                size={28}
                color={colors.ink500}
              />
              <AppText variant="help" tone="subtle" style={estilos.vacioTexto}>
                {error && !cargado ? t('alerts.loadError') : t('alerts.empty')}
              </AppText>
            </View>
          ) : (
            recientes.map((marca) => {
              const aviso = describir(marca);
              const nueva = vistasHasta === undefined || marca.received_at > vistasHasta;
              return (
                <View
                  key={marca.id}
                  style={[estilos.fila, nueva ? estilos.filaNueva : null]}
                  accessible
                  accessibilityLabel={`${aviso.texto}, ${aviso.hora}${nueva ? `. ${t('alerts.unseen')}` : ''}`}
                  testID={`aviso-fila-${marca.id}`}
                >
                  <BaldosaDelAviso clase={aviso.clase} lado={32} />
                  <View style={estilos.filaTexto}>
                    <AppText variant="body" style={estilos.frase}>
                      {aviso.texto}
                    </AppText>
                    {marca.is_offline ? (
                      <AppText variant="help" tone="subtle">
                        {t('alerts.offline')}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={estilos.filaHora}>
                    <AppText variant="help" tone="muted" tabular>
                      {aviso.hora}
                    </AppText>
                    {nueva ? <View style={estilos.punto} testID="aviso-sin-ver" /> : null}
                  </View>
                </View>
              );
            })
          )}
          {/* Lo que Andree preguntó, dicho donde se pregunta: ¿se borra?, ¿dónde está lo de antes? */}
          {recientes.length === 0 ? null : (
            <AppText
              variant="help"
              tone="subtle"
              style={estilos.finDelDia}
              testID="avisos-fin-del-dia"
            >
              {t('alerts.endOfDay')}
            </AppText>
          )}
        </ScrollView>

        {/*
          EL PIE, EN UNA LÍNEA: el aviso de arriba sí o no, y el historial. La explicación del
          interruptor va en su nombre accesible y no en un párrafo que ocupe medio panel.
        */}
        <View style={estilos.pie}>
          <Pressable
            onPress={() => void setAvisosEmergentes(!emergentes)}
            accessibilityRole="switch"
            accessibilityState={{ checked: emergentes }}
            accessibilityLabel={t('alerts.popups')}
            accessibilityHint={t('alerts.popupsHelp')}
            style={estilos.interruptor}
            testID="avisos-interruptor"
          >
            {/*
              EL INTERRUPTOR NO RECIBE EL TOQUE: lo recibe la fila entera, que es más fácil de
              acertar. Si recibiera los dos, un clic encima cambiaría el valor dos veces y no
              haría nada.
            */}
            <View pointerEvents="none">
              <Switch
                value={emergentes}
                trackColor={{ false: colors.border, true: colors.primary200 }}
                thumbColor={emergentes ? colors.primary600 : colors.surface}
                {...({ activeThumbColor: colors.primary600 } as object)}
                importantForAccessibility="no"
                accessibilityElementsHidden
              />
            </View>
            <AppText variant="label" tone="muted">
              {t('alerts.popupsShort')}
            </AppText>
          </Pressable>
          <Pressable
            onPress={irAlHistorial}
            accessibilityRole="link"
            style={estilos.historial}
            testID="avisos-historial"
          >
            {/*
              `primary700` Y NO EL TONO `primary`: sobre el fondo elevado del panel, en oscuro,
              el violeta de siempre se quedaba en 4,26:1 (medido por avisos-check).
            */}
            <AppText variant="label" style={{ color: colors.primary700 }}>
              {t('alerts.history')}
            </AppText>
            <Ionicons name="chevron-forward" size={14} color={colors.primary700} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  /*
   * LA CAMPANA SE QUEDA A LA DERECHA: `marginLeft: 'auto'` la empuja al borde sin un
   * hueco que crezca, y no encoge, porque lo que cede en una cabecera estrecha es el
   * nombre de la empresa, no el botón.
   */
  campanaPulsable: { marginLeft: 'auto', flexShrink: 0 },
  campana: {
    width: sizes.touchTargetMin,
    height: sizes.touchTargetMin,
    borderRadius: radii.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contador: {
    position: 'absolute',
    top: 3,
    right: 1,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.primary600,
    // El anillo del color de la cabecera separa el número de la campana que pisa.
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contadorTexto: {
    color: colors.onPrimary,
    fontFamily: fontFamily.semibold,
    fontSize: 11,
    lineHeight: 14,
  },
  fondo: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  fondoVelado: { backgroundColor: 'rgba(0,0,0,0.28)' },
  panel: {
    position: 'absolute',
    backgroundColor: colors.raised,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.floating,
  },
  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.base,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
  },
  cabeceraTexto: { flex: 1, minWidth: 0 },
  titulo: { fontSize: 17 },
  cerrar: {
    width: sizes.touchTargetMin,
    height: sizes.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
  },
  lista: { flexGrow: 0, flexShrink: 1 },
  listaContenido: { paddingVertical: spacing.xs },
  vacio: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  vacioTexto: { textAlign: 'center' },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.base,
  },
  filaNueva: { backgroundColor: colors.primary50 },
  filaTexto: { flex: 1, minWidth: 0 },
  frase: { fontSize: 14, lineHeight: 19 },
  filaHora: { alignItems: 'flex-end', gap: spacing.xs, flexShrink: 0 },
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary600 },
  finDelDia: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  pie: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: colors.border,
  },
  interruptor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
  },
  historial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
  },
}));
