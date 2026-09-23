import { esZonaValida, zonaCanonica, ZONAS_DE_EJEMPLO } from '@/domain/zona-horaria';

/**
 * Lo que esta prueba protege no es el validador: es que Horas no reviente.
 *
 * El servidor agrupa las jornadas por día con `Intl.DateTimeFormat` y la zona de la
 * sede. Con una zona inventada eso LANZA, y lanza al LEER, no al guardar — así que el
 * error aparecería días después, en otra pantalla, sin mencionar la zona.
 */
describe('zonaCanonica', () => {
  it('acepta las zonas de los dos países donde hay tiendas', () => {
    for (const zona of ZONAS_DE_EJEMPLO) {
      expect(zonaCanonica(zona)).toBe(zona);
    }
  });

  it('rechaza el formato que de verdad se equivoca: la ciudad a secas', () => {
    expect(zonaCanonica('Lima')).toBeNull();
    expect(zonaCanonica('Toronto')).toBeNull();
  });

  it('rechaza un desplazamiento en vez de una zona', () => {
    // «GMT-5» parece razonable y es justo lo que no sirve: no sabe de horario de verano.
    expect(zonaCanonica('GMT-5')).toBeNull();
  });

  it('rechaza una zona inventada', () => {
    expect(zonaCanonica('America/Nowhere')).toBeNull();
  });

  it('rechaza el vacío y los espacios', () => {
    expect(zonaCanonica('')).toBeNull();
    expect(zonaCanonica('   ')).toBeNull();
  });

  it('ignora espacios alrededor, que es lo que deja un copiar y pegar', () => {
    expect(zonaCanonica('  America/Lima  ')).toBe('America/Lima');
  });

  /**
   * DOS COSAS QUE MEDÍ Y NO ESPERABA, y por eso están escritas: no distingue mayúsculas,
   * y acepta alias antiguos. Las dos justifican guardar el nombre canónico en vez del
   * texto crudo — si no, la misma zona quedaría escrita de tres formas distintas en la
   * base y dos sedes del mismo huso parecerían estar en husos diferentes.
   */
  it('normaliza las mayúsculas', () => {
    expect(zonaCanonica('america/lima')).toBe('America/Lima');
    expect(zonaCanonica('AMERICA/LIMA')).toBe('America/Lima');
  });

  it('resuelve los alias antiguos a su nombre actual', () => {
    expect(zonaCanonica('America/Montreal')).toBe('America/Toronto');
  });
});

describe('esZonaValida', () => {
  /**
   * LA PRUEBA QUE DE VERDAD IMPORTA: lo que se acepta es exactamente lo que `Intl` puede
   * usar después. Sin esto el validador podría decir «vale» sobre algo que luego lanza,
   * que es el fallo que existe hoy.
   */
  it('todo lo que acepta se puede usar para agrupar por día sin lanzar', () => {
    for (const zona of [...ZONAS_DE_EJEMPLO, 'UTC', 'Europe/Madrid', 'america/lima']) {
      expect(esZonaValida(zona)).toBe(true);
      expect(() =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: zonaCanonica(zona) ?? 'UTC',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date('2026-09-23T02:00:00.000Z')),
      ).not.toThrow();
    }
  });

  it('y lo que rechaza es justo lo que habría reventado al agrupar', () => {
    for (const mala of ['Lima', 'GMT-5', 'America/Nowhere']) {
      expect(esZonaValida(mala)).toBe(false);
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: mala })).toThrow();
    }
  });
});

/**
 * EL CASO DE ANDREE, y la razón de toda esta tarea: a las 04:30 UTC ya es día 23 en
 * Toronto y sigue siendo el 22 en Lima. Si las sedes de Canadá heredaran la zona de Lima
 * —que es lo que pasa hoy— esa jornada se contaría en el día equivocado del reporte que
 * se usa para pagar.
 */
describe('dos sedes en husos distintos', () => {
  const dia = (zona: string, iso: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));

  it('la misma hora cae en días distintos', () => {
    expect(dia('America/Toronto', '2026-07-23T04:30:00.000Z')).toBe('2026-07-23');
    expect(dia('America/Lima', '2026-07-23T04:30:00.000Z')).toBe('2026-07-22');
  });

  /**
   * Y la diferencia APARECE Y DESAPARECE según el mes, que es lo que hace este fallo
   * tan difícil de diagnosticar: Perú no cambia la hora en todo el año y Canadá sí.
   */
  it('en enero coinciden y en julio no', () => {
    expect(dia('America/Toronto', '2026-01-23T04:30:00.000Z')).toBe(
      dia('America/Lima', '2026-01-23T04:30:00.000Z'),
    );
    expect(dia('America/Toronto', '2026-07-23T04:30:00.000Z')).not.toBe(
      dia('America/Lima', '2026-07-23T04:30:00.000Z'),
    );
  });
});
