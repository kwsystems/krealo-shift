import type { ShiftRow } from '@/features/schedules/api';
import {
  aprobadasPorDia,
  claveDelDia,
  esPosibleHoraExtra,
  leerHorasYMinutos,
  minutosDeMas,
  planificadoPorDia,
} from '../horas-extra';

/**
 * Cuándo la app AVISA de una posible hora extra (30-sep). Cada caso es una frase de
 * Andree: «entrar 10 minutos antes es normal, hasta 15; eso no es extra», «la hora extra
 * es cuando veo que marcó dos horas de más». Y el que el umbral de 8 h no veía: un turno
 * programado de 12 horas que se cumple no es extra.
 */

const LIMA = 'America/Lima';

function turno(parcial: Partial<ShiftRow> = {}): ShiftRow {
  return {
    id: 't1',
    employee_id: 'ana',
    location_id: 'sede',
    job_role_id: null,
    // 10:00 a 19:00 en Lima, con una hora de refrigerio: 8 h planificadas.
    starts_at: '2026-09-21T15:00:00.000Z',
    ends_at: '2026-09-22T00:00:00.000Z',
    timezone: LIMA,
    planned_unpaid_break_minutes: 60,
    employee_note: null,
    manager_note: null,
    status: 'published',
    publication_version: 1,
    published_at: null,
    updated_at: '',
    ...parcial,
  };
}

const UMBRAL = 60;

describe('lo planificado de cada persona cada día', () => {
  it('es la duración del turno menos su refrigerio, en el día de la sede', () => {
    const plan = planificadoPorDia([turno()], LIMA);
    // Termina a medianoche en UTC pero es el día 21 en Lima.
    expect(plan.get(claveDelDia('ana', '2026-09-21'))).toBe(480);
  });

  it('suma los dos tramos de un turno partido', () => {
    const plan = planificadoPorDia(
      [
        turno({ id: 'a', ends_at: '2026-09-21T18:00:00.000Z', planned_unpaid_break_minutes: 0 }),
        turno({
          id: 'b',
          starts_at: '2026-09-21T22:00:00.000Z',
          ends_at: '2026-09-22T02:00:00.000Z',
          planned_unpaid_break_minutes: 0,
        }),
      ],
      LIMA,
    );
    expect(plan.get(claveDelDia('ana', '2026-09-21'))).toBe(180 + 240);
  });

  it('un borrador nunca publicado no es plan de nadie', () => {
    expect(planificadoPorDia([turno({ status: 'draft', publication_version: 0 })], LIMA).size).toBe(
      0,
    );
    // El publicado que se editó sin republicar sí (8-oct): el servidor lo mide contra él.
    expect(planificadoPorDia([turno({ status: 'draft', publication_version: 1 })], LIMA).size).toBe(
      1,
    );
  });
});

describe('el aviso de posible hora extra', () => {
  it('diez o quince minutos de más no avisan: es lo normal', () => {
    expect(esPosibleHoraExtra(minutosDeMas(490, 480), UMBRAL)).toBe(false);
    expect(esPosibleHoraExtra(minutosDeMas(495, 480), UMBRAL)).toBe(false);
  });

  it('una hora de más, sí', () => {
    expect(minutosDeMas(540, 480)).toBe(60);
    expect(esPosibleHoraExtra(60, UMBRAL)).toBe(true);
  });

  it('un turno programado de 12 h que se cumple no avisa, por largo que sea', () => {
    const plan = planificadoPorDia(
      [turno({ ends_at: '2026-09-22T03:00:00.000Z' })], // 10:00 a 22:00, 11 h netas
      LIMA,
    );
    const deMas = minutosDeMas(660, plan.get(claveDelDia('ana', '2026-09-21')));
    expect(deMas).toBe(0);
    expect(esPosibleHoraExtra(deMas, UMBRAL)).toBe(false);
  });

  it('sin turno ese día, todo lo trabajado es de más', () => {
    expect(minutosDeMas(240, undefined)).toBe(240);
  });

  it('quien sale antes no tiene minutos de más, ni negativos', () => {
    expect(minutosDeMas(400, 480)).toBe(0);
  });

  it('con el aviso en cero, cualquier minuto de más avisa; nunca un día sin nada', () => {
    expect(esPosibleHoraExtra(1, 0)).toBe(true);
    expect(esPosibleHoraExtra(0, 0)).toBe(false);
  });
});

describe('lo aprobado', () => {
  it('una cifra por persona y día', () => {
    const mapa = aprobadasPorDia([
      {
        id: 'x',
        employee_id: 'ana',
        location_id: 'sede',
        work_date: '2026-09-21',
        minutes: 90,
        approved_by: 'uid',
        updated_at: null,
      },
    ]);
    expect(mapa.get(claveDelDia('ana', '2026-09-21'))).toBe(90);
    expect(mapa.get(claveDelDia('ana', '2026-09-22'))).toBeUndefined();
  });
});

describe('lo que se escribe en el campo', () => {
  it('«1:30» y «90» son lo mismo; vacío es quitarla', () => {
    expect(leerHorasYMinutos('1:30')).toBe(90);
    expect(leerHorasYMinutos('90')).toBe(90);
    expect(leerHorasYMinutos(' ')).toBe(0);
  });

  /*
   * «1» ES UNA HORA (8-oct). Andree escribía «1» y se guardaba un minuto: el caso «sin
   * refrigerio» de una vendedora no se iba nunca. «1,5» es hora y media; la hoja dice debajo cómo lo
   * guarda, así que ya no se adivina en silencio.
   */
  it('«1» es una hora y «1,5» hora y media, no minutos', () => {
    expect(leerHorasYMinutos('1')).toBe(60);
    expect(leerHorasYMinutos('2')).toBe(120);
    expect(leerHorasYMinutos('1,5')).toBe(90);
    expect(leerHorasYMinutos('1.5')).toBe(90);
    expect(leerHorasYMinutos('1 h')).toBe(60);
    expect(leerHorasYMinutos('45')).toBe(45);
  });

  it('lo que no es una duración no vale', () => {
    expect(leerHorasYMinutos('1:75')).toBeNull();
    expect(leerHorasYMinutos('una hora')).toBeNull();
    expect(leerHorasYMinutos('-30')).toBeNull();
  });
});
