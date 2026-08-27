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
  photoLibrary:
    'Krealo Shift no necesita tu galería para fichar. Este permiso solo se usa si decides adjuntar una imagen a una solicitud.',
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
  userInterfaceStyle: 'light',
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
    // Expo Web es superficie de desarrollo para trabajar desde Windows, no producción.
    output: 'static',
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
