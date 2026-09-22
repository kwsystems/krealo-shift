import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { COLLECTIONS, db, nowISO } from './shared/admin';
import { corteDeRetencion, plazoDeRetencion } from './shared/retencion';

/**
 * Borrado de las fotos de fichaje que ya cumplieron su plazo (§9.6).
 *
 * POR QUE ES UNA FUNCION PROGRAMADA Y NO UN BORRADO AL VUELO. El plazo lo cumple una
 * foto por el paso del tiempo, no por nada que haga nadie: el dia 31 no hay ninguna
 * peticion que aprovechar para borrar la del dia 1. Sin algo que corra solo, el ajuste
 * «Retencion de fotos (dias)» seria un numero que la aplicacion enseña y no cumple, que
 * es peor que no tenerlo: promete un borrado a quien confia en el.
 *
 * Y AHORA IMPORTA MAS QUE ANTES. Con la foto obligatoria en el reloj web —ver
 * `disponibilidad.ts`— dejan de ser un caso raro de las tiendas que la activaron: son
 * una foto de la cara de alguien por cada fichaje, varias al dia por persona.
 *
 * -------------------------------------------------------------------------------------
 * COMO RECORRE, Y POR QUE ASI
 * -------------------------------------------------------------------------------------
 *
 * Por UBICACION, no por organizacion, porque el plazo es un ajuste de ubicacion: dos
 * tiendas de la misma empresa pueden tener 30 y 90 dias, y una pasada por organizacion
 * tendria que elegir uno de los dos y equivocarse con el otro.
 *
 * Con MARCA DE AGUA, y sin ella esto crece sin fin. La consulta natural —«eventos de
 * esta sede anteriores al corte»— devuelve tambien todos los que ya se purgaron en
 * pasadas anteriores, asi que al cabo de un año se leerian miles de documentos cada dia
 * para no borrar nada. La marca guarda por donde iba y la consulta arranca de ahi: en
 * regimen se lee lo de un dia. Solo avanza cuando el lote se proceso entero, asi que
 * una pasada que falle a medias se reanuda donde estaba en vez de saltarse fotos.
 *
 * El orden es ASCENDENTE —lo mas viejo primero— por lo mismo: es lo que hace que la
 * marca de agua signifique algo y que ningun documento se quede atras.
 *
 * La consulta encaja con el indice que ya existe
 * (`organization_id` + `location_id` + `occurred_at` ascendente): no hace falta ninguno
 * nuevo.
 */

/** Cuantos eventos se miran por ubicacion y pasada. Con una pasada diaria sobra. */
const LOTE = 500;

const MARCAS = '_purga_fotos';

type Resumen = { miradas: number; borradas: number; fallidas: number };

