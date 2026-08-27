/**
 * `send-manager-alerts` — envía las notificaciones al gerente (§19).
 *
 * NO LA LLAMA UN KIOSCO, y por eso su autenticación no se parece a la de las
 * demás funciones de esta carpeta. Las otras siete se defienden con la credencial
 * del iPad y un token de acción de 90 segundos; aquí no hay iPad ni persona: la
 * llama un programador cada 15 minutos.
 *
 * CÓMO SE PROTEGE, Y POR QUÉ ASÍ
 * Con un secreto propio, `MANAGER_ALERTS_TOKEN`, en la cabecera `x-alerts-token`,
 * comparado en tiempo constante. Tres decisiones dentro de esa frase:
 *
 *   1. UN SECRETO PROPIO Y NO LA `service_role`. Lo más rápido habría sido exigir
 *      la clave de servicio, que el programador ya necesita para nada más. Pero
 *      esa clave abre la base entera: si la configuración del programador se
 *      filtra, se filtra todo. Con un token dedicado, lo peor que consigue quien
 *      lo robe es hacernos enviar nuestras propias alertas pendientes antes de
 *      tiempo — molesto, no una fuga de datos.
 *
 *   2. SIN SECRETO CONFIGURADO, LA FUNCIÓN NO ATIENDE. Devuelve 500 y no 200: una
 *      función de envío que se queda abierta porque falta una variable de entorno
 *      es peor que una que no funciona, porque nadie lo nota.
 *
 *   3. NO LLEVA CABECERAS CORS y no responde a OPTIONS, a diferencia del resto.
 *      Ningún navegador tiene motivo para llamarla; anunciar `Allow-Origin: *`
 *      sería invitar a intentarlo. Se despliega con `--no-verify-jwt`, porque la
 *      cabecera `Authorization` no lleva un JWT de Supabase.
 *
 * LO QUE HACE
 *   1. `claim_manager_alerts()` reserva y devuelve solo lo no avisado. La
 *      deduplicación está en la base, en una sola sentencia: aquí no se decide
 *      nada sobre qué se repite.
 *   2. Agrupa por destinatario, tipo y tienda, y compone UN texto por grupo, con
 *      cifras y el nombre de la tienda. Nunca un nombre de persona ni una foto
 *      (§9.6, §19); la garantía es mecánica y vive en `_shared/alert-messages.ts`.
 *   3. Envía por la API de Expo Push y marca el resultado. Un token que Expo
 *      declara inexistente (`DeviceNotRegistered`) se desactiva: seguir enviando a
 *      un dispositivo borrado consume cuota y ensucia el registro para siempre.
 */

import { serviceClient } from '../_shared/kiosk-auth.ts';
import {
  composeAlert,
  isManagerAlertType,
  resolveAlertLocale,
  type ManagerAlertType,
} from '../_shared/alert-messages.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo acepta como máximo 100 mensajes por petición. */
const EXPO_BATCH_SIZE = 100;

/**
 * Techo de mensajes por ejecución. No es una optimización: sin él, la primera
 * ejecución sobre una base con historial intentaría vaciarlo entero en una
 * invocación y se quedaría sin tiempo a mitad, marcando unas cosas y otras no. Lo
 * que sobra se queda `queued` y el reintento de `claim_manager_alerts` lo recoge
 * en el pase siguiente.
 */
const MAX_MESSAGES_PER_RUN = 500;

type ClaimedAlert = {
  delivery_id: string;
  alert_type: ManagerAlertType;
  recipient_user_id: string;
  recipient_locale: string;
  organization_id: string;
  location_id: string;
  payload: { locationName?: unknown };
};

type AlertGroup = {
  key: string;
  alertType: ManagerAlertType;
  recipientUserId: string;
  locale: string;
  locationId: string;
  locationName: string;
  deliveryIds: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Valida una fila devuelta por `claim_manager_alerts`. */
function toClaimedAlert(value: unknown): ClaimedAlert | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.delivery_id !== 'string') return null;
  if (!isManagerAlertType(row.alert_type)) return null;
  if (typeof row.recipient_user_id !== 'string') return null;
  if (typeof row.location_id !== 'string') return null;
  if (typeof row.organization_id !== 'string') return null;

  return {
    delivery_id: row.delivery_id,
    alert_type: row.alert_type,
    recipient_user_id: row.recipient_user_id,
    recipient_locale: typeof row.recipient_locale === 'string' ? row.recipient_locale : 'es-PE',
    organization_id: row.organization_id,
    location_id: row.location_id,
    payload:
      typeof row.payload === 'object' && row.payload !== null
        ? (row.payload as { locationName?: unknown })
        : {},
  };
}

