import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/ui/app-text';
import { GhostButton } from '@/components/ui/buttons';
import { useRespuestaAlPuntero } from '@/components/ui/layout';
import { ToggleField } from '@/components/schedule/fields';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
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
 */
const ANCHO_DEL_PANEL = 384;
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
  const { useSidebar } = useResponsive();
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[estilos.fondo, colgado ? null : estilos.fondoVelado]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('alerts.close')}
        testID="avisos-fondo"
      />
      <View
        style={[
          estilos.panel,
          posicion,
          { maxHeight: Math.max(280, height - arriba - spacing.base) },
        ]}
        testID="avisos-panel"
        accessibilityViewIsModal
      >
        <View style={estilos.cabecera}>
          <View style={estilos.cabeceraTexto}>
            <AppText variant="section" style={estilos.titulo}>
              {t('alerts.title')}
            </AppText>
            <AppText variant="help" tone="subtle" numberOfLines={1}>
              {location === null
                ? t('alerts.subtitleNoLocation')
                : t('alerts.subtitle', { location: location.name })}
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

        <ScrollView style={estilos.lista} contentContainerStyle={estilos.listaContenido}>
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
                  <BaldosaDelAviso clase={aviso.clase} />
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
        </ScrollView>

        <View style={estilos.pie}>
          <ToggleField
            label={t('alerts.popups')}
            hint={t('alerts.popupsHelp')}
            value={emergentes}
            onChange={(valor) => void setAvisosEmergentes(valor)}
            testID="avisos-interruptor"
          />
          <GhostButton
            label={t('alerts.seeWhoIsIn')}
            onPress={() => {
              onClose();
              router.navigate('/(manager)');
            }}
            fullWidth={!useSidebar}
            testID="avisos-ver-inicio"
          />
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
  titulo: { fontSize: 18 },
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  filaNueva: { backgroundColor: colors.primary50 },
  filaTexto: { flex: 1, minWidth: 0 },
  frase: { fontSize: 15, lineHeight: 20 },
  filaHora: { alignItems: 'flex-end', gap: spacing.xs, flexShrink: 0 },
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary600 },
  pie: {
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: colors.border,
  },
}));
