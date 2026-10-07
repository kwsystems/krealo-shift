import { seRefrescaSola } from '../use-datos-al-dia';
import { paqueteDelDocumento } from '../use-version-nueva';

/**
 * Sin F5 (7-oct): qué se vuelve a pedir solo cada minuto, y cómo se sabe que hay una versión
 * nueva de la app. Lo de punta a punta —Inicio al día con marcas que llegan, el aviso de
 * versión— lo comprueba `scripts/al-dia-check.mjs`.
 */
describe('qué se pone al día solo', () => {
  const clave = (...queryKey: unknown[]) => ({ queryKey });

  it('lo que enseñan las pantallas, sí', () => {
    for (const k of [
      clave('timesheet', 'sessions', 'sede'),
      clave('schedule', 'week', 'sede', '2026-10-05'),
      clave('dashboard', 'sede'),
      clave('requests', 'sede'),
      clave('team', 'upcomingShifts', 'e1'),
      clave('portal', 'semana'),
    ]) {
      expect(seRefrescaSola(k, false)).toBe(true);
    }
  });

  it('Reportes solo en las vueltas que tocan', () => {
    expect(seRefrescaSola(clave('reports', 'mes'), false)).toBe(false);
    expect(seRefrescaSola(clave('reports', 'mes'), true)).toBe(true);
  });

  it('lo que escribe en el servidor o no cambia solo, nunca', () => {
    for (const k of [
      clave('revision-de-jornadas', 'sede', '2026-10-05', '2026-10-11'),
      clave('manager', 'scope'),
      clave('settings', 'sede'),
      clave('push'),
      clave('schedule', 'cumplido', 'sede', []),
      clave('schedule', 'inicio-del-reloj', 'org', 'sede', 'America/Lima'),
    ]) {
      expect(seRefrescaSola(k, true)).toBe(false);
    }
  });
});

describe('la versión de la app', () => {
  it('lee el paquete que nombra el documento de entrada', () => {
    const html =
      '<script src="/_expo/static/js/web/entry-bf9ed5c79db46c458468e041ec5e912e.js" defer></script>';
    expect(paqueteDelDocumento(html)).toBe(
      '/_expo/static/js/web/entry-bf9ed5c79db46c458468e041ec5e912e.js',
    );
  });

  it('un documento sin paquete (desarrollo, un error del servidor) no dice nada', () => {
    expect(paqueteDelDocumento('<html><body>Error</body></html>')).toBeNull();
  });
});
