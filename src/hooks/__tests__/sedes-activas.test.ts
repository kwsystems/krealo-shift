import { sedeElegida, sedesActivas } from '@/hooks/use-manager-scope';

/**
 * Una sede desactivada no sale en ninguna pantalla.
 *
 * Lo pidió Andree el 29-sep: desactivó «Asia» y seguía saliendo en los filtros de Equipo
 * y en la cabecera. Desactivar solo cambiaba la etiqueta en Ajustes; todas las pantallas
 * leían la lista entera. Ahora el alcance ofrece solo las activas y Ajustes, que es donde
 * se reactiva, lee todas.
 */

const LIMA = { id: 'lima', name: 'Lima', is_active: true };
const ASIA = { id: 'asia', name: 'Asia', is_active: false };
const NORTE = { id: 'norte', name: 'Norte', is_active: true };

describe('sedesActivas', () => {
  it('deja fuera las desactivadas y conserva el orden de las demás', () => {
    expect(sedesActivas([ASIA, LIMA, NORTE])).toEqual([LIMA, NORTE]);
  });

  it('sin ninguna activa no devuelve ninguna', () => {
    expect(sedesActivas([ASIA])).toEqual([]);
  });
});

describe('sedeElegida', () => {
  it('la elegida, si sigue abierta', () => {
    expect(sedeElegida([LIMA, NORTE], 'norte')).toBe('norte');
  });

  it('si la elegida se acaba de cerrar, pasa a la primera abierta', () => {
    // El caso del 29-sep: estabas mirando Asia y la cierras. El panel no se queda en ella.
    expect(sedeElegida(sedesActivas([ASIA, LIMA]), 'asia')).toBe('lima');
  });

  it('sin elección, la primera abierta, aunque la primera de la lista esté cerrada', () => {
    // Antes caía en la primera de la lista si no había activa, y la lista va por nombre:
    // «Asia» va antes que «Lima».
    expect(sedeElegida(sedesActivas([ASIA, LIMA]), null)).toBe('lima');
  });

  it('con todas cerradas no elige ninguna, en vez de enseñar una cerrada', () => {
    expect(sedeElegida(sedesActivas([ASIA]), null)).toBeNull();
    expect(sedeElegida(sedesActivas([ASIA]), 'asia')).toBeNull();
  });
});
