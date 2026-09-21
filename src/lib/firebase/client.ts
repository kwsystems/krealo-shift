import { Platform } from 'react-native';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import {
  browserLocalPersistence,
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

import { isDemoMode } from '@/lib/demo/config';
import { env, isEnvConfigured } from '@/lib/env';
import { secureStorage } from '@/lib/security/secure-storage';

/**
 * Cliente de Firebase (§4, §22). Sustituye al de Supabase.
 *
 * La configuracion de Firebase ES PUBLICA y eso no es un descuido: `apiKey` no es
 * una credencial, es el identificador del proyecto ante la API. Va dentro del
 * paquete web igual que iba la `anon key`, y lo que protege los datos son las
 * reglas de Firestore y las Cloud Functions, no el secreto de esa cadena.
 *
 * Lo que NO entra aqui, ni entrara: la clave de cuenta de servicio. Vive solo en
 * el entorno de las Cloud Functions, que se autentican solas dentro de Google.
 */

/**
 * LA REGION IMPORTA Y TIENE QUE COINCIDIR. Firestore vive en southamerica-east1 y
 * las funciones tambien. Si se despliega una funcion en us-central1 y el cliente la
 * llama sin decir region —o al reves— el sintoma es un 404 de `functions/not-found`
 * que parece que la funcion no existe, cuando existe y esta a 8.000 km.
 */
export const FUNCTIONS_REGION = 'southamerica-east1';

/**
 * La sesion se guarda en SecureStore, no en almacenamiento normal (§22).
 *
 * Firebase espera la forma de AsyncStorage —`getItem`/`setItem`/`removeItem`— y
 * `secureStorage` habla `get`/`set`/`remove`: esto es solo el traductor. Envolver
 * asi el Keychain es lo que mantiene la promesa de §22 despues de cambiar de
 * backend; con la persistencia por defecto, el token de sesion acabaria en
 * almacenamiento sin cifrar del dispositivo.
 */
const secureStorageAdapter = {
  getItem: (key: string) => secureStorage.get(key),
  setItem: (key: string, value: string) => secureStorage.set(key, value),
  removeItem: (key: string) => secureStorage.remove(key),
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let functionsInstance: Functions | null = null;

function firebaseApp(): FirebaseApp | null {
  /**
   * EN DEMOSTRACION NO SE INICIALIZA NADA. `isEnvConfigured` es `true` en ese modo
   * —a proposito, para que la app no se pare en «falta configuracion»— asi que sin
   * esta linea se llamaria a `initializeApp` con la configuracion vacia y el primer
   * intento de leer daria un error de red contra un proyecto inexistente.
   */
  if (isDemoMode) return null;
  if (!isEnvConfigured) return null;
  if (app !== null) return app;

  app =
    getApps()[0] ??
    initializeApp({
      apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
    });

  return app;
}

/**
 * Devuelve `null` cuando falta configuracion, igual que hacia `getSupabase`: la app
 * muestra entonces una pantalla explicativa en vez de reventar con un error
 * tecnico (§20). Ese contrato es el que hace que ninguna pantalla tenga que saber
 * si hay backend o no.
 */
export function getFirebaseAuth(): Auth | null {
  const instance = firebaseApp();
  if (instance === null) return null;
  if (authInstance !== null) return authInstance;

  if (Platform.OS === 'web') {
    authInstance = getAuth(instance);
    void authInstance.setPersistence(browserLocalPersistence);
    return authInstance;
  }

  /**
   * `getReactNativePersistence` SI existe en el paquete pero NO en sus tipos
   * publicos: vive solo en el bundle de React Native, asi que `firebase/auth` no lo
   * declara. La asercion sobre el namespace importado es lo que permite usarlo sin
   * un `require()`, y no hay alternativa: dejar la persistencia por defecto pierde
   * la sesion en cada reinicio del iPad, que es justo lo que no puede pasar en un
   * reloj de tienda.
   */
  const persistenceFactory = (
    firebaseAuth as unknown as {
      getReactNativePersistence?: (storage: unknown) => Persistence;
    }
  ).getReactNativePersistence;

  authInstance =
    persistenceFactory === undefined
      ? getAuth(instance)
      : initializeAuth(instance, { persistence: persistenceFactory(secureStorageAdapter) });

  return authInstance;
}

export function getDb(): Firestore | null {
  const instance = firebaseApp();
  if (instance === null) return null;
  dbInstance ??= getFirestore(instance);
  return dbInstance;
}

export function getFirebaseStorage(): FirebaseStorage | null {
  const instance = firebaseApp();
  if (instance === null) return null;
  storageInstance ??= getStorage(instance);
  return storageInstance;
}

export function getFirebaseFunctions(): Functions | null {
  const instance = firebaseApp();
  if (instance === null) return null;
  functionsInstance ??= getFunctions(instance, FUNCTIONS_REGION);
  return functionsInstance;
}
