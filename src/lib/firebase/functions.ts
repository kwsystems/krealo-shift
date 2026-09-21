import { httpsCallable, type HttpsCallableResult } from 'firebase/functions';

import { getDemoClient } from '@/lib/demo/client';
import { isDemoMode } from '@/lib/demo/config';

import { getFirebaseFunctions } from './client';

/**
 * Puente a las Cloud Functions. Sustituye a `db.rpc(...)` y a
 * `db.functions.invoke(...)` de Supabase.
 *
 * TODO LO QUE ANTES ERA `security definer` VIVE AQUI DETRAS, y eso no es un detalle
 * de implementacion: es el modelo de seguridad entero. En Postgres, una funcion
 * `security definer` se ejecutaba con permisos que quien la llamaba no tenia, y por
 * eso podia escribir en `time_events` cuando ninguna sesion podia. El equivalente
 * exacto en Firebase es una Cloud Function con el Admin SDK, que se salta las reglas
 * de Firestore por diseno. Bajar cualquiera de estas operaciones al cliente no seria
 * «simplificar»: seria quitar la unica pared que hay.
 */

export type CallableError = { code: string; message: string };

/**
 * Llama una funcion y devuelve `{data, error}`, la misma forma que usaba el panel.
 *
 * No lanza: quien llama ya sabe tratar el par, y hacerlo lanzar aqui obligaria a
 * envolver en try/catch los 14 `api.ts` que hoy no lo hacen.
 */
export async function callFunction<T>(
  name: string,
  payload?: unknown,
): Promise<{ data: T | null; error: CallableError | null }> {
  /**
   * EL DESVIO DE LA DEMOSTRACION VA PRIMERO, igual que en el acceso a datos. En ese
   * modo no hay proyecto de Firebase al que llamar, y sin esta linea cada pantalla
   * que use una funcion —quien tiene acceso, las vistas de informes— saldria con
   * «falta configurar la conexion» en la demostracion. Esa pantalla es correcta
   * cuando de verdad falta configuracion, y mentira cuando lo que hay es una
   * demostracion que si tiene datos que ensenar.
   */
  if (isDemoMode) {
    const demo = getDemoClient() as unknown as {
      functions: { invoke: (n: string, o?: { body?: unknown }) => Promise<unknown> };
    };
    try {
      const resultado = (await demo.functions.invoke(name, { body: payload })) as {
        data?: unknown;
        error?: unknown;
      };
      return { data: (resultado?.data ?? null) as T | null, error: null };
    } catch (error) {
      return { data: null, error: { code: 'internal', message: String(error) } };
    }
  }

  const functions = getFirebaseFunctions();
  if (functions === null) {
    return {
      data: null,
      error: { code: 'not-configured', message: 'Falta la configuración de Firebase.' },
    };
  }

  try {
    const result = (await httpsCallable(functions, name)(payload)) as HttpsCallableResult<T>;
    return { data: result.data, error: null };
  } catch (error) {
    const source = error as { code?: unknown; message?: unknown };
    return {
      data: null,
      error: {
        code: typeof source.code === 'string' ? source.code : 'internal',
        message: typeof source.message === 'string' ? source.message : String(error),
      },
    };
  }
}

/**
 * Revoca los refresh tokens de quien llama, en todos sus dispositivos (§8).
 *
 * La funcion NO acepta un identificador de usuario, y esa ausencia es la medida de
 * seguridad: toma el `uid` del token verificado de quien llama. Con un parametro,
 * cualquiera con sesion podria cerrar la de otra persona.
 *
 * No lanza: cerrar sesion en ESTE aparato tiene que funcionar aunque la revocacion
 * remota falle. El fallo peor de los dos es dejar a alguien dentro aqui.
 */
export async function revokeAllSessions(): Promise<void> {
  const { error } = await callFunction<{ ok: boolean }>('revokeAllSessions');
  if (error !== null) {
    console.warn(
      '[krealo-shift] No se pudieron revocar las sesiones de los otros dispositivos. ' +
        'Esta sesión sí se cierra. Motivo: ' +
        error.message,
    );
  }
}
