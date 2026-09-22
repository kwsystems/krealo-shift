import { corteDeRetencion, plazoDeRetencion } from '../retencion';

/**
 * La unica parte de la purga de fotos que se puede comprobar sin emulador, y es la que
 * importa: decide si se borra o no. El recorrido —marca de agua, lotes— necesita
 * Firestore de verdad y se queda fuera a proposito.
 */
describe('retencion de fotos de fichaje', () => {
  /*
   * ESTA ES LA PRUEBA QUE JUSTIFICA EL ARCHIVO. «Retencion 0» parece que deba significar
   * «borra ya», y alguien lo va a "arreglar" algun dia. Si lo hace, esto falla y lee por
   * que no: un cero mal tecleado borraria para siempre las fotos de una tienda.
   */
  it('un plazo de 0 NO purga: se elige el fallo reversible', () => {
    expect(plazoDeRetencion(0)).toBeNull();
  });

  it('tampoco purga sin ajuste, con basura o con un plazo negativo', () => {
    for (const valor of [undefined, null, -1, Number.NaN, '30', {}]) {
      expect(plazoDeRetencion(valor)).toBeNull();
    }
  });

  it('un plazo normal se respeta, y los decimales se truncan', () => {
    expect(plazoDeRetencion(30)).toBe(30);
    expect(plazoDeRetencion(1)).toBe(1);
    expect(plazoDeRetencion(7.9)).toBe(7);
  });

  it('el corte cae exactamente ese numero de dias atras', () => {
    const ahora = new Date('2026-09-21T12:00:00.000Z');
    expect(corteDeRetencion(30, ahora)).toBe('2026-08-22T12:00:00.000Z');
    expect(corteDeRetencion(1, ahora)).toBe('2026-09-20T12:00:00.000Z');
  });
});
