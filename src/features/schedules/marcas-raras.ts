import {
  esMarcaFueraDelTurno,
  minutosFueraDelTurno,
  type MarcaFueraDelTurno,
} from '@/domain/fuera-del-turno';
import type { WorkSession } from '@/features/timesheets/api';
import { claveDelDia } from '@/features/timesheets/horas-extra';

import type { ShiftRow } from './api';
import { dateKeyOf, type DateKey } from './week';

/**
 * LAS MARCAS RARAS DE LA SEMANA, para el aviso de Horario (Andree, 1-oct).
 *
 * El servidor apunta en cada jornada si entró una hora o más antes de su turno o salió una
 * hora o más después (`early_arrival`, `late_departure`: ver `src/domain/fuera-del-turno.ts`).
 * Esto decide cuáles quedan por mirar. Un aviso se va por cualquiera de las cosas que
 * Andree dijo que haría con él —«ya veo yo si cambio de horario o es hora extra»—:
 *
 *   - CAMBIAR EL HORARIO: al publicar, el servidor vuelve a medir la jornada contra el
 *     turno nuevo y la marca desaparece sola. Aquí no hay que hacer nada.
 *   - DECIDIR LA HORA EXTRA de ese día en Horas, sea cual sea: aprobarla o «no es extra»
 *     (0 minutos). Cualquier fila de aprobación cuenta como decidido.
 *   - «ESTÁ BIEN ASÍ», también en Horas: queda en `avisos_vistos`, marca por marca.
 *
 * DECIDIR ES SOLO EN HORAS (6-oct). «Debería centrarse solo en Horas», dijo Andree al ver
 * el mismo caso pedir respuesta en dos pantallas. Horario avisa y lleva a «Por resolver».
 *
 * PURA, para poder probar cada salida sin una pantalla delante.
 */

export type MarcaRara = {
  /** Única por jornada y marca: una jornada puede tener las dos. */
  id: string;
  sesion: WorkSession;
  /** El turno contra el que se midió, si está en la semana que se mira. */
  turno: ShiftRow | null;
  marca: MarcaFueraDelTurno;
  /** Cuánto antes entró o cuánto después salió. 0 si no se sabe el turno. */
  minutos: number;
  dia: DateKey;
  /**
   * Si ese día de esa persona aún tiene una jornada sin salida. Mientras siga abierto no
   * se sabe si habrá hora extra, así que Horas no lo pone en «Por resolver» todavía.
   */
  diaAbierto: boolean;
};

export function marcasRarasDeLaSemana(params: {
  sesiones: readonly WorkSession[];
  turnos: readonly ShiftRow[];
  /** Personas y días con horas extra ya decididas en Horas: `claveDelDia`. */
  conExtraDecidida: ReadonlySet<string>;
  timezone: string;
}): MarcaRara[] {
  const turnoPorId = new Map(params.turnos.map((turno) => [turno.id, turno]));
  const abiertos = new Set(
    params.sesiones
      .filter((sesion) => sesion.ends_at === null)
      .map((sesion) =>
        claveDelDia(sesion.employee_id, dateKeyOf(sesion.starts_at, params.timezone)),
      ),
  );
  const raras: MarcaRara[] = [];

  for (const sesion of params.sesiones) {
    const dia = dateKeyOf(sesion.starts_at, params.timezone);
    if (params.conExtraDecidida.has(claveDelDia(sesion.employee_id, dia))) continue;
    const turno = sesion.shift_id === null ? null : (turnoPorId.get(sesion.shift_id) ?? null);
    const fuera =
      turno === null
        ? null
        : minutosFueraDelTurno({ entrada: sesion.starts_at, salida: sesion.ends_at, turno });

    for (const marca of sesion.flags) {
      if (!esMarcaFueraDelTurno(marca) || sesion.avisos_vistos.includes(marca)) continue;
      raras.push({
        id: `${sesion.id}:${marca}`,
        sesion,
        turno,
        marca,
        minutos: fuera === null ? 0 : marca === 'early_arrival' ? fuera.antes : fuera.despues,
        dia,
        diaAbierto: abiertos.has(claveDelDia(sesion.employee_id, dia)),
      });
    }
  }

  return raras.sort((a, b) => a.sesion.starts_at.localeCompare(b.sesion.starts_at));
}

/** «1 h 20 min», «2 h», «45 min»: cuánto fuera del turno, dicho para leerlo. */
export function duracionLegible(minutos: number): { horas: number; minutos: number } {
  const total = Math.max(0, Math.round(minutos));
  return { horas: Math.floor(total / 60), minutos: total % 60 };
}