/**
 * Una notificación por destinatario, tipo y tienda.
 *
 * La tienda entra en la clave a propósito: un gerente de dos locales recibe dos
 * avisos de tardanza y sabe a cuál ir. Fundirlos en uno ahorraría una
 * notificación y le quitaría justo el dato que necesita para actuar.
 */
function groupAlerts(alerts: ClaimedAlert[]): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();

  for (const alert of alerts) {
    const key = `${alert.recipient_user_id}|${alert.alert_type}|${alert.location_id}`;
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.deliveryIds.push(alert.delivery_id);
      continue;
    }
    groups.set(key, {
      key,
      alertType: alert.alert_type,
      recipientUserId: alert.recipient_user_id,
      locale: alert.recipient_locale,
      locationId: alert.location_id,
      locationName:
        typeof alert.payload.locationName === 'string' ? alert.payload.locationName : '',
      deliveryIds: [alert.delivery_id],
    });
  }

  return [...groups.values()];
}

type ExpoTicket = { status?: unknown; details?: { error?: unknown } | null };

/** Respuesta de Expo, leída a la defensiva: es un servicio ajeno. */
function readTickets(value: unknown, expected: number): ExpoTicket[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expected) return null;
  return data.map((ticket) =>
    typeof ticket === 'object' && ticket !== null ? (ticket as ExpoTicket) : {},
  );
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ code: 'bad_request' }, 405);

  const expected = Deno.env.get('MANAGER_ALERTS_TOKEN');
  if (expected === undefined || expected.length < 32) {
    console.error('[send-manager-alerts] MANAGER_ALERTS_TOKEN falta o es demasiado corto.');
    return json({ code: 'server_error' }, 500);
  }

  const presented = request.headers.get('x-alerts-token') ?? '';
  if (!timingSafeEqual(presented, expected)) {
    return json({ code: 'not_authorized' }, 401);
  }

  const supabase = serviceClient();

  // Permite acotar a una empresa para depurar; el trabajo programado no manda
  // cuerpo y entonces son todas.
  let organizationId: string | null = null;
  try {
    const body = (await request.json()) as { organizationId?: unknown };
    if (typeof body?.organizationId === 'string') organizationId = body.organizationId;
  } catch {
    // Sin cuerpo, o con un cuerpo que no es JSON: son todas las empresas.
  }

  const claim = await supabase.rpc('claim_manager_alerts', {
    p_organization_id: organizationId,
  });

  if (claim.error) {
    console.error('[send-manager-alerts] claim_manager_alerts falló', claim.error.code);
    return json({ code: 'server_error' }, 500);
  }

  const claimed = (Array.isArray(claim.data) ? claim.data : [])
    .map(toClaimedAlert)
    .filter((row): row is ClaimedAlert => row !== null);

  if (claimed.length === 0) {
    return json({ ok: true, claimed: 0, sent: 0, failed: 0 });
  }

  const groups = groupAlerts(claimed);
  const recipientIds = [...new Set(groups.map((group) => group.recipientUserId))];

  const tokensResult = await supabase
    .from('push_tokens')
    .select('user_id, expo_token')
    .in('user_id', recipientIds)
    .eq('is_active', true);

  if (tokensResult.error) {
    console.error('[send-manager-alerts] no se pudieron leer los tokens');
    // Nada se marca: las filas quedan `queued` y el reintento las recoge.
    return json({ code: 'server_error' }, 500);
  }

  const tokensByUser = new Map<string, string[]>();
  for (const row of tokensResult.data ?? []) {
    const userId = typeof row.user_id === 'string' ? row.user_id : null;
    const token = typeof row.expo_token === 'string' ? row.expo_token : null;
    if (userId === null || token === null) continue;
    tokensByUser.set(userId, [...(tokensByUser.get(userId) ?? []), token]);
  }

  type OutgoingMessage = {
    to: string;
    title: string;
    body: string;
    sound: 'default';
    priority: 'normal';
    data: { alertType: ManagerAlertType; locationId: string };
  };

  const messages: OutgoingMessage[] = [];
  /** Índice paralelo a `messages`: a qué grupo pertenece cada mensaje. */
  const owners: { groupKey: string; token: string }[] = [];

  const sentIds: string[] = [];
  /** Grupos sin ningún dispositivo al que enviar. */
  const noTokenIds: string[] = [];
  /** Grupos que Expo rechazó de forma definitiva. */
  const rejectedIds: string[] = [];
  const attemptedGroups = new Map<string, AlertGroup>();

  for (const group of groups) {
    const tokens = tokensByUser.get(group.recipientUserId) ?? [];

    if (tokens.length === 0) {
      // El token se desactivó entre la reserva y el envío. No hay a dónde enviar y
      // reintentar daría lo mismo: se marca fallido en lugar de dejarlo colgado.
      noTokenIds.push(...group.deliveryIds);
      continue;
    }

    if (messages.length + tokens.length > MAX_MESSAGES_PER_RUN) {
      // Se deja `queued` sin tocar: el reintento lo recoge en el pase siguiente.
      continue;
    }

    const { title, body } = composeAlert({
      type: group.alertType,
      locale: resolveAlertLocale(group.locale),
      count: group.deliveryIds.length,
      locationName: group.locationName,
    });

    attemptedGroups.set(group.key, group);

    for (const token of tokens) {
      messages.push({
        to: token,
        title,
        body,
        sound: 'default',
        priority: 'normal',
        // Lo mínimo para abrir la pantalla correcta al tocarla (§19). Ningún
        // identificador de persona: el `data` de una notificación queda guardado
        // en el sistema operativo del teléfono.
        data: { alertType: group.alertType, locationId: group.locationId },
      });
      owners.push({ groupKey: group.key, token });
    }
  }

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  /** Grupos con al menos un envío aceptado. */
  const groupOk = new Set<string>();
  const deadTokens = new Set<string>();
  let transportFailed = false;
  let firstFailure = '';

  for (let start = 0; start < messages.length; start += EXPO_BATCH_SIZE) {
    const batch = messages.slice(start, start + EXPO_BATCH_SIZE);

    let payload: unknown;
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // Solo hace falta si la cuenta de Expo tiene la seguridad reforzada
          // activada. Si no está configurado, no se manda la cabecera.
          ...(accessToken !== undefined ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        transportFailed = true;
        if (firstFailure === '') firstFailure = `expo_http_${response.status}`;
        continue;
      }
      payload = await response.json();
    } catch {
      // Fallo de red: NO se marca nada de este lote. Las filas siguen `queued` y
      // el reintento las recoge. Marcarlas fallidas aquí perdería la alerta.
      transportFailed = true;
      if (firstFailure === '') firstFailure = 'expo_unreachable';
      continue;
    }

    const tickets = readTickets(payload, batch.length);
    if (tickets === null) {
      transportFailed = true;
      if (firstFailure === '') firstFailure = 'expo_bad_response';
      continue;
    }

    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      const owner = owners[start + index];
      if (ticket === undefined || owner === undefined) continue;

      if (ticket.status === 'ok') {
        groupOk.add(owner.groupKey);
        continue;
      }

      const detail = typeof ticket.details?.error === 'string' ? ticket.details.error : 'unknown';
      if (firstFailure === '') firstFailure = detail;
      if (detail === 'DeviceNotRegistered') deadTokens.add(owner.token);
    }
  }

  for (const token of deadTokens) {
    const result = await supabase.rpc('deactivate_push_token', { p_expo_token: token });
    if (result.error) {
      console.error('[send-manager-alerts] no se pudo desactivar un token', result.error.code);
    }
  }

  for (const group of attemptedGroups.values()) {
    if (groupOk.has(group.key)) {
      sentIds.push(...group.deliveryIds);
      continue;
    }
    // Si el fallo fue de transporte no se marca: se deja `queued` para el
    // reintento. Si Expo respondió y rechazó, reintentar da el mismo rechazo.
    if (!transportFailed) rejectedIds.push(...group.deliveryIds);
  }

  if (sentIds.length > 0) {
    const marked = await supabase.rpc('mark_manager_alerts_sent', { p_ids: sentIds });
    if (marked.error) {
      // Grave y hay que verlo en el registro: las notificaciones salieron pero la
      // deduplicación no se enteró, así que el pase siguiente las repetirá.
      console.error('[send-manager-alerts] envío hecho pero sin marcar', marked.error.code);
    }
  }

  // Dos motivos distintos y dos llamadas: `failure_reason` es lo único que queda
  // para diagnosticar después, y escribir "expo_http_500" en un grupo que en
  // realidad no tenía a dónde enviar manda a mirar al sitio equivocado.
  for (const failure of [
    { ids: noTokenIds, reason: 'no_active_token' },
    { ids: rejectedIds, reason: firstFailure === '' ? 'expo_rejected' : firstFailure },
  ]) {
    if (failure.ids.length === 0) continue;
    const marked = await supabase.rpc('mark_manager_alerts_failed', {
      p_ids: failure.ids,
      p_reason: failure.reason,
    });
    if (marked.error) {
      console.error('[send-manager-alerts] no se pudo marcar el fallo', marked.error.code);
    }
  }

  return json({
    ok: true,
    claimed: claimed.length,
    groups: groups.length,
    messages: messages.length,
    sent: sentIds.length,
    failedNoToken: noTokenIds.length,
    failedRejected: rejectedIds.length,
    deactivatedTokens: deadTokens.size,
  });
});
