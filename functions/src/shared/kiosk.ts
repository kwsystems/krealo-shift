import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';

import { COLLECTIONS, db, nowISO } from './admin';

/**
 * Autenticacion del kiosco y token de accion (§8, §16).
 *
 * DOS MECANISMOS DISTINTOS, A PROPOSITO, y siguen siendo dos despues de la
 * migracion:
 *
 *   1. CREDENCIAL DEL DISPOSITIVO — larga vida, ligada al iPad y a UNA ubicacion.
 *      Se valida contra el hash bcrypt de `kiosk_device_secrets`, una coleccion que
 *      las reglas cierran a todo el mundo.
 *
 *   2. TOKEN DE ACCION — vida de 90 segundos, ligado a empleado + kiosco +
 *      ubicacion. Lo emite `verifyPin` y lo consume `submitTimeEvent`. Es lo que
 *      evita que alguien registre un fichaje ajeno conociendo solo la credencial
 *      del iPad.
 *
 * El token es un HMAC firmado, sin estado en la base: uno robado caduca en 90
 * segundos y no hay tabla que limpiar.
 *
 * EL KIOSCO NO TIENE SESION DE FIREBASE y no debe tenerla. Un iPad compartido en el
 * mostrador con una cuenta de Google dentro seria una cuenta que cualquiera puede
 * usar para entrar al panel. Por eso estas funciones son invocables sin
 * autenticacion y se defienden con la credencial del dispositivo.
 */

const ACTION_TOKEN_TTL_SECONDS = 90;

/**
 * El secreto que firma los tokens de accion.
 *
 * VA CON `defineSecret` Y NO COMO CADENA EN `secrets: ['KIOSK_TOKEN_SECRET']`, y la
 * diferencia no es de estilo. Con la cadena suelta el CLI no lo detecta al analizar
 * el modulo, despliega sin enlazar nada al servicio de Cloud Run, y la funcion lee
 * `undefined` en ejecucion. Se desplego asi y el sintoma fue `FAILED_PRECONDITION:
 * KIOSK_TOKEN_SECRET falta o tiene menos de 32 caracteres` en la primera llamada
 * real a `verifyPin` — con el secreto perfectamente creado en Secret Manager.
 *
 * Lo encontro la prueba de extremo a extremo del circuito de fichaje, no el
 * typecheck ni el despliegue: los dos dieron verde.
 */
export const KIOSK_TOKEN_SECRET = defineSecret('KIOSK_TOKEN_SECRET');

export type KioskContext = {
  deviceId: string;
  organizationId: string;
  locationId: string;
  /**
   * `offline_key` de ESTE aparato. Viaja en el contexto porque `authenticateKiosk` ya
   * lee el documento de secretos para comprobar la credencial: quien la necesite
   * despues no tiene que volver a leerlo.
   *
   * Con ella se derivan los verificadores de PIN sin conexion, atados al dispositivo
   * para que copiar el SQLite de un iPad a otro no de un verificador utilizable.
   */
  offlineKey: string;
};

export type KioskAuth = { credential?: unknown; devicePublicId?: unknown };

function tokenSecret(): string {
  const secret = KIOSK_TOKEN_SECRET.value();
  if (secret === undefined || secret.length < 32) {
    throw new HttpsError(
      'failed-precondition',
      'KIOSK_TOKEN_SECRET falta o tiene menos de 32 caracteres.',
    );
  }
  return secret;
}

/**
 * Anota un intento rechazado, para la alerta de §19 «fichaje desde un kiosco
 * revocado o incorrecto».
 *
 * Nunca lanza. Un fallo al anotar el intento no debe cambiar la respuesta que
 * recibe el iPad: la respuesta correcta sigue siendo «este reloj no esta activo».
 */
export async function recordKioskRejection(params: {
  devicePublicId: string;
  reason: 'revoked' | 'wrong_location';
  organizationId?: string;
  locationId?: string;
  deviceId?: string;
  employeeId?: string | null;
}): Promise<void> {
  try {
    if (params.organizationId === undefined || params.deviceId === undefined) return;
    await db.collection(COLLECTIONS.kioskRejectedAttempts).add({
      organization_id: params.organizationId,
      location_id: params.locationId ?? null,
      device_id: params.deviceId,
      reason: params.reason,
      employee_id: params.employeeId ?? null,
      occurred_at: nowISO(),
    });
  } catch (error) {
    console.error('[krealo-shift] no se pudo anotar el rechazo del kiosco:', error);
  }
}

