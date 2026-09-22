import { getStorage } from 'firebase-admin/storage';

import { purgarTodasLasUbicaciones } from '../../purga-fotos';
import { COLLECTIONS, db } from '../../shared/admin';

/**
 * La purga de fotos de fichaje, comprobada BORRANDO ARCHIVOS DE VERDAD (§9.6).
 *
 * POR QUE ESTA PRUEBA EXISTE. La app le dice a cada persona, en la pantalla del reloj y
 * antes de sacarle una foto de la cara: «se borra sola después de N días». Esa frase es
 * una promesa sobre datos personales, y hasta ahora no la respaldaba nada: la funcion
 * estaba escrita y desplegada, pero nadie habia visto nunca desaparecer una foto. Leer
 * el codigo no sirve para esto —una marca de agua mal avanzada, un prefijo de Storage
 * equivocado o un corte de retencion mal calculado se leen exactamente igual de bien y
 * no borran nada—, asi que se comprueba contra los emuladores de Firestore y Storage.
 *
 * LAS DOS MITADES IMPORTAN, y la segunda mas de lo que parece. Que borre la vieja es lo
 * que promete; que NO borre la reciente es lo que impide que un corte mal calculado se
 * lleve por delante las fotos del dia, que es el fallo irreversible. Por eso cada caso
 * comprueba las dos cosas a la vez.
 */

const ORG = 'org-pruebas';
const SEDE_CON_PLAZO = 'sede-con-plazo';
const SEDE_SIN_PLAZO = 'sede-sin-plazo';
const PROYECTO = 'demo-krealo-shift';

const diasAtras = (dias: number): string =>
  new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

const bucket = () => getStorage().bucket();

async function existeEnStorage(ruta: string): Promise<boolean> {
  const [existe] = await bucket().file(ruta).exists();
  return existe;
}

async function ponerFoto(ruta: string): Promise<void> {
  await bucket().file(ruta).save(Buffer.from('foto de mentira'), { contentType: 'image/jpeg' });
}

async function ponerFichaje(params: {
  id: string;
  sede: string;
  cuandoDiasAtras: number;
  foto: string | null;
}): Promise<void> {
  await db
    .collection(COLLECTIONS.timeEvents)
    .doc(params.id)
    .set({
      id: params.id,
      organization_id: ORG,
      location_id: params.sede,
      employee_id: 'alguien',
      event_type: 'clock_in',
      occurred_at: diasAtras(params.cuandoDiasAtras),
      photo_path: params.foto,
    });
}

async function ponerSede(id: string, dias: number | undefined): Promise<void> {
  await db
    .collection(COLLECTIONS.locations)
    .doc(id)
    .set({
      id,
      organization_id: ORG,
      name: id,
      settings: dias === undefined ? {} : { photoRetentionDays: dias },
    });
}

/** Se vacia por la REST del emulador: borra la base entera de un golpe. */
async function vaciarFirestore(): Promise<void> {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`no se pudo vaciar Firestore: ${res.status}`);
}

async function vaciarStorage(): Promise<void> {
  await bucket().deleteFiles({ force: true });
}

beforeEach(async () => {
  await vaciarFirestore();
  await vaciarStorage();
});

