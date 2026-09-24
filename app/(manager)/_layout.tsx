import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { BarraDeAlcance } from '@/components/layout/barra-de-alcance';
import { ProveedorDeMarca } from '@/theme/marca-de-empresa';
import { AdminErrorState } from '@/components/schedule/data-states';
import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { useBootResolution } from '@/features/boot/use-boot-resolution';
import { ManagerScopeProvider, useManagerScope } from '@/hooks/use-manager-scope';
import { useResponsive } from '@/hooks/use-responsive';
import { borderWidth, fontFamily, fontSize, SIDEBAR_WIDTH, sizes, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/**
 * Navegación de propietario, gerente y administrador (§6.3).
 *
 * Seis pestañas: Inicio, Equipo, Horario, Horas, Reportes y Más. Horario es una
 * pestaña principal, no una pantalla escondida, porque cambiar los turnos cada semana
 * es la tarea central del administrador (§6.3, §11.3).
 *
 * REPORTES TAMBIÉN VA AQUÍ Y NO DENTRO DE «MÁS». Lo pidió Andree como importantísimo,
 * y lo que vive dentro de «Más» se abre el primer día y no se vuelve a abrir: un
 * tablero que hay que ir a buscar no se mira. La sexta pestaña aprieta la barra en un
 * teléfono estrecho, y por eso `scripts/reportes-check.mjs` mide las seis etiquetas a
 * 390 px y falla si alguna se corta; medirlo era la condición para añadirla.
 *
 * En iPad con ancho suficiente la barra inferior se convierte en un SIDEBAR
 * lateral con etiqueta al lado del icono, en lugar de estirar una interfaz de
 * teléfono de lado a lado (§6.3, §33). La decisión la toma
 * `useResponsive().useSidebar`, que responde al ancho disponible: al rotar el
 * iPad, la navegación cambia sola.
 *
 * El provider de contexto envuelve las cinco pestañas para que compartan la
 * organización, el rol y la ubicación elegida sin volver a consultarlos.
 *
 * GUARDA DE SESIÓN Y DE ROL
 * `(manager)` es un grupo, así que sus rutas viven en la raíz: `/team`,
 * `/schedule`, `/hours`, `/requests`, `/settings`. Eso significa que se alcanzan por enlace
 * profundo o escribiendo la URL en Expo Web SIN pasar por la redirección de
 * `app/index.tsx`. Sin esta guarda, el panel administrativo quedaba accesible sin
 * sesión.
 *
 * No sustituye a RLS —el servidor sigue siendo la autoridad y no devolvería
 * datos— pero enseñar el armazón del panel a quien no inició sesión es una fuga de
 * estructura y una pantalla confusa. La guarda va en el layout y no en cada
 * pantalla porque el layout es el único punto por el que pasan todas.
 *
 * La guarda NO reimplementa la resolución: usa la misma
 * `resolveBootDestination` que `app/index.tsx`. La tenía copiada, y las dos copias
 * se contestaban distinto a partir del tercer paso. Compartiéndola, además, es
 * imposible que las dos rutas se redirijan la una a la otra en bucle.
 */
export default function ManagerLayout() {
  const { t } = useTranslation();
  const { destination, retry } = useBootResolution();

  switch (destination.kind) {
    // Mientras no se sabe, no se muestra nada: ni el panel ni el acceso. Mandar a
    // iniciar sesión a quien SÍ la tiene sería peor que esperar un instante.
    case 'resolving':
      return (
        <AppScreen tone="kiosk">
          <LoadingState label={t('boot.resolvingSession')} />
        </AppScreen>
      );
    // Un iPad en modo kiosco no abre el panel: el reloj compartido manda (§6.1).
    case 'kiosk':
      return <Redirect href="/kiosk" />;
    case 'signIn':
      return <Redirect href="/(auth)/sign-in" />;
    // La membresía no se pudo leer: se explica y se ofrece reintentar, en vez de
    // dejar el panel cargando para siempre (§20).
    case 'membershipError':
      return (
        <AppScreen tone="canvas">
          <AdminErrorState error={destination.error} onRetry={retry} />
        </AppScreen>
      );
    // Sesión válida sin rol administrativo: no es el sitio de esa persona. La
    // explicación la pinta la ruta raíz, en un solo sitio.
    case 'noAdminRole':
      return <Redirect href="/" />;
    case 'adminPanel':
      break;
  }

  return (
    <ManagerScopeProvider>
      <MarcaDeLaEmpresa>
        <PanelConMarca />
      </MarcaDeLaEmpresa>
    </ManagerScopeProvider>
  );
}

/**
 * El panel entero, pintado YA con el color de la empresa.
 *
 * ESTÁ APARTE POR UNA RAZÓN MEDIDA, no por orden. La barra de pestañas recibe su color de
 * acento con `tabBarActiveTintColor: colors.primary600`, y `colors` sale de `useTheme()`.
 * Mientras esa llamada vivía en el MISMO componente que monta `ProveedorDeMarca`, leía el
 * contexto de más arriba —o sea vacío— y devolvía el violeta de fábrica: la cabecera salía
 * del color de la empresa y la barra lateral seguía violeta. Media pantalla de un color y
 * media de otro.
 *
 * Y no se vio en la captura, se vio MIDIENDO: en la imagen la pestaña activa parecía haber
 * cambiado, y el color calculado decía `rgb(91, 63, 214)`, el violeta exacto de siempre.
 * Es el mismo error que yo acababa de escribir en el comentario de `MarcaDeLaEmpresa` y
 * cometí dos funciones más abajo.
 */
function PanelConMarca() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { useSidebar } = useResponsive();

  return (
    <>
      {/*
        La cabecera va DENTRO del provider porque lee la organización y la sede, y
        FUERA del Tabs porque debe cruzar toda la ventana, barra lateral incluida: una
        cabecera que empieza donde acaba la navegación no es una cabecera de app. En
        pantallas estrechas se queda sin la marca pero SI con el alcance (ver BarraDeAlcance).
      */}
      <BarraDeAlcance />
      <Tabs
        screenOptions={{
          headerShown: false,
          /*
           * El fondo de la escena, del tema.
           *
           * React Navigation trae su PROPIO tema y pinta un `rgb(242,242,242)` de
           * fábrica en sus contenedores. Ese color no aparece en ningún archivo del
           * proyecto: lo encontró el arnés midiendo el fondo real en el navegador.
           *
           * HOY NO SE VE —medido: cero píxeles de ese gris en la captura, con esta
           * línea y sin ella—, porque el contenido del Stack lo cubre entero. Se pone
           * igualmente porque el fondo de la escena DEBE salir del tema, y depender de
           * que otra capa siempre lo tape es depender de algo que nadie prometió. Lo que
           * no se puede es afirmar que arregla un fallo visible, porque no lo hace.
           */
          sceneStyle: { backgroundColor: colors.canvas },
          tabBarActiveTintColor: colors.primary600,
          tabBarInactiveTintColor: colors.ink500,
          // Sidebar en iPad ancho, barra inferior en teléfono.
          tabBarPosition: useSidebar ? 'left' : 'bottom',
          // La variante `material` es la que sabe dibujarse en vertical con
          // etiqueta al lado del icono; `uikit` es la barra inferior de iOS.
          tabBarVariant: useSidebar ? 'material' : 'uikit',
          tabBarLabelPosition: useSidebar ? 'beside-icon' : 'below-icon',
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderRightColor: colors.border,
            borderRightWidth: useSidebar ? borderWidth.hairline : 0,
            minHeight: sizes.touchTargetPreferred,
            paddingTop: useSidebar ? spacing.base : 0,
            /*
             * Sin esto la barra lateral se queda en los 360 px que le tocan por
             * omisión —ancho de teléfono— y en un monitor se come casi una quinta
             * parte de la ventana para cinco palabras.
             *
             * VAN LOS DOS, y `minWidth` es el que de verdad manda: react-navigation
             * calcula un ancho mínimo por omisión con `getDefaultSidebarWidth` y lo
             * aplica como `minWidth`, así que poner solo `width` no cambiaba NADA —un
             * `min-width` mayor gana siempre—. Se vio midiendo el DOM, no leyendo el
             * código: la barra seguía en 360 con el `width` puesto.
             */
            ...(useSidebar ? { width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH } : null),
          },
          tabBarItemStyle: {
            minHeight: sizes.touchTargetPreferred,
            justifyContent: 'center',
            /*
             * En vertical, cada pestaña se queda con el alto que necesita en vez de
             * repartirse la columna entera: si no, siete pestañas ocupan toda la
             * altura de un monitor y quedan separadas por huecos enormes.
             *
             * ES `flexGrow: 0` Y NO `flex: 0`, y la diferencia son 22 píxeles de
             * objetivo táctil. De todo este estilo, `BottomTabItem` reenvía UNA SOLA
             * propiedad al elemento pulsable —`const { flex } = StyleSheet.flatten(style)`—
             * y el resto se queda en un `View` que lo envuelve. Así que `flex: 0`, que
             * en React Native significa «no crecer, encogible, BASE CERO», llegaba al
             * enlace y lo dejaba con altura de contenido cero: 30 px, solo su relleno.
             *
             * Y no se veía. El envoltorio sí medía sus 52 px y centraba, el icono y la
             * etiqueta desbordaban a la vista, así que la pestaña PARECÍA de 52 px
             * mientras el área que recibe el dedo era de 30. En un iPad, con los siete
             * destinos pegados uno debajo de otro, eso es entrar en «Horas» cuando se
             * quería «Horario». Medido con `responsive:check`, no mirando.
             *
             * `flexGrow: 0` expresa la misma intención —no crecer— sin viajar al
             * pulsable, que recupera su altura natural: 24 de icono más 30 de relleno.
             */
            ...(useSidebar ? { flexGrow: 0, marginBottom: spacing.xs } : null),
          },
          tabBarLabelStyle: {
            fontFamily: fontFamily.medium,
            /*
             * LA ETIQUETA ENCOGE EN LA BARRA INFERIOR, y es por aritmética, no por
             * gusto. Al partir «Más» en Solicitudes y Configuración son SIETE
             * destinos: en un teléfono de 375 px tocan a 53 px cada uno, y con el
             * tamaño de etiqueta normal se truncaban tres —«Repo…», «Solici…»,
             * «Confi…»—. Una etiqueta cortada es peor que ninguna: obliga a abrir
             * para saber qué hay dentro, que es justo lo que se quería quitar
             * al deshacerse de «Más».
             *
             * En la barra lateral no aplica: ahí sobra ancho y encoger solo haría
             * el texto más difícil de leer.
             */
            fontSize: useSidebar ? fontSize.label : 10,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('admin.tabHome'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="home-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="team"
          options={{
            title: t('admin.tabTeam'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="people-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: t('admin.tabSchedule'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="calendar-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="hours"
          options={{
            title: t('admin.tabHours'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="time-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: t('admin.tabReports'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="bar-chart-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        {/*
          «MÁS» SE PARTIÓ EN DOS, y no es solo renombrar.
          Un destino llamado «Más» no dice qué hay dentro: para responder una
          solicitud había que abrir un cajón y, una vez dentro, elegir en un
          segmentado entre dos secciones. Dos clics y una adivinanza para llegar a una
          bandeja con cosas que esperan respuesta.
          Ahora son dos destinos con su nombre y su icono, y desde la barra se ve
          dónde está cada cosa sin entrar a mirar.
        */}
        <Tabs.Screen
          name="requests"
          options={{
            /*
             * ETIQUETA CORTA EN LA BARRA, título largo en la página.
             * «Solicitudes» y «Configuración» no caben en 53 px y se cortaban a
             * «Solicit…» y «Config…». Una etiqueta cortada obliga a abrir para saber
             * qué hay dentro, que es exactamente lo que se quería quitar al
             * deshacerse de «Más». «Bandeja» es además como la llama la propia
             * pantalla cuando está vacía.
             */
            title: t('admin.tabRequests'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="file-tray-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('admin.tabSettings'),
            tabBarIcon: ({ color }) => (
              <Ionicons name="settings-outline" size={sizes.iconMobile} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}

/**
 * Pone el color de la empresa a disposición de todo el panel.
 *
 * ES UN COMPONENTE APARTE y no dos líneas en el layout porque el color vive DENTRO del
 * alcance: `useManagerScope` solo devuelve algo por debajo de su proveedor, y el layout
 * es quien lo monta. Intentar leerlo en el mismo componente que lo provee devuelve el
 * contexto vacío, que es un fallo silencioso —color de fábrica, ningún error— y por tanto
 * de los peores.
 */
function MarcaDeLaEmpresa({ children }: { children: React.ReactNode }) {
  const { organization } = useManagerScope();
  return <ProveedorDeMarca color={organization?.brand_color ?? null}>{children}</ProveedorDeMarca>;
}
