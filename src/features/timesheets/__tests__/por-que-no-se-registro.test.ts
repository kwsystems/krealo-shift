import type { TFunction } from 'i18next';

import { AdminError } from '@/hooks/use-admin-query';

import { porQueNoSeRegistro } from '../por-que-no-se-registro';

const t = ((clave: string) => `[${clave}]`) as unknown as TFunction;

describe('porQueNoSeRegistro', () => {
  it('enseña el motivo que escribió el servidor, no «revisa las horas»', () => {
    const error = new AdminError(
      'server',
      'Ya figura dentro desde el 21/10 a las 10:02 y esa entrada no tiene salida.',
      'functions/failed-precondition',
    );
    expect(porQueNoSeRegistro(t, error)).toBe(
      'Ya figura dentro desde el 21/10 a las 10:02 y esa entrada no tiene salida.',
    );
  });

  it('un código sin palabras no se le enseña a nadie', () => {
    expect(porQueNoSeRegistro(t, new AdminError('server', 'UNEXPECTED_SHAPE', 'shape'))).toBe(
      '[timesheet.absences.failed]',
    );
    expect(porQueNoSeRegistro(t, new AdminError('server', 'internal', 'internal'))).toBe(
      '[timesheet.absences.failed]',
    );
  });

  it('sin red lo dice así', () => {
    expect(porQueNoSeRegistro(t, new AdminError('offline', 'Failed to fetch'))).toBe(
      '[errors.network]',
    );
  });
});
