import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatKioskDiagnostics, type KioskDiagnostics } from '../diagnostics';

const base: KioskDiagnostics = {
  devicePublicId: 'kd_7f3a91',
  locationName: 'Sede Principal',
  timezone: 'America/Lima',
  appVersion: '1.0.0',
  online: true,
  pendingCount: 3,
  needsReviewCount: 1,
  lastSyncAt: '2026-08-28T15:00:00.000Z',
  lastSyncError: null,
  screenAwake: true,
  cameraPermission: 'granted',
  notificationsPermission: 'denied',
  generatedAt: '2026-08-28T15:30:00.000Z',
};

/**
 * Diagnóstico copiable del kiosco (§31).
 *
 * §31 pide el botón desde el principio, y existían la etiqueta traducida y un
 * docstring que ya afirmaba que se podía copiar. No se podía: no había botón ni
 * función. Lo que se fija aquí son las dos mitades: que lleva lo que §31 enumera, y
 * que NO puede llevar datos personales.
 */
describe('diagnóstico del kiosco', () => {
  it('lleva todo lo que §31 enumera', () => {
    const texto = formatKioskDiagnostics(base);

    // Los ocho puntos de la lista de §31.
    expect(texto).toContain('app version: 1.0.0');
    expect(texto).toContain('device id: kd_7f3a91');
    expect(texto).toContain('location: Sede Principal');
    expect(texto).toContain('last sync: 2026-08-28T15:00:00.000Z');
    expect(texto).toContain('queued events: 3');
    expect(texto).toContain('online: si');
    expect(texto).toContain('camera permission: granted');
    expect(texto).toContain('notifications permission: denied');
  });

  it('un dato que falta se dice, no desaparece de la lista', () => {
    // Un diagnóstico al que le faltan líneas hace pensar que la app es más vieja de
    // lo que es. Cada campo aparece siempre, con guion si no se sabe.
    const texto = formatKioskDiagnostics({
      ...base,
      devicePublicId: null,
      lastSyncAt: null,
      screenAwake: null,
      cameraPermission: null,
    });

    expect(texto).toContain('device id: -');
    expect(texto).toContain('last sync: -');
    expect(texto).toContain('screen awake: -');
    expect(texto).toContain('camera permission: -');
    expect(texto.split('\n')).toHaveLength(14);
  });

  it('una cadena vacía también cuenta como dato que falta', () => {
    // Es el caso real: un `displayName` sin poner llega como '' y no como null, y
    // "location: " a secas parece un fallo del formato en vez de un dato ausente.
    expect(formatKioskDiagnostics({ ...base, locationName: '   ' })).toContain('location: -');
  });

  it('NO PUEDE llevar datos personales: el tipo de entrada está cerrado', () => {
    /*
     * "Sin datos personales" es una propiedad, no una intención, y se garantiza
     * limitando lo que se puede escribir. Si esto fuera un volcado de la pantalla,
     * cualquier fila nueva —el nombre de quien acaba de fichar, por ejemplo— se
     * colaría sola en el texto que alguien pega en un correo.
     *
     * Se comprueba leyendo el módulo: ni el tipo ni el formateador nombran a una
     * persona, su PIN o su foto. Es feo comprobarlo así, y es lo que hace que añadir
     * uno de esos campos falle aquí en vez de pasar inadvertido.
     */
    const modulo = readFileSync(join(__dirname, '../diagnostics.ts'), 'utf8');

    // Solo el tipo y el formateador. Los comentarios SÍ hablan de fotos y de PINes,
    // porque explican por qué no están.
    const codigo = modulo
      .split('\n')
      .filter((linea) => !/^\s*(\*|\/\*|\/\/)/.test(linea))
      .join('\n');

    /*
     * Se comparan IDENTIFICADORES, no subcadenas. Buscar la subcadena "pin" acusaría
     * a un `mapping` perfectamente inocente que alguien añada mañana, y una prueba
     * que acusa al código correcto se acaba borrando en vez de arreglando.
     */
    const identificadores = new Set(
      (codigo.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map((x) => x.toLowerCase()),
    );
    const prohibidos = [
      'employeename',
      'employee_name',
      'fullname',
      'firstname',
      'lastname',
      'pin',
      'photo',
      'photopath',
      'email',
      'phone',
      'note',
      'notes',
    ];

    expect(prohibidos.filter((campo) => identificadores.has(campo))).toEqual([]);
  });

  it('el botón existe de verdad en la pantalla de salida', () => {
    // La etiqueta traducida y el docstring existían desde el principio; el botón no.
    const pantalla = readFileSync(join(__dirname, '../../../../app/kiosk/exit.tsx'), 'utf8');
    expect(pantalla).toContain('kiosk-copy-diagnostics');
    expect(pantalla).toContain('formatKioskDiagnostics');
  });
});
