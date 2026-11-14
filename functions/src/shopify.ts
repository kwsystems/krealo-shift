import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { audit, membershipOf, requireRole, requireUid } from './shared/caller';
import {
  diaYHora,
  diasEntre,
  sumarPorHora,
  tiendaNormalizada,
  type OrdenMinima,
} from './shared/ordenes-por-hora';
import { instanteLocal, zonaSegura } from './shared/zonas';

/**
 * LAS ÓRDENES DE SHOPIFY, POR HORA (13-nov). Andree: «ver en qué horarios cada día hay más
 * órdenes y luego hacer un análisis total». Es lo que hace Homebase con el punto de venta:
 * las ventas de cada hora al lado del personal que había en turno.
 *
 * SOLO SE GUARDAN TOTALES POR HORA: cuántas órdenes y cuánto vendieron, por día y hora local.
 * Ni clientes, ni productos, ni números de orden: para decidir el horario no hace falta nada
 * más, y lo que no se guarda no se puede filtrar.
 *
 * LA CONEXIÓN ES UNA APP DEL DEV DASHBOARD DE SHOPIFY instalada en la tienda, con permiso
 * `read_orders`. Shopify ya no deja crear las «apps personalizadas» del panel de la tienda
 * (las del token `shpat_` que se copiaba una vez); las del Dev Dashboard dan un ID y un
 * secreto, y con ellos se pide un token de 24 h cada vez («client credentials»). El ID y el
 * secreto viven en `shopify_credentials`, que las reglas no dejan leer a nadie: solo este
 * archivo.
 *
 * `read_orders` alcanza a los últimos 60 días, y por eso al conectar se traen esos 60.
 *
 * ponytail: una tienda por empresa y todas sus órdenes juntas (en la tienda para la que se
 * hizo, casi todas son del punto de venta de su única sede). Con varias sedes con caja propia habría que separar
 * por `retailLocation`.
 */

const API = '2026-07';
const DIAS_AL_CONECTAR = 60;
/** Cada hora se rehacen hoy y ayer: una orden anulada tarde también se descuenta. */
const DIAS_AL_SINCRONIZAR = 2;

const CREDENCIALES = 'shopify_credentials';
const ESTADO = 'shopify_status';
const POR_HORA = 'orders_by_hour';

type Credenciales = { shop: string; client_id: string; client_secret: string };

function restarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
}

async function pedirToken(credenciales: Credenciales): Promise<string> {
  const respuesta = await fetch(`https://${credenciales.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credenciales.client_id,
      client_secret: credenciales.client_secret,
    }),
  });
  if (!respuesta.ok) {
    throw new HttpsError(
      'failed-precondition',
      `Shopify no aceptó el ID y el secreto de la app (${respuesta.status}). Revisa que la app esté instalada en la tienda y que copiaste los dos bien.`,
    );
  }
  const { access_token } = (await respuesta.json()) as { access_token?: string };
  if (typeof access_token !== 'string') {
    throw new HttpsError('failed-precondition', 'Shopify no devolvió un token.');
  }
  return access_token;
}

async function graphql<T>(shop: string, token: string, query: string, variables = {}): Promise<T> {
  const respuesta = await fetch(`https://${shop}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!respuesta.ok) {
    throw new HttpsError('unavailable', `Shopify respondió ${respuesta.status}.`);
  }
  const { data, errors } = (await respuesta.json()) as { data?: T; errors?: { message: string }[] };
  if (errors !== undefined && errors.length > 0) {
    // El permiso que falta es lo más común: Shopify lo dice en el mensaje.
    throw new HttpsError('failed-precondition', `Shopify: ${errors[0]?.message ?? 'error'}`);
  }
  return data as T;
}

const ORDENES = `query($after: String, $q: String!) {
  orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { createdAt cancelledAt test totalPriceSet { shopMoney { amount } } }
  }
}`;

type PaginaDeOrdenes = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      createdAt: string;
      cancelledAt: string | null;
      test: boolean;
      totalPriceSet: { shopMoney: { amount: string } };
    }[];
  };
};

async function leerOrdenes(shop: string, token: string, desdeISO: string): Promise<OrdenMinima[]> {
  const ordenes: OrdenMinima[] = [];
  let after: string | null = null;
  // Como mucho 40 páginas de 250: 10 000 órdenes en 60 días es otra escala de tienda.
  for (let pagina = 0; pagina < 40; pagina += 1) {
    const datos: PaginaDeOrdenes = await graphql<PaginaDeOrdenes>(shop, token, ORDENES, {
      after,
      q: `created_at:>='${desdeISO}'`,
    });
    for (const nodo of datos.orders.nodes) {
      ordenes.push({
        createdAt: nodo.createdAt,
        cancelledAt: nodo.cancelledAt,
        test: nodo.test,
        total: Number(nodo.totalPriceSet.shopMoney.amount) || 0,
      });
    }
    if (!datos.orders.pageInfo.hasNextPage) break;
    after = datos.orders.pageInfo.endCursor;
  }
  return ordenes;
}

