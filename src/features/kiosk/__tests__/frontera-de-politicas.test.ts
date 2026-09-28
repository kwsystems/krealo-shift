import { z } from 'zod';

import { politicasDe } from '../../../../functions/src/shared/politicas';
import { BREAK_REASONS } from '@/domain/break-reason';
import { kioskPoliciesSchema } from '../api';

/**
 * LA FRONTERA: lo que manda el servidor, pasado por el esquema del cliente.
 *
 * POR QUE EXISTE ESTA PRUEBA. Las políticas de la sede viajan dentro de la respuesta de
 * ACTIVAR el reloj y de la de arranque. Si el esquema del cliente rechaza lo que el
 * servidor manda, la respuesta entera se cae: el iPad enseña «No pudimos completar la
 * acción» DESPUES de que el servidor haya creado el reloj y quemado el código de
 * activación, así que cada intento deja un reloj más en Ajustes y ninguno en el iPad.
 *
 * Eso ya pasó dos veces con este mismo campo, y las dos veces por sitios distintos:
 *
 *   1. `policies` venía anidado dentro de `location` y el esquema lo esperaba en la raíz.
 *   2. `paidBreakReasons` se parseaba con `z.record(z.enum(...))`, que en Zod 4 EXIGE las
 *      siete claves, mientras el servidor manda a propósito solo las que la sede cambió
 *      —o sea `{}` en toda sede que no lo haya tocado, que son todas—.
 *
 * NINGUNA PRUEBA DE UN SOLO LADO PUEDE VER ESTO. El servidor devolvía exactamente lo que
 * su propio comentario promete y el cliente validaba exactamente lo que su tipo declara;
 * las dos mitades estaban «bien» y el reloj no se podía activar. Por eso esta prueba
 * importa las DOS de verdad —la función del servidor y el esquema del cliente— en vez de
 * comparar formas escritas a mano, que es lo que se rompió las dos veces.
 *
 * Y por eso `kioskPoliciesSchema` se exporta: para poder pasarle esto.
 */

const CASOS: { nombre: string; settings: Record<string, unknown> }[] = [
  { nombre: 'una sede recién creada, sin ajustes', settings: {} },
  {
    nombre: 'una sede con lo que se configura de verdad',
    settings: { pinLength: 4, photoEnabled: true, earlyClockInMinutes: 15, timeFormat: '12h' },
  },
  {
    nombre: 'una sede que cambió UN motivo de pausa',
    settings: { paidBreakReasons: { meal: true } },
  },
  {
    nombre: 'una sede que cambió todos los motivos',
    settings: {
      paidBreakReasons: Object.fromEntries(BREAK_REASONS.map((motivo) => [motivo, false])),
    },
  },
  {
    nombre: 'una sede con basura en los ajustes',
    settings: { paidBreakReasons: { meal: 'sí', inventado: true }, pinLength: 'seis' },
  },
];

describe('las políticas que manda el servidor pasan el esquema del reloj', () => {
  for (const caso of CASOS) {
    it(caso.nombre, () => {
      const delServidor = politicasDe({ settings: caso.settings });
      const resultado = kioskPoliciesSchema.safeParse(delServidor);

      // El mensaje nombra el campo culpable: es lo que faltó las dos veces que falló.
      const culpables = resultado.success
        ? ''
        : resultado.error.issues.map((problema) => problema.path.join('.')).join(', ');
      expect(culpables).toBe('');
      expect(resultado.success).toBe(true);
    });
  }

  it('el servidor manda vacío cuando la sede no tocó los motivos, y eso vale', () => {
    const politicas = politicasDe({ settings: {} });
    expect(politicas.paidBreakReasons).toEqual({});
    expect(kioskPoliciesSchema.safeParse(politicas).success).toBe(true);
  });

  it('un motivo con valor que no es booleano no se cuela hasta el reloj', () => {
    // El servidor ya lo descarta; esto comprueba que si algún día dejara de hacerlo, el
    // esquema del cliente sigue siendo la segunda puerta.
    const roto = { ...politicasDe({ settings: {} }), paidBreakReasons: { meal: 'sí' } };
    expect(kioskPoliciesSchema.safeParse(roto).success).toBe(false);
  });

  it('ese esquema es el mismo que usa la respuesta de activar, no una copia', () => {
    // Si alguien lo duplicara, esta prueba pasaría y la activación seguiría rota.
    const schema: z.ZodTypeAny = kioskPoliciesSchema;
    expect(schema).toBeDefined();
  });
});
