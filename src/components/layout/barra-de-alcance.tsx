import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/ui/app-text';
import { SecondaryButton } from '@/components/ui/buttons';
import { Row, Stack, useRespuestaAlPuntero } from '@/components/ui/layout';
import { AdminSheet } from '@/components/schedule/fields';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { estilosDelTema } from '@/theme/estilos';
import { borderWidth, fontFamily, fontSize, radii, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * LA BARRA DE ALCANCE: qué empresa y qué sede estás mirando, y cómo cambiarlas.
 *
 * ANTES ERA TEXTO MUERTO. Enseñaba «Krealo Shift · Café Demostración · Sede Principal» y
 * no se podía pulsar nada. El único sitio donde se cambiaba de empresa o de sede —y el
 * único donde se creaban— era Ajustes, DENTRO de tarjetas plegables que arrancan cerradas:
 * había que saber que existían para encontrarlas. Lo dijo Andree: «es bien difícil
 * buscarlo para una persona que no conoce la app».
 *
 * AHORA SE PULSA, Y TAMBIÉN EN EL TELÉFONO. La versión anterior devolvía `null` por debajo
 * de la barra lateral, con el argumento de que en un teléfono el alto es el recurso escaso
 * y cada pantalla ya trae su título. El argumento sigue siendo cierto para la MARCA —el
 * icono de la app ya dice qué aplicación es— y es falso para el alcance: el título de la
 * pantalla dice «Equipo», no de qué negocio ni de qué tienda es ese equipo. En un teléfono
 * que además va a llevar dos empresas, no saberlo es peor que perder 44 px.
 *
 * NO DUPLICA LOS FORMULARIOS DE ALTA. «Dar de alta otra empresa» y «Abrir una sede nueva»
 * llevan a Ajustes con la tarjeta correcta YA ABIERTA, en vez de repetir aquí un
 * formulario que ya existe allí. Dos caminos para lo mismo es lo que este proyecto lleva
 * la semana quitando, y el problema que hay que resolver no era que el formulario
 * estuviera mal: era que no se encontraba.
 */
export function BarraDeAlcance() {
  const estilos = useEstilos();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { useSidebar } = useResponsive();
  const { organization, location } = useManagerScope();
  const [abierto, setAbierto] = useState(false);
  const respuesta = useRespuestaAlPuntero();

  // Sin organización no hay nada que decir, y menos aún que cambiar.
  if (organization === null) return null;

  const resumen = location === null ? organization.name : `${organization.name} · ${location.name}`;

  return (
    <>
      <View style={estilos.barra} testID="desktop-header">
        {/*
          LA MARCA SOLO EN PANTALLA ANCHA. En un teléfono el icono de la app y el cambiador
          de tareas ya dicen qué aplicación es; repetirlo aquí gastaría en identidad un
          ancho que hace falta para el dato que sí cambia.
        */}
        {useSidebar ? <AppText style={estilos.marca}>{t('app.name')}</AppText> : null}

        <Pressable
          onPress={() => setAbierto(true)}
          accessibilityRole="button"
          accessibilityLabel={`${resumen}. ${t('scope.open')}`}
          accessibilityHint={t('scope.openHint')}
          testID="scope-open"
          {...respuesta.props}
        >
          {({ pressed }) => (
            <View style={[estilos.contexto, ...respuesta.estilo(pressed)]}>
              <AppText style={estilos.organizacion} numberOfLines={1}>
                {organization.name}
              </AppText>
              {location === null ? null : (
                <>
                  <AppText style={estilos.separador}>·</AppText>
                  <AppText style={estilos.sede} numberOfLines={1}>
                    {location.name}
                  </AppText>
                </>
              )}
              {/*
                LA PUNTA DE FLECHA ES LO QUE DICE QUE ESTO SE PULSA, y en un teléfono es lo
                ÚNICO que lo dice: allí no hay puntero que pueda revelarlo al pasar por
                encima. Por eso no es decoración y no se quita en compacto.
              */}
              <Ionicons name="chevron-down" size={16} color={colors.ink500} />
            </View>
          )}
        </Pressable>
      </View>

      <SelectorDeAlcance visible={abierto} onClose={() => setAbierto(false)} />
    </>
  );
}

/**
 * La hoja que elige empresa y sede, y que lleva a crear una nueva.
 *
 * ES UNA SOLA HOJA CON LAS DOS COSAS y no dos menús separados: la pregunta que se hace
 * quien la abre es «¿dónde estoy?», y empresa y sede son la respuesta completa. Con dos
 * menús, cambiar de empresa y luego de sede serían dos viajes para una sola decisión.
 *
 * SE REUTILIZA `AdminSheet` en vez de inventar un desplegable: ya resuelve el caso
 * responsive —centrada en pantalla ancha, subiendo desde abajo en un teléfono—, el cierre
 * al tocar fuera y el botón de cerrar. Un menú flotante propio habría que volver a
 * enseñarle todo eso, y en un teléfono un desplegable anclado a la cabecera se sale.
 */
function SelectorDeAlcance({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { organization, organizations, setOrganizationId, locations, location, setLocationId } =
    useManagerScope();

  const irAAjustes = (abrir: 'empresa' | 'sede') => {
    onClose();
    router.push({ pathname: '/(manager)/settings', params: { abrir } });
  };

  return (
    <AdminSheet visible={visible} title={t('scope.title')} onClose={onClose} testID="scope-sheet">
      <Stack gap={spacing.lg}>
        {/*
          CON UNA SOLA EMPRESA NO SE PINTA LA LISTA, igual que el selector de Ajustes: una
          lista de un elemento sugiere que hay algo que elegir donde no lo hay. Lo que SÍ
          se pinta siempre es el botón de dar de alta otra, que es a lo que se viene.
        */}
        {organizations.length > 1 ? (
          <Stack gap={spacing.sm}>
            <AppText variant="label" tone="subtle">
              {t('scope.companies')}
            </AppText>
            {organizations.map((empresa) => (
              <OpcionDeAlcance
                key={empresa.id}
                nombre={empresa.name}
                elegida={empresa.id === organization?.id}
                onPress={() => {
                  setOrganizationId(empresa.id);
                  onClose();
                }}
                testID={`scope-org-${empresa.id}`}
              />
            ))}
          </Stack>
        ) : null}

        {locations.length > 1 ? (
          <Stack gap={spacing.sm}>
            <AppText variant="label" tone="subtle">
              {t('scope.locations')}
            </AppText>
            {locations.map((sede) => (
              <OpcionDeAlcance
                key={sede.id}
                nombre={sede.name}
                elegida={sede.id === location?.id}
                onPress={() => {
                  setLocationId(sede.id);
                  onClose();
                }}
                testID={`scope-loc-${sede.id}`}
              />
            ))}
          </Stack>
        ) : null}

        <Stack gap={spacing.sm}>
          <SecondaryButton
            label={t('settings.addOrganization')}
            onPress={() => irAAjustes('empresa')}
            testID="scope-nueva-empresa"
          />
          <SecondaryButton
            label={t('settings.addLocation')}
            onPress={() => irAAjustes('sede')}
            testID="scope-nueva-sede"
          />
          <AppText variant="help" tone="subtle">
            {t('scope.createHint')}
          </AppText>
        </Stack>
      </Stack>
    </AdminSheet>
  );
}

/** Una fila elegible de la hoja. La marca de la actual va con icono y con texto. */
function OpcionDeAlcance({
  nombre,
  elegida,
  onPress,
  testID,
}: {
  nombre: string;
  elegida: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const estilos = useEstilos();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const respuesta = useRespuestaAlPuntero();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /* El estado va en el nombre accesible: el icono solo no lo oye nadie. */
      accessibilityLabel={elegida ? `${nombre}. ${t('scope.current')}` : nombre}
      accessibilityState={{ selected: elegida }}
      testID={testID}
      {...respuesta.props}
    >
      {({ pressed }) => (
        <View
          style={[
            estilos.opcion,
            elegida ? estilos.opcionElegida : null,
            ...respuesta.estilo(pressed),
          ]}
        >
          <Row gap={spacing.sm} align="center">
            <Ionicons
              name={elegida ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={elegida ? colors.primary600 : colors.ink500}
            />
            <AppText variant={elegida ? 'bodyStrong' : 'body'}>{nombre}</AppText>
          </Row>
        </View>
      )}
    </Pressable>
  );
}

const useEstilos = estilosDelTema((colors) => ({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: borderWidth.hairline,
  },
  marca: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.body,
    color: colors.primary600,
  },
  /*
   * ALTO MÍNIMO TÁCTIL. Es lo único que se pulsa en esta barra y en un teléfono se pulsa
   * con el dedo: `responsive:check` exige 44 px en las DOS dimensiones, y el ancho no
   * compensa el alto.
   */
  contexto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTargetMin,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
    flexShrink: 1,
  },
  organizacion: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.label,
    color: colors.ink700,
    flexShrink: 1,
  },
  separador: { color: colors.ink500, fontSize: fontSize.label },
  sede: { fontSize: fontSize.label, color: colors.ink500, flexShrink: 1 },
  opcion: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input,
    minHeight: sizes.touchTargetMin,
    justifyContent: 'center',
  },
  opcionElegida: { backgroundColor: colors.primary50 },
}));