/**
 * Valida la credencial del dispositivo. Lanza si falta, no coincide o el kiosco
 * esta revocado.
 *
 * Este es el punto por el que pasan TODAS las peticiones del kiosco, asi que anotar
 * el rechazo aqui cubre las siete funciones de una vez: un iPad revocado que sigue
 * encendido queda registrado sin importar que endpoint intente.
 */
export async function authenticateKiosk(payload: unknown): Promise<KioskContext> {
  const auth = (payload as { kioskAuth?: KioskAuth } | null)?.kioskAuth;
  const credential = typeof auth?.credential === 'string' ? auth.credential : null;
  const publicId = typeof auth?.devicePublicId === 'string' ? auth.devicePublicId : null;

  if (credential === null || publicId === null) {
    throw new HttpsError('unauthenticated', 'Este dispositivo no está activado como reloj.');
  }

  const found = await db
    .collection(COLLECTIONS.kioskDevices)
    .where('device_public_id', '==', publicId)
    .limit(1)
    .get();

  const deviceDoc = found.docs[0];
  if (deviceDoc === undefined) {
    throw new HttpsError('unauthenticated', 'Este reloj no está registrado.');
  }
  const device = deviceDoc.data();

  const secretSnapshot = await db
    .collection(COLLECTIONS.kioskDeviceSecrets)
    .doc(deviceDoc.id)
    .get();
  const hash = secretSnapshot.data()?.credential_hash as string | undefined;

  if (hash === undefined || !bcrypt.compareSync(credential, hash)) {
    throw new HttpsError('unauthenticated', 'La credencial de este reloj no es válida.');
  }

  if (device.status !== 'active') {
    await recordKioskRejection({
      devicePublicId: publicId,
      reason: 'revoked',
      organizationId: device.organization_id as string,
      locationId: device.location_id as string,
      deviceId: deviceDoc.id,
    });
    throw new HttpsError('permission-denied', 'Este reloj fue desactivado.');
  }

  // Señal de vida, para la alerta de «reloj sin sincronizar». Se escribe sin
  // esperar: que el fichaje no dependa de poder anotar la hora del último contacto.
  void deviceDoc.ref.update({ last_seen_at: nowISO() });

  return {
    deviceId: deviceDoc.id,
    organizationId: device.organization_id as string,
    locationId: device.location_id as string,
    offlineKey: (secretSnapshot.data()?.offline_key as string | undefined) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Token de accion
// ---------------------------------------------------------------------------

type ActionTokenPayload = {
  employeeId: string;
  deviceId: string;
  locationId: string;
  exp: number;
};

function base64Url(input: Buffer): string {
  return input.toString('base64url');
}

function hmac(data: string): string {
  return base64Url(createHmac('sha256', tokenSecret()).update(data).digest());
}

export function issueActionToken(params: {
  employeeId: string;
  deviceId: string;
  locationId: string;
}): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + ACTION_TOKEN_TTL_SECONDS;
  const encoded = base64Url(Buffer.from(JSON.stringify({ ...params, exp })));
  return {
    token: `${encoded}.${hmac(encoded)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Verifica el token y devuelve su contenido. Comprueba, en este orden: que la firma
 * sea valida, que no haya caducado y que corresponda al MISMO kiosco que lo pide. Un
 * token emitido en Sede Principal no sirve en Sucursal Demo.
 */
export function verifyActionToken(token: string, context: KioskContext): ActionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (encoded === undefined || signature === undefined) return null;

  // Comparacion en tiempo constante: comparar con `!==` filtra informacion por el
  // tiempo de respuesta.
  const expected = Buffer.from(hmac(encoded));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !nodeTimingSafeEqual(given, expected)) return null;

  let payload: Partial<ActionTokenPayload>;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<ActionTokenPayload>;
  } catch {
    return null;
  }

  if (
    typeof payload.employeeId !== 'string' ||
    typeof payload.deviceId !== 'string' ||
    typeof payload.locationId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.deviceId !== context.deviceId) return null;
  if (payload.locationId !== context.locationId) return null;

  return payload as ActionTokenPayload;
}
