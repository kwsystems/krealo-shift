import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Identidad inicial editable (especificación §29).
 *
 * El bundle identifier NO está verificado como disponible en App Store Connect.
 * Antes de registrar la app, cambiar `IOS_BUNDLE_IDENTIFIER` aquí — es el único
 * lugar donde vive — y documentarlo en el README.
 */
const APP_NAME = 'Krealo Shift';
const APP_SLUG = 'krealo-shift';
const APP_SCHEME = 'krealoshift';
const IOS_BUNDLE_IDENTIFIER = 'com.krealomedia.krealoshift';
const ANDROID_PACKAGE = 'com.krealomedia.krealoshift';

/** Textos de permisos iOS. Se localizan vía `InfoPlist` por idioma en el build nativo. */
const IOS_PERMISSIONS = {
  camera:
    'Krealo Shift usa la cámara solo para tomar una foto opcional al fichar, cuando el administrador de la tienda activa esa función. Puedes fichar sin foto.',
  // El texto decía "si decides adjuntar una imagen a una solicitud", que no era lo
  // que hacía la app: no hay adjuntos en las solicitudes. El único uso real es que
  // un administrador elija el logotipo de la empresa. Un texto de permiso que
  // describe algo que la app no hace es exactamente lo que la revisión de App Store
  // marca, y con razón: es lo único que la persona lee antes de decidir.
  photoLibrary:
    'Krealo Shift no necesita tu galería para fichar. Un administrador puede abrirla para elegir el logotipo de la empresa, que se muestra en la pantalla del reloj.',
} as const;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: APP_SLUG,
  version: '1.0.0',
  scheme: APP_SCHEME,
  // El kiosco prioriza vertical en un iPad sobre pedestal, pero horizontal no debe romperse.
  orientation: 'default',
  icon: './assets/images/icon.png',
  /*
   * `automatic` deja que el sistema diga si es claro u oscuro; con `'light'` la app
   * estaba clavada en claro y `useColorScheme()` devolvía siempre lo mismo, así que la
   * opción «Automático» del selector de tema no habría hecho nada.
   */
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],

  ios: {
    supportsTablet: true,
    bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
    // El build number lo administra EAS (`autoIncrement` en el perfil production).
    requireFullScreen: false,
    infoPlist: {
      NSCameraUsageDescription: IOS_PERMISSIONS.camera,
      NSPhotoLibraryUsageDescription: IOS_PERMISSIONS.photoLibrary,
      // El reloj del kiosco debe permanecer visible mientras el iPad está en la tienda.
      UIRequiresPersistentWiFi: true,
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
      ],
    },
  },

  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: '#F5F2FF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Android no es objetivo público en P0/P1 (§26 P2), pero mantener el proyecto único.
    predictiveBackGestureEnabled: false,
  },

  web: {
    // DESDE EL 2026-09-14 LA WEB ES LA SUPERFICIE PRINCIPAL, no una vista previa.
    // Se publica en Firebase Hosting (decisión de Andree; ver `firebase.json` y la
    // sección del README). El texto de abajo se escribió cuando web era solo una
    // herramienta para trabajar desde Windows, y esa parte ya no es cierta; lo que
    // sigue siendo cierto, y por eso se conserva, es POR QUÉ `single` y no `static`.
    //
    // `single` Y NO `static`, y el motivo es concreto: con `output: 'static'` el
    // servidor de desarrollo NO ARRANCA. Devuelve 500 con
    // "Worker chunk not found for: expo-sqlite/web/worker.ts", porque en modo
    // estático Metro no sirve el chunk del worker de SQLite en desarrollo. O sea que
    // `npx expo start --web` estaba roto, que es justamente lo único para lo que
    // existe la superficie web (§33: la previsualización debe permitir recorrer
    // todas las pantallas).
    //
    // El empaquetado `expo export` sí funcionaba en modo estático, así que el fallo
    // no se veía en CI ni en el chequeo de render: solo al abrir el servidor de
    // desarrollo, que es lo que usa una persona en Windows.
    //
    // Lo que se pierde con `single` es el prerenderizado por ruta, que sirve para
    // SEO. Aquí no importa: esto es un panel detrás de un inicio de sesión, no un
    // sitio que deba aparecer en buscadores.
    //
    // Y tiene una consecuencia OPERATIVA que no es opcional: como solo existe
    // `index.html`, cualquier ruta que no sea la raíz —/team, /schedule— vive solo
    // en el router. El alojamiento TIENE que reenviar todo a `index.html` o recargar
    // la página en cualquier ruta interna da 404. Eso es lo que hace la regla de
    // `rewrites` en `firebase.json`.
    output: 'single',
    favicon: './assets/images/favicon.png',
    bundler: 'metro',
  },

  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-sqlite',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F5F2FF',
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
      },
    ],
    [
      // El plugin declara el permiso de galería en el build nativo. Sin él,
      // `requestMediaLibraryPermissionsAsync` falla en el iPad con un error que no
      // dice que falta una entrada en Info.plist.
      'expo-image-picker',
      {
        photosPermission: IOS_PERMISSIONS.photoLibrary,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: IOS_PERMISSIONS.camera,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#7157E8',
      },
    ],
    [
      'expo-build-properties',
      {
        // 16.4 es el mínimo que exige Expo SDK 57; la especificación pide
        // "iOS 16 o la versión estable que exijan las dependencias" (§29).
        ios: { deploymentTarget: '16.4' },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    eas: {
      // Lo rellena `eas build:configure` con el projectId real de la cuenta del propietario.
      projectId: process.env.EAS_PROJECT_ID ?? undefined,
    },
  },
});