async function purgarUbicacion(params: {
  organizationId: string;
  locationId: string;
  dias: number;
}): Promise<Resumen> {
  const { organizationId, locationId, dias } = params;
  const resumen: Resumen = { miradas: 0, borradas: 0, fallidas: 0 };

  const corte = corteDeRetencion(dias);
  const marcaRef = db.collection(MARCAS).doc(locationId);
  const desde =
    ((await marcaRef.get()).data()?.hasta as string | undefined) ?? '1970-01-01T00:00:00.000Z';

  // Si la marca ya paso el corte no hay nada viejo que mirar todavia.
  if (desde >= corte) return resumen;

  const lote = await db
    .collection(COLLECTIONS.timeEvents)
    .where('organization_id', '==', organizationId)
    .where('location_id', '==', locationId)
    .where('occurred_at', '>', desde)
    .where('occurred_at', '<=', corte)
    .orderBy('occurred_at', 'asc')
    .limit(LOTE)
    .get();

  if (lote.empty) {
    // No hay eventos en la ventana, pero la ventana YA se reviso: la marca avanza igual.
    // Sin esto, una sede sin fichajes viejos se volveria a consultar entera cada dia.
    await marcaRef.set({ hasta: corte, updated_at: nowISO() }, { merge: true });
    return resumen;
  }

  const bucket = getStorage().bucket();
  let ultimo = desde;

  for (const doc of lote.docs) {
    resumen.miradas += 1;
    const datos = doc.data();
    ultimo = (datos.occurred_at as string) ?? ultimo;

    const ruta = datos.photo_path;
    if (typeof ruta !== 'string' || ruta === '') continue;

    try {
      /*
       * `ignoreNotFound` porque el archivo puede no estar y eso NO es un fallo: la foto
       * se sube despues del fichaje y a proposito —ver `attachPhoto`—, asi que un
       * fichaje cuya subida nunca llego tiene `photo_path` apuntando a un archivo que no
       * existe. Tratarlo como error dejaria la marca sin avanzar para siempre, atascada
       * en el mismo documento.
       */
      await bucket.file(ruta).delete({ ignoreNotFound: true });
      /*
       * Y SE LIMPIA `photo_path`. Si se borra el archivo y se deja la ruta, la ficha del
       * fichaje sigue ofreciendo ver una foto que ya no esta, y quien la pulse recibe un
       * error tecnico en vez de saber que caduco.
       */
      await doc.ref.update({ photo_path: null, photo_purged_at: nowISO() });
      resumen.borradas += 1;
    } catch (error) {
      resumen.fallidas += 1;
      logger.error('No se pudo purgar la foto de un fichaje', {
        locationId,
        eventId: doc.id,
        ruta,
        error: String(error),
      });
    }
  }

  /*
   * La marca solo avanza si el lote salio limpio. Con fallos se queda donde estaba y la
   * pasada de mañana vuelve a intentarlo: es preferible repetir trabajo a dar por
   * purgada una foto que sigue en el bucket, que es justo lo que el ajuste promete que
   * no pasa.
   */
  if (resumen.fallidas === 0) {
    await marcaRef.set({ hasta: ultimo, updated_at: nowISO() }, { merge: true });
  }

  return resumen;
}

/**
 * Una pasada diaria, de madrugada en hora de Lima.
 *
 * A las 3:30 no hay nadie fichando en ninguna de las tiendas, asi que el borrado no
 * compite con el uso real ni con la sincronizacion de los relojes.
 */
/**
 * La pasada completa, SEPARADA DEL PROGRAMADOR para poder comprobarla.
 *
 * `onSchedule` devuelve un objeto de despliegue, no una funcion que se pueda llamar: lo
 * que envuelve queda dentro y una prueba no lo alcanza. Y aqui hace falta alcanzarlo,
 * porque lo que esto hace —borrar retratos de personas— no se da por bueno leyendo el
 * codigo: una marca de agua mal avanzada, un prefijo de Storage equivocado o un corte de
 * retencion mal calculado tienen exactamente el mismo aspecto y no borran nada.
 */
export async function purgarTodasLasUbicaciones(): Promise<
  Resumen & { ubicaciones: number; sinPlazo: number }
> {
  const ubicaciones = await db.collection(COLLECTIONS.locations).get();
  const total: Resumen = { miradas: 0, borradas: 0, fallidas: 0 };
  let saltadas = 0;

  for (const ubicacion of ubicaciones.docs) {
    const datos = ubicacion.data();
    const dias = plazoDeRetencion(
      (datos.settings as Record<string, unknown> | undefined)?.photoRetentionDays,
    );
    if (dias === null) {
      saltadas += 1;
      continue;
    }

    const parcial = await purgarUbicacion({
      organizationId: datos.organization_id as string,
      locationId: ubicacion.id,
      dias,
    });
    total.miradas += parcial.miradas;
    total.borradas += parcial.borradas;
    total.fallidas += parcial.fallidas;
  }

  return { ...total, ubicaciones: ubicaciones.size, sinPlazo: saltadas };
}

export const purgarFotosDeFichaje = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'America/Lima', retryCount: 1 },
  async () => {
    const resumen = await purgarTodasLasUbicaciones();

    /*
     * Se registra SIEMPRE, tambien cuando no borro nada. Un trabajo programado que solo
     * habla cuando actua es indistinguible de uno que dejo de ejecutarse, y lo que hay
     * que poder comprobar es justamente que sigue corriendo.
     */
    logger.info('Purga de fotos de fichaje', resumen);
  },
);