describe('la purga de fotos de fichaje', () => {
  it('borra la foto que cumplio el plazo y deja la reciente', async () => {
    await ponerSede(SEDE_CON_PLAZO, 30);

    const vieja = `attendance-photos/${ORG}/vieja.jpg`;
    const reciente = `attendance-photos/${ORG}/reciente.jpg`;
    await ponerFoto(vieja);
    await ponerFoto(reciente);
    await ponerFichaje({ id: 'ev-vieja', sede: SEDE_CON_PLAZO, cuandoDiasAtras: 60, foto: vieja });
    await ponerFichaje({
      id: 'ev-nueva',
      sede: SEDE_CON_PLAZO,
      cuandoDiasAtras: 1,
      foto: reciente,
    });

    const resumen = await purgarTodasLasUbicaciones();

    expect(resumen.borradas).toBe(1);
    expect(resumen.fallidas).toBe(0);

    // La vieja desaparecio del bucket Y dejo de ofrecerse desde el fichaje.
    expect(await existeEnStorage(vieja)).toBe(false);
    const viejaDoc = (await db.collection(COLLECTIONS.timeEvents).doc('ev-vieja').get()).data();
    expect(viejaDoc?.photo_path).toBeNull();
    expect(typeof viejaDoc?.photo_purged_at).toBe('string');

    // Y LA RECIENTE SIGUE INTACTA. Esta mitad es la que pilla un corte mal calculado.
    expect(await existeEnStorage(reciente)).toBe(true);
    const nuevaDoc = (await db.collection(COLLECTIONS.timeEvents).doc('ev-nueva').get()).data();
    expect(nuevaDoc?.photo_path).toBe(reciente);
    expect(nuevaDoc?.photo_purged_at).toBeUndefined();
  });

  /**
   * El plazo ausente NO borra, y esta es la decision de `plazoDeRetencion`: entre
   * equivocarse acumulando fotos —reversible— y equivocarse borrandolas —no lo es— se
   * elige lo reversible. Una sede sin ajuste no pierde nada.
   */
  it('no toca las fotos de una sede sin plazo configurado', async () => {
    await ponerSede(SEDE_SIN_PLAZO, undefined);

    const antigua = `attendance-photos/${ORG}/sin-plazo.jpg`;
    await ponerFoto(antigua);
    await ponerFichaje({
      id: 'ev-sin-plazo',
      sede: SEDE_SIN_PLAZO,
      cuandoDiasAtras: 400,
      foto: antigua,
    });

    const resumen = await purgarTodasLasUbicaciones();

    expect(resumen.sinPlazo).toBe(1);
    expect(resumen.borradas).toBe(0);
    expect(await existeEnStorage(antigua)).toBe(true);
  });

  /** Un plazo de cero se lee como «desactivado», por el mismo motivo que el ausente. */
  it('un plazo de cero tampoco borra', async () => {
    await ponerSede(SEDE_SIN_PLAZO, 0);

    const antigua = `attendance-photos/${ORG}/cero.jpg`;
    await ponerFoto(antigua);
    await ponerFichaje({
      id: 'ev-cero',
      sede: SEDE_SIN_PLAZO,
      cuandoDiasAtras: 400,
      foto: antigua,
    });

    const resumen = await purgarTodasLasUbicaciones();

    expect(resumen.sinPlazo).toBe(1);
    expect(await existeEnStorage(antigua)).toBe(true);
  });

  /**
   * UN FICHAJE SIN FOTO NO ATASCA LA PASADA. La foto se sube DESPUES del fichaje y a
   * proposito, asi que un `photo_path` que apunta a un archivo que nunca llego es
   * normal. Si eso contara como fallo, la marca de agua no avanzaria nunca y la purga
   * se quedaria clavada en el mismo documento para siempre: las fotos posteriores no se
   * borrarian jamas y nadie se enteraria, porque la funcion seguiria ejecutandose.
   */
  it('un fichaje cuya foto nunca se subio no cuenta como fallo', async () => {
    await ponerSede(SEDE_CON_PLAZO, 30);

    const fantasma = `attendance-photos/${ORG}/nunca-llego.jpg`;
    const real = `attendance-photos/${ORG}/si-llego.jpg`;
    await ponerFoto(real);
    await ponerFichaje({
      id: 'ev-1-fantasma',
      sede: SEDE_CON_PLAZO,
      cuandoDiasAtras: 90,
      foto: fantasma,
    });
    await ponerFichaje({ id: 'ev-2-real', sede: SEDE_CON_PLAZO, cuandoDiasAtras: 60, foto: real });

    const resumen = await purgarTodasLasUbicaciones();

    expect(resumen.fallidas).toBe(0);
    expect(resumen.borradas).toBe(2);
    expect(await existeEnStorage(real)).toBe(false);
  });

  /**
   * LA MARCA DE AGUA AVANZA, y sin ella esto crece sin fin: la consulta natural
   * devolveria cada dia todos los fichajes ya purgados, asi que al cabo de un año se
   * leerian miles de documentos para no borrar nada.
   */
  it('la segunda pasada no vuelve a mirar lo que ya purgo', async () => {
    await ponerSede(SEDE_CON_PLAZO, 30);

    const foto = `attendance-photos/${ORG}/una.jpg`;
    await ponerFoto(foto);
    await ponerFichaje({ id: 'ev-una', sede: SEDE_CON_PLAZO, cuandoDiasAtras: 60, foto });

    const primera = await purgarTodasLasUbicaciones();
    expect(primera.miradas).toBe(1);
    expect(primera.borradas).toBe(1);

    const segunda = await purgarTodasLasUbicaciones();
    expect(segunda.miradas).toBe(0);
    expect(segunda.borradas).toBe(0);
  });
});
