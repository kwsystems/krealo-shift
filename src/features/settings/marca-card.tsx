import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { OrganizationLogoField } from './logo-field';
import { useSettingsMutations } from './hooks';
import { FormCard, InlineNotice } from '@/components/schedule/fields';
import { AppText } from '@/components/ui/app-text';
import { GhostButton, PrimaryButton } from '@/components/ui/buttons';
import { FormField } from '@/components/ui/form-field';
import { Row, Stack, useRespuestaAlPuntero } from '@/components/ui/layout';
import { rampaDeMarca } from '@/domain/marca';
import { useManagerScope, type ManagerOrganization } from '@/hooks/use-manager-scope';
import { estilosDelTema } from '@/theme/estilos';
import { radii, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * LA TARJETA «MARCA»: el logotipo y el color de la empresa, juntos.
 *
 * POR QUÉ ES UNA TARJETA Y NO UNA PESTAÑA. Andree dijo «falta una pestaña para branding».
 * Va aquí porque las pestañas de la barra son los sitios donde se TRABAJA todos los días
 * —Inicio, Equipo, Horario, Horas— y la marca se toca una vez cuando se monta la tienda y
 * casi nunca más. Una pestaña permanente para eso le quita sitio a las que se usan a
 * diario, y en teléfono ya van siete justas. Si al verlo la prefiere pestaña, se mueve: es
 * un cambio pequeño y conviene decidirlo viéndolo.
 *
 * Y JUNTA EL LOGOTIPO, que vivía dentro de «Organización» entre la zona horaria y el
 * inicio de semana. Esas dos son reglas de negocio; un logotipo es marca. Estaban juntas
 * solo porque el logotipo llegó antes de que hubiera un sitio al que pertenecer.
 */
export function MarcaCard({
  organization,
  canEdit,
  abiertaDeEntrada = false,
}: {
  organization: ManagerOrganization;
  canEdit: boolean;
  abiertaDeEntrada?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const estilos = useEstilos();
  const mutations = useSettingsMutations(organization.id);
  const scope = useManagerScope();

  const [texto, setTexto] = useState(organization.brand_color ?? '');
  const normalizado = texto.trim().toUpperCase();
  const valido = /^#[0-9A-F]{6}$/.test(normalizado);
  const vacio = normalizado === '';

  /*
   * LA RAMPA SE DERIVA AQUÍ, EN VIVO, con la misma función que usa el tema. No es una
   * aproximación para la vista previa: es EL cálculo, así que lo que se ve es exactamente
   * lo que se va a publicar. Una vista previa que usa otra cuenta que la real es peor que
   * ninguna, porque enseña algo que nadie va a ver.
   */
  const veredicto = useMemo(
    () =>
      valido
        ? rampaDeMarca(
            normalizado,
            colors.surface,
            { trabajando: colors.success600, pausa: colors.warning600, tarde: colors.danger600 },
            [colors.onPrimary],
          )
        : null,
    [valido, normalizado, colors],
  );

  const guardado = organization.brand_color ?? '';
  const haCambiado = normalizado !== guardado;

  return (
    <FormCard
      collapsible
      defaultOpen={abiertaDeEntrada}
      title={t('settings.brand')}
      description={t('settings.brandHint')}
    >
      <OrganizationLogoField
        organizationId={organization.id}
        logoPath={organization.logo_path}
        canEdit={canEdit}
        onChanged={() => scope.refetch()}
      />

      <Stack gap={spacing.sm}>
        <AppText variant="bodyStrong">{t('settings.brandColor')}</AppText>
        <AppText variant="help" tone="subtle">
          {t('settings.brandColorHint')}
        </AppText>

        {/*
          LOS TONOS SUGERIDOS EXISTEN PORQUE NADIE SE SABE SU HEX DE MEMORIA. Quien viene a
          poner el color de su negocio no siempre tiene el código a mano, y obligarle a
          buscarlo en su manual de marca antes de poder probar nada es la diferencia entre
          que use esto y que lo deje para luego. Son un punto de partida, no una paleta:
          el campo de texto sigue aceptando el suyo exacto.
        */}
        {canEdit ? (
          <Row gap={spacing.sm} style={estilos.sugeridos}>
            {SUGERIDOS.map((tono) => (
              <TonoSugerido
                key={tono}
                color={tono}
                elegido={tono === normalizado}
                onPress={() => setTexto(tono)}
              />
            ))}
          </Row>
        ) : null}

        <FormField
          label={t('settings.brandColorLabel')}
          value={texto}
          onChangeText={setTexto}
          autoCapitalize="characters"
          editable={canEdit}
          error={vacio || valido ? undefined : t('settings.brandColorInvalid')}
          testID="brand-color"
        />

        {/*
          EL AVISO VA AQUÍ, EN EL MOMENTO DE ELEGIR, y con el número. Aceptar en silencio y
          arreglarlo por dentro sería peor: quien eligió su color corporativo tiene derecho
          a saber que lo que va a ver no es exactamente ese, y por qué.
        */}
        {veredicto?.avisos.map((aviso) => (
          <InlineNotice
            key={aviso.estado}
            tone="warning"
            icon="alert-circle"
            title={t('settings.brandNearStatus', { estado: t(`settings.brandState.${aviso.estado}`) })}
            body={t('settings.brandNearStatusBody', { distancia: aviso.distancia })}
            testID={`brand-aviso-${aviso.estado}`}
          />
        ))}
        {veredicto?.sinColor === true ? (
          <InlineNotice
            tone="warning"
            icon="information-circle"
            title={t('settings.brandGrey')}
            body={t('settings.brandGreyBody')}
            testID="brand-aviso-gris"
          />
        ) : null}

        {veredicto === null ? null : (
          <VistaPreviaDelReloj
            nombre={organization.name}
            rampa={veredicto.rampa}
            tinta={colors.ink900}
            apagada={colors.ink500}
          />
        )}

        {canEdit ? (
          <Row gap={spacing.sm}>
            <PrimaryButton
              label={t('common.save')}
              disabled={!haCambiado || (!vacio && !valido)}
              loading={mutations.saveBrandColor.isPending}
              onPress={() => mutations.saveBrandColor.mutate(vacio ? null : normalizado)}
              fullWidth={false}
              testID="brand-color-save"
            />
            {guardado === '' ? null : (
              <GhostButton
                label={t('settings.brandClear')}
                onPress={() => {
                  setTexto('');
                  mutations.saveBrandColor.mutate(null);
                }}
                fullWidth={false}
                testID="brand-color-clear"
              />
            )}
          </Row>
        ) : null}
      </Stack>
    </FormCard>
  );
}

/**
 * Cinco puntos de partida, uno por familia de tono.
 *
 * NINGUNO ES VERDE, ÁMBAR NI ROJO, por lo mismo que las anclas de identidad: esos tres
 * significan estado en esta app. Sugerir un verde sería empujar a alguien hacia el aviso
 * que la propia pantalla le va a dar dos líneas más abajo.
 */
const SUGERIDOS = ['#5B3FD6', '#1D4ED8', '#0E6E8E', '#C2185B', '#7C4A2A'] as const;

function TonoSugerido({
  color,
  elegido,
  onPress,
}: {
  color: string;
  elegido: boolean;
  onPress: () => void;
}) {
  const estilos = useEstilos();
  const { t } = useTranslation();
  const respuesta = useRespuestaAlPuntero();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /* El hex se dice con palabras: un cuadrado de color no lo oye nadie. */
      accessibilityLabel={t('settings.brandSwatch', { color })}
      accessibilityState={{ selected: elegido }}
      testID={`brand-swatch-${color}`}
      {...respuesta.props}
    >
      {({ pressed }) => (
        <View style={[estilos.sugerido, ...respuesta.estilo(pressed)]}>
          <View style={[estilos.muestra, { backgroundColor: color }]} />
          {elegido ? <View style={estilos.elegido} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/**
 * EL RELOJ EN MINIATURA, y no un cuadradito de color.
 *
 * Quien elige el color no está eligiendo un color: está decidiendo cómo se va a ver la
 * pantalla que su equipo mira cuatro veces al día. Eso no se puede juzgar en una muestra
 * de 40×40, y el sitio donde se descubre hoy es el iPad colgado en la pared, que es el
 * peor posible.
 *
 * Lleva los cuatro papeles del acento a la vez —fondo, texto, puntos y botón— porque son
 * justo los que pueden salir mal por separado.
 */
function VistaPreviaDelReloj({
  nombre,
  rampa,
  tinta,
  apagada,
}: {
  nombre: string;
  rampa: { p50: string; p500: string; p600: string; tintaSobreAcento: string };
  tinta: string;
  apagada: string;
}) {
  const estilos = useEstilos();
  const { t } = useTranslation();
  return (
    <Stack gap={spacing.xs}>
      <AppText variant="label" tone="subtle">
        {t('settings.brandPreview')}
      </AppText>
      <View
        style={[estilos.previa, { backgroundColor: rampa.p50 }]}
        testID="brand-preview"
        accessibilityLabel={t('settings.brandPreviewA11y')}
      >
        <AppText variant="bodyStrong" style={{ color: rampa.p600 }} numberOfLines={1}>
          {nombre}
        </AppText>
        <AppText variant="section" style={{ color: tinta }}>
          08:30
        </AppText>
        <AppText variant="help" style={{ color: apagada }}>
          {t('kiosk.enterPin')}
        </AppText>
        <Row gap={spacing.xs}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[estilos.punto, { borderColor: rampa.p600 }]} />
          ))}
        </Row>
        <View style={[estilos.boton, { backgroundColor: rampa.p500 }]}>
          <AppText variant="label" style={{ color: rampa.tintaSobreAcento }}>
            {t('attendance.clockIn')}
          </AppText>
        </View>
      </View>
    </Stack>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  sugeridos: { flexWrap: 'wrap' },
  /* 44 px de lado: es lo que se pulsa con el dedo, y el ancho no compensa el alto. */
  sugerido: {
    width: sizes.touchTargetMin,
    height: sizes.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
  },
  muestra: { width: 28, height: 28, borderRadius: radii.pill },
  /* El elegido lleva un aro, no solo más saturación: el color ya está ocupado diciendo cuál es. */
  elegido: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.ink900,
  },
  previa: {
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  punto: { width: 14, height: 14, borderRadius: radii.pill, borderWidth: 2 },
  boton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    marginTop: spacing.xs,
  },
}));