/**
 * Rehace los días de `desde` a hoy: lee sus órdenes y escribe un documento por día, también
 * los días sin ninguna. Así «0 órdenes» se distingue de «sin datos» en Reportes.
 */
async function sincronizar(organizationId: string, credenciales: Credenciales, dias: number) {
  const organizacion = (
    await db.collection(COLLECTIONS.organizations).doc(organizationId).get()
  ).data();
  const zona = zonaSegura(organizacion?.default_timezone, `shopify ${organizationId}`);
  const hoy = diaYHora(nowISO(), zona).dia;
  const desde = restarDias(hoy, dias - 1);
  const desdeISO = instanteLocal(desde, '00:00', zona) ?? `${desde}T00:00:00Z`;

  const token = await pedirToken(credenciales);
  const { shop } = await graphql<{ shop: { currencyCode: string } }>(
    credenciales.shop,
    token,
    '{ shop { currencyCode } }',
  );
  const ordenes = await leerOrdenes(credenciales.shop, token, desdeISO);
  const porDia = sumarPorHora(ordenes, zona);

  const lote = db.batch();
  let total = 0;
  for (const dia of diasEntre(desde, hoy)) {
    const horas = porDia.get(dia) ?? {};
    const valores = Object.values(horas);
    total += valores.reduce((suma, hora) => suma + hora.orders, 0);
    lote.set(db.collection(POR_HORA).doc(`${organizationId}_${dia}`), {
      organization_id: organizationId,
      date: dia,
      hours: horas,
      orders: valores.reduce((suma, hora) => suma + hora.orders, 0),
      sales: Math.round(valores.reduce((suma, hora) => suma + hora.sales, 0) * 100) / 100,
      currency: shop.currencyCode,
      updated_at: nowISO(),
    });
  }
  lote.set(
    db.collection(ESTADO).doc(organizationId),
    { last_sync_at: nowISO(), last_error: null, currency: shop.currencyCode },
    { merge: true },
  );
  await lote.commit();
  return { dias: diasEntre(desde, hoy).length, ordenes: total };
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

export const connectShopify = onCall({ timeoutSeconds: 300 }, async (request) => {
  const uid = requireUid(request);
  const datos = (request.data ?? {}) as Record<string, unknown>;
  const organizationId = texto(datos.p_organization_id);
  if (organizationId === null) throw new HttpsError('invalid-argument', 'Falta la empresa.');
  requireRole(await membershipOf(uid, organizationId), ['owner', 'admin']);

  const shop = tiendaNormalizada(datos.p_shop);
  const clientId = texto(datos.p_client_id);
  const clientSecret = texto(datos.p_client_secret);
  if (shop === null) {
    throw new HttpsError('invalid-argument', 'La tienda se escribe como tutienda.myshopify.com.');
  }
  if (clientId === null || clientSecret === null) {
    throw new HttpsError('invalid-argument', 'Faltan el ID o el secreto de la app.');
  }
  const credenciales: Credenciales = { shop, client_id: clientId, client_secret: clientSecret };

  // Se comprueba ANTES de guardar: una conexión que no funciona no se queda a medias.
  const token = await pedirToken(credenciales);
  const { shop: tienda } = await graphql<{ shop: { name: string; currencyCode: string } }>(
    shop,
    token,
    '{ shop { name currencyCode } }',
  );

  await db.collection(CREDENCIALES).doc(organizationId).set(credenciales);
  await db.collection(ESTADO).doc(organizationId).set({
    organization_id: organizationId,
    shop,
    shop_name: tienda.name,
    currency: tienda.currencyCode,
    connected_at: nowISO(),
    connected_by: uid,
  });
  await audit({
    organizationId,
    actorUserId: uid,
    action: 'shopify_connected',
    entityType: 'shopify_status',
    entityId: organizationId,
    before: null,
    after: { shop, shop_name: tienda.name },
  });

  const resumen = await sincronizar(organizationId, credenciales, DIAS_AL_CONECTAR);
  return { shop_name: tienda.name, days: resumen.dias, orders: resumen.ordenes };
});

/**
 * TRAER EL HISTORIAL (13-nov). Andree: «¿por qué no tengo órdenes de agosto?». Porque
 * `read_orders` solo alcanza 60 días. El historial entero lo da `read_all_orders`, que Shopify
 * concede a mano (pedido el 13-nov para «Krealo Shift - pedidos»).
 *
 * Con la credencial ya guardada: nadie vuelve a pegar el secreto.
 *
 * SOLO SI LA APP TIENE `read_all_orders`. Sin él Shopify no da error: devuelve los 60 días y
 * calla. Y `sincronizar` escribe un documento por día, también los vacíos, así que pedir 365
 * días sin el permiso dejaría casi diez meses en «0 órdenes» cuando en realidad son «sin
 * datos». Por eso se pregunta antes a Shopify qué permisos tiene la app, y sin ese permiso se
 * dice en vez de traer.
 *
 * 365 días: un año entero compara cada temporada con la del año anterior, y cabe en un solo
 * lote de Firestore (500 escrituras) y en las 40 páginas de 250 órdenes de `leerOrdenes`.
 */
const DIAS_DE_HISTORIAL = 365;

async function tienePermiso(credenciales: Credenciales, permiso: string): Promise<boolean> {
  const token = await pedirToken(credenciales);
  const datos = await graphql<{
    currentAppInstallation: { accessScopes: { handle: string }[] };
  }>(credenciales.shop, token, '{ currentAppInstallation { accessScopes { handle } } }');
  return datos.currentAppInstallation.accessScopes.some((scope) => scope.handle === permiso);
}

export const backfillShopifyOrders = onCall({ timeoutSeconds: 540 }, async (request) => {
  const uid = requireUid(request);
  const organizationId = texto((request.data ?? {}).p_organization_id);
  if (organizationId === null) throw new HttpsError('invalid-argument', 'Falta la empresa.');
  requireRole(await membershipOf(uid, organizationId), ['owner', 'admin']);

  const doc = await db.collection(CREDENCIALES).doc(organizationId).get();
  if (!doc.exists) throw new HttpsError('failed-precondition', 'La tienda no está conectada.');
  const credenciales = doc.data() as Credenciales;

  if (!(await tienePermiso(credenciales, 'read_all_orders'))) {
    throw new HttpsError(
      'failed-precondition',
      'Shopify todavía no deja leer órdenes de más de 60 días: falta que la app tenga el permiso «read_all_orders».',
    );
  }

  const resumen = await sincronizar(organizationId, credenciales, DIAS_DE_HISTORIAL);
  await audit({
    organizationId,
    actorUserId: uid,
    action: 'shopify_history_backfilled',
    entityType: 'shopify_status',
    entityId: organizationId,
    before: null,
    after: { days: resumen.dias, orders: resumen.ordenes },
  });
  return { days: resumen.dias, orders: resumen.ordenes };
});

/** Desconectar borra el ID y el secreto; las órdenes por hora ya sumadas se quedan. */
export const disconnectShopify = onCall(async (request) => {
  const uid = requireUid(request);
  const organizationId = texto((request.data ?? {}).p_organization_id);
  if (organizationId === null) throw new HttpsError('invalid-argument', 'Falta la empresa.');
  requireRole(await membershipOf(uid, organizationId), ['owner', 'admin']);

  const previo = (await db.collection(ESTADO).doc(organizationId).get()).data() ?? null;
  await db.collection(CREDENCIALES).doc(organizationId).delete();
  await db.collection(ESTADO).doc(organizationId).delete();
  await audit({
    organizationId,
    actorUserId: uid,
    action: 'shopify_disconnected',
    entityType: 'shopify_status',
    entityId: organizationId,
    before: previo,
    after: null,
  });
  return { disconnected: previo !== null };
});

export const syncShopifyOrders = onSchedule(
  { schedule: '10 * * * *', timeZone: 'America/Lima', retryCount: 1, timeoutSeconds: 300 },
  async () => {
    const conexiones = await db.collection(CREDENCIALES).get();
    for (const doc of conexiones.docs) {
      try {
        const resumen = await sincronizar(doc.id, doc.data() as Credenciales, DIAS_AL_SINCRONIZAR);
        logger.info('Órdenes de Shopify al día', { organizacion: doc.id, ...resumen });
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        logger.error('No se pudieron traer las órdenes de Shopify', {
          organizacion: doc.id,
          mensaje,
        });
        // Se dice en Ajustes: si la app se desinstaló, quien gestiona lo ve allí.
        await db
          .collection(ESTADO)
          .doc(doc.id)
          .set({ last_error: mensaje, last_error_at: nowISO() }, { merge: true });
      }
    }
  },
);
