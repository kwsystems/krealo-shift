import type { TFunction } from 'i18next';

import es from '@/i18n/locales/es-PE.json';
import { esCumplidoEspecial, etiquetaDeCumplido, motivoDeCumplido } from '../textos-de-cumplido';

/**
 * Cómo se dice un turno cumplido por un motivo especial (4-oct). Un solo módulo, porque
 * Horario, Horas, Equipo, Reportes y el celular lo escriben igual: es la regla de Andree.
 */
/** Las claves de verdad, con `{{x}}` sustituido: lo que pinta la pantalla en español. */
const t = ((clave: string, valores: Record<string, unknown> = {}) => {
  const texto = clave
    .split('.')
    .reduce<unknown>((nodo, parte) => (nodo as Record<string, unknown> | undefined)?.[parte], es);
  return String(texto ?? clave).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(valores[k] ?? ''),
  );
}) as unknown as TFunction;

describe('textos del cumplido especial', () => {
  it('dice el motivo', () => {
    expect(etiquetaDeCumplido(t, { credit_reason: 'election_duty' })).toBe(
      'Cumplido · Miembro de mesa',
    );
  });

  it('con el comentario, solo donde se pide', () => {
    const jornada = { credit_reason: 'other', credit_note: 'Inventario en el almacén' };
    expect(etiquetaDeCumplido(t, jornada)).toBe('Cumplido · Otro motivo');
    expect(etiquetaDeCumplido(t, jornada, true)).toBe(
      'Cumplido · Otro motivo: «Inventario en el almacén»',
    );
  });

  it('un motivo de un servidor más nuevo no rompe nada: se dice genérico', () => {
    expect(motivoDeCumplido(t, 'algo_nuevo')).toBe('Motivo especial');
  });

  it('solo las jornadas con motivo son cumplidos especiales', () => {
    expect(esCumplidoEspecial({ credit_reason: 'training' })).toBe(true);
    expect(esCumplidoEspecial({ credit_reason: null })).toBe(false);
    expect(esCumplidoEspecial({})).toBe(false);
  });
});
