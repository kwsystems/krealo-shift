import { z } from 'zod';

/**
 * Validación de variables de entorno (especificación §30).
 *
 * En cliente solo viven `SUPABASE_URL` y `SUPABASE_ANON_KEY`, que son públicas.
 * La `service_role` NUNCA se expone aquí: vive únicamente en el entorno servidor
 * y en los secretos de las Edge Functions.
 *
 * En desarrollo mostramos un error claro con las claves que faltan; en producción
 * no revelamos valores.
 */

const envSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.enum(['development', 'preview', 'production']).default('development'),
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional().default(''),
  EXPO_PUBLIC_SUPPORT_EMAIL: z.string().email().optional().default('soporte@krealomedia.com'),
  EXPO_PUBLIC_PRIVACY_URL: z.string().url().optional().default('https://krealomedia.com/privacidad'),
});

export type Env = z.infer<typeof envSchema>;

const raw = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL,
};

const parsed = envSchema.safeParse(raw);

/** Claves obligatorias que faltan. Vacío significa configuración completa. */
export const missingEnvKeys: string[] = parsed.success
  ? []
  : parsed.error.issues
      .filter((issue) => issue.code === 'invalid_type' || issue.code === 'too_small')
      .map((issue) => String(issue.path[0] ?? ''))
      .filter((key, index, all) => key !== '' && all.indexOf(key) === index);

export const isEnvConfigured = parsed.success;

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
      EXPO_PUBLIC_SUPABASE_URL: raw.EXPO_PUBLIC_SUPABASE_URL ?? '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: raw.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      EXPO_PUBLIC_SENTRY_DSN: raw.EXPO_PUBLIC_SENTRY_DSN ?? '',
      EXPO_PUBLIC_SUPPORT_EMAIL: raw.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'soporte@krealomedia.com',
      EXPO_PUBLIC_PRIVACY_URL: raw.EXPO_PUBLIC_PRIVACY_URL ?? 'https://krealomedia.com/privacidad',
    };

export const isProduction = env.EXPO_PUBLIC_APP_ENV === 'production';
