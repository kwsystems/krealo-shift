import { z } from 'zod';

import { isDemoMode } from '@/lib/demo/config';

/**
 * Validación de variables de entorno (especificación §30).
 *
 * En cliente solo vive la configuración de Firebase, que es pública por diseño:
 * `apiKey` no es una credencial sino el identificador del proyecto ante la API, y
 * lo que protege los datos son las reglas de Firestore y las Cloud Functions.
 * La clave de cuenta de servicio NUNCA se expone aquí: las funciones se autentican
 * solas dentro de Google y no necesitan que nadie les pase un secreto.
 *
 * En desarrollo mostramos un error claro con las claves que faltan; en producción
 * no revelamos valores.
 *
 * AQUÍ NO HAY `EXPO_PUBLIC_SENTRY_DSN`, y su ausencia es deliberada. Estaba declarada
 * y validada, y NO LA LEÍA NADIE: no hay SDK de crash reporting en el proyecto. Una
 * variable así es una promesa falsa —alguien pega un DSN, reinicia, y no se reporta
 * nada— y peor aún en la que precisamente sirve para saber que la app se rompió.
 * Elegir el servicio y dar el DSN es de Andree; cuando exista, la variable vuelve junto
 * al SDK que la use, no antes. El motivo largo está en `docs/DECISIONES.md`.
 */

/**
 * Una variable presente pero VACÍA es una variable sin poner.
 *
 * ESTO ROMPÍA EL CAMINO DOCUMENTADO. El README dice —correctamente— «copia
 * `.env.example` a `.env` y pega la URL y la anon key», y `.env.example` trae
 * `EXPO_PUBLIC_SUPPORT_EMAIL=` y `EXPO_PUBLIC_PRIVACY_URL=` en blanco, porque una
 * plantilla no puede traer valores de nadie. Al arrancar, esas dos llegaban como cadena
 * vacía, y `.optional()` NO cubre la cadena vacía: solo cubre `undefined`. Así que
 * `.email()` y `.url()` fallaban y la app decía «Falta configuración del entorno»
 * nombrando dos variables que ni siquiera son obligatorias.
 *
 * Se ve solo si se sigue la instrucción tal cual, con un `.env` recién copiado. Se
 * encontró clonando el repositorio desde cero y haciendo exactamente lo que dice el
 * README, no leyéndolo.
 *
 * Se aplica SOLO a las opcionales: en las obligatorias, una cadena vacía tiene que
 * seguir fallando, y con su nombre en el mensaje. Ese caso está resuelto abajo y tiene
 * su propio comentario.
 */
const vacioEsAusente = (valor: unknown) => (valor === '' ? undefined : valor);

const envSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.preprocess(
    vacioEsAusente,
    z.enum(['development', 'preview', 'production']).default('development'),
  ),
  EXPO_PUBLIC_FIREBASE_API_KEY: z.string().min(20),
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  /**
   * Identificadores de cliente OAuth para entrar con Google en NATIVO.
   *
   * Son opcionales a proposito y no los necesita la web: alli `signInWithPopup` usa
   * el cliente que Firebase crea solo. En iPad hace falta uno propio, y mientras no
   * exista la pantalla lo dice en vez de ofrecer un boton que abriria una ventana
   * con un error de Google.
   */
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: z.preprocess(vacioEsAusente, z.string().optional()),
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: z.preprocess(vacioEsAusente, z.string().optional()),
  EXPO_PUBLIC_SUPPORT_EMAIL: z.preprocess(
    vacioEsAusente,
    z.string().email().optional().default('soporte@krealomedia.com'),
  ),
  EXPO_PUBLIC_PRIVACY_URL: z.preprocess(
    vacioEsAusente,
    z.string().url().optional().default('https://krealomedia.com/privacidad'),
  ),
});

export type Env = z.infer<typeof envSchema>;

const raw = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL,
};

const parsed = envSchema.safeParse(raw);

/**
 * Claves obligatorias que faltan o no valen. Vacío significa configuración completa.
 *
 * SE REPORTAN TODOS LOS PROBLEMAS, no solo dos códigos de error. La versión anterior
 * filtraba por `invalid_type` y `too_small`, y eso dejaba fuera un caso que se da
 * siempre: con `EXPO_PUBLIC_FIREBASE_API_KEY=` vacío, Zod devuelve `too_small`
 * —porque falla el `.min(20)`, no el tipo—, así que la pantalla nombraba unas claves
 * y callaba otras.
 *
 * Alguien pega entonces la clave, vuelve a arrancar y sigue sin funcionar, sin saber
 * por qué. Un mensaje que enumera la mitad de los problemas es peor que uno genérico:
 * hace perder un ciclo entero de prueba y error.
 */
export const missingEnvKeys: string[] = parsed.success
  ? []
  : parsed.error.issues
      .map((issue) => String(issue.path[0] ?? ''))
      .filter((key, index, all) => key !== '' && all.indexOf(key) === index);

/**
 * EN MODO DEMOSTRACIÓN NO HACE FALTA CONFIGURACIÓN, y por eso esto no es `parsed.success`
 * a secas: sin esta línea, la app con `EXPO_PUBLIC_DEMO=1` seguiría parándose en «Falta
 * configuración del entorno», que es exactamente la pared que el modo demostración
 * existe para quitar. No afloja nada fuera de ese modo: con la demostración apagada, las
 * seis claves de Firebase siguen siendo obligatorias y el mensaje sigue nombrándolas.
 */
export const isEnvConfigured = parsed.success || isDemoMode;

/**
 * Valores de entorno. Si la configuración está incompleta, devolvemos strings
 * vacíos en lugar de lanzar: la app debe poder mostrar una pantalla explicativa
 * en vez de un crash blanco. `isEnvConfigured` decide qué se renderiza.
 */
export const env: Env = parsed.success
  ? parsed.data
  : {
      EXPO_PUBLIC_APP_ENV:
        (raw.EXPO_PUBLIC_APP_ENV as Env['EXPO_PUBLIC_APP_ENV'] | undefined) ?? 'development',
      EXPO_PUBLIC_FIREBASE_API_KEY: raw.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: raw.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: raw.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: raw.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: raw.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
      EXPO_PUBLIC_FIREBASE_APP_ID: raw.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: raw.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: raw.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      EXPO_PUBLIC_SUPPORT_EMAIL: raw.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'soporte@krealomedia.com',
      EXPO_PUBLIC_PRIVACY_URL: raw.EXPO_PUBLIC_PRIVACY_URL ?? 'https://krealomedia.com/privacidad',
    };

export const isProduction = env.EXPO_PUBLIC_APP_ENV === 'production';
