import { HttpsError } from 'firebase-functions/v2/https';

import {
  BREAK_REASONS,
  breakTypeForReason,
  requiresNote,
  type BreakReason,
} from '../../../src/domain/break-reason';
import {
  EARLY_DEPARTURE_REASONS,
  requiresDepartureNote,
  type EarlyDepartureReason,
} from '../../../src/domain/early-departure-reason';
import { politicasDe } from './politicas';

/**
 * LO QUE MANDA EL RELOJ, COMPROBADO EN EL SERVIDOR (auditoría, 4-oct).
 *
 * El servidor guardaba tal cual el motivo de la pausa, su nota y si era pagada: un aparato
 * con una versión vieja —o un JSON escrito a mano— podía decir que la comida era pagada
 * aunque la sede no la pagara, o mandar «Otro» sin explicar qué. Son minutos que se pagan,
 * así que lo decide el servidor con las mismas listas del cliente (`src/domain/`):
 *
 *   - el tipo de fichaje, uno de los cuatro;
 *   - la pausa: su motivo de la lista, la nota si es «Otro», y si es PAGADA según las reglas
 *     de la sede —lo que diga el aparato no cuenta—;
 *   - la salida anticipada: su motivo de la lista y la nota si es «Otro».
 *
 * Lo que no corresponde al tipo de fichaje se descarta: un motivo de pausa en una entrada
 * no es nada.
 */
export const TIPOS_DE_FICHAJE = ['clock_in', 'clock_out', 'break_start', 'break_end'] as const;
export type TipoDeFichaje = (typeof TIPOS_DE_FICHAJE)[number];

/** Una nota es una frase, no un documento. */
export const NOTA_MAXIMA = 300;

export type DatosDelFichaje = {
  eventType: TipoDeFichaje;
  breakType: 'paid' | 'unpaid' | null;
  breakReason: BreakReason | null;
  breakNote: string | null;
  departureReason: EarlyDepartureReason | null;
  departureNote: string | null;
};

const texto = (valor: unknown): string | null => {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio.slice(0, NOTA_MAXIMA);
};

function rechazo(mensaje: string, motivo: string): HttpsError {
  return new HttpsError('invalid-argument', mensaje, { motivo });
}

export function datosDelFichaje(
  crudo: Record<string, unknown>,
  sede: Record<string, unknown>,
): DatosDelFichaje {
  const eventType = String(crudo.eventType ?? '') as TipoDeFichaje;
  if (!TIPOS_DE_FICHAJE.includes(eventType)) {
    throw rechazo('Ese tipo de fichaje no existe.', 'TIPO');
  }

  let breakType: DatosDelFichaje['breakType'] = null;
  let breakReason: BreakReason | null = null;
  let breakNote: string | null = null;
  if (eventType === 'break_start') {
    const motivo = texto(crudo.breakReason);
    if (motivo !== null) {
      if (!(BREAK_REASONS as readonly string[]).includes(motivo)) {
        throw rechazo('Ese motivo de pausa no existe.', 'MOTIVO_DE_PAUSA');
      }
      breakReason = motivo as BreakReason;
    }
    breakNote = texto(crudo.breakNote);
    if (breakReason !== null && requiresNote(breakReason) && breakNote === null) {
      throw rechazo('Con «Otro» hay que decir el motivo de la pausa.', 'NOTA_DE_PAUSA');
    }
    // Sin motivo, no pagada: es lo prudente con minutos que se cobran.
    breakType =
      breakReason === null
        ? 'unpaid'
        : breakTypeForReason(breakReason, politicasDe(sede).paidBreakReasons);
  }

  let departureReason: EarlyDepartureReason | null = null;
  let departureNote: string | null = null;
  if (eventType === 'clock_out') {
    const motivo = texto(crudo.departureReason);
    if (motivo !== null) {
      if (!(EARLY_DEPARTURE_REASONS as readonly string[]).includes(motivo)) {
        throw rechazo('Ese motivo de salida no existe.', 'MOTIVO_DE_SALIDA');
      }
      departureReason = motivo as EarlyDepartureReason;
    }
    departureNote = texto(crudo.departureNote);
    if (
      departureReason !== null &&
      requiresDepartureNote(departureReason) &&
      departureNote === null
    ) {
      throw rechazo('Con «Otro» hay que decir por qué se va.', 'NOTA_DE_SALIDA');
    }
  }

  return { eventType, breakType, breakReason, breakNote, departureReason, departureNote };
}

/** Lo que se tolera de reloj adelantado en un fichaje sin red. */
export const MARGEN_FUTURO_MS = 5 * 60_000;

/**
 * LA HORA DE UN FICHAJE SIN RED (auditoría, 4-oct): la del aparato, que es la única que
 * hay, pero tiene que ser una fecha y no estar en el futuro. `null` si no vale: el lote la
 * deja «por revisar» en vez de guardarla —o de perderla—.
 */
export function horaDelFichajeSinRed(valor: unknown, ahora: number = Date.now()): string | null {
  if (typeof valor !== 'string') return null;
  const ms = Date.parse(valor);
  if (Number.isNaN(ms) || ms > ahora + MARGEN_FUTURO_MS) return null;
  return new Date(ms).toISOString();
}
