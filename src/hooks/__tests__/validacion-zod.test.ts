import { z } from 'zod';

import { AdminError, adminErrorKind, selectRows } from '../use-admin-query';

const mockGetSupabase = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

/**
 * Validación Zod de TODA respuesta al recibirla (§22, §28).
 *
 * §28 la pide entre las nueve pruebas unitarias obligatorias y era la única que no
 * existía. §22 dice que si el backend cambia de forma "la pantalla muestra un error
 * honesto en lugar de pintar `undefined`". Eso estaba escrito en un comentario y no
 * comprobado en ninguna parte: era una intención, no una propiedad.
 *
 * LO QUE HACE ESTO IMPORTANTE Y NO CEREMONIA. Sin la validación, un campo que el
 * servidor deja de enviar no falla: llega como `undefined`, y `undefined` pintado en
 * una pantalla de horas se lee como un cero. Una hoja de tiempo que dice cero horas
 * trabajadas por un cambio de forma del backend es un error de nómina, no un error de
 * interfaz.
 */

const clienteFalso = { from: () => undefined };

/** Lo que devuelve el cliente de Supabase: `{ data, error }`. */
const respuesta = (data: unknown) => Promise.resolve({ data, error: null });

const sesionSchema = z.object({
  id: z.string().uuid(),
  net_minutes: z.number().int(),
  employee_name: z.string(),
});

describe('validación de respuestas con Zod', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSupabase.mockReturnValue(clienteFalso);
  });

  it('una respuesta con la forma esperada pasa tal cual', () => {
    // La otra mitad, y hace falta: una prueba que solo compruebe rechazos pasaría
    // igual con la validación rechazando TODO, y entonces el panel no mostraría nada.
    const fila = {
      id: '11111111-1111-4111-8111-111111111111',
      net_minutes: 480,
      employee_name: 'Sofía Demo',
    };
    return expect(selectRows(sesionSchema, () => respuesta(fila))).resolves.toEqual(fila);
  });

  it('un campo que el servidor deja de enviar NO llega como undefined', async () => {
    /*
     * El caso que importa. Sin la validación, `net_minutes` sería `undefined` y la
     * pantalla pintaría un cero: una hoja de tiempo que dice cero horas trabajadas por
     * un cambio de forma del backend es un error de nómina.
     */
    const sinMinutos = {
      id: '11111111-1111-4111-8111-111111111111',
      employee_name: 'Sofía Demo',
    };

    await expect(selectRows(sesionSchema, () => respuesta(sinMinutos))).rejects.toThrow(AdminError);
  });

  it('el error dice "forma inesperada" y no un fallo genérico', async () => {
    // §20: cada fallo se traduce a un caso que la pantalla sabe explicar. "Algo salió
    // mal, inténtalo otra vez" es un consejo imposible cuando el problema es que el
    // backend cambió: reintentar da exactamente lo mismo.
    const error = await selectRows(sesionSchema, () => respuesta({ id: 'no-es-uuid' })).catch(
      (e: unknown) => e,
    );

    expect(adminErrorKind(error)).toBe('unexpectedShape');
  });

  it('un tipo cambiado se rechaza, no se convierte en silencio', async () => {
    // Zod no hace coerción aquí a propósito: `"480"` en vez de `480` significa que algo
    // cambió en el servidor, y aceptarlo esconde el cambio hasta que rompa otra cosa.
    await expect(
      selectRows(sesionSchema, () =>
        respuesta({
          id: '11111111-1111-4111-8111-111111111111',
          net_minutes: '480',
          employee_name: 'Sofía Demo',
        }),
      ),
    ).rejects.toThrow(AdminError);
  });

  it('null y undefined donde se esperaba una fila también se rechazan', async () => {
    for (const vacio of [null, undefined]) {
      await expect(selectRows(sesionSchema, () => respuesta(vacio))).rejects.toThrow(AdminError);
    }
  });

  it('una lista con UNA fila mala rechaza la lista entera', async () => {
    /*
     * Y no se filtra la fila mala en silencio. Media hoja de tiempo es peor que ninguna:
     * un total calculado sobre las filas que "sí se pudieron leer" es un número
     * equivocado con aspecto de correcto, y nadie lo revisa porque no parece un error.
     */
    const filas = [
      { id: '11111111-1111-4111-8111-111111111111', net_minutes: 480, employee_name: 'A' },
      { id: '22222222-2222-4222-8222-222222222222', employee_name: 'B' },
    ];

    await expect(selectRows(z.array(sesionSchema), () => respuesta(filas))).rejects.toThrow(
      AdminError,
    );
  });

  it('sin configuración de entorno no se intenta validar nada', async () => {
    // Se distingue de una forma inesperada: no hay servidor al que preguntar, y la
    // pantalla que toca es la de configuración, no un error de datos.
    mockGetSupabase.mockReturnValue(null);
    const error = await selectRows(sesionSchema, () => respuesta({})).catch((e: unknown) => e);
    expect(adminErrorKind(error)).toBe('notConfigured');
  });
});
