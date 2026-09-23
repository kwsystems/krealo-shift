import { DEFAULT_LOCATION_SETTINGS, inicioDeSemanaDe } from '@/hooks/use-manager-scope';
import { currentWeekStart, weekStartOfKey } from '@/features/schedules/week';

/**
 * De quién es el inicio de semana: de la sede si lo tiene puesto, y si no de la empresa.
 *
 * NO ES UN AJUSTE COSMÉTICO. Decide dónde empieza y acaba cada semana en Horario y en
 * Horas, o sea sobre qué rango se calculan las horas extra semanales. Con tiendas en dos
 * países la convención puede no coincidir, y una de las dos lo tendría mal.
 *
 * La resolución se sacó del hook a una función propia (`inicioDeSemanaDe`) justamente
 * para poder probarla: dentro del `return` de un hook con TanStack Query detrás no se
 * puede tocar sin montar medio mundo, y lo que salía era una prueba que reescribía la
 * regla al lado y pasaba aunque el hook hiciera otra cosa.
 */

/*
 * SE USA LA REGLA DE VERDAD, no una copia. La primera versión reescribía aquí la misma
 * expresión que hay dentro de `use-manager-scope`, y el control lo desmintió: haciendo
 * que el hook ignorara la sede, esta prueba seguía pasando tan contenta. Una regla
 * probada por su copia no está probada, y es peor que no probarla, porque da la
 * sensación de que sí.
 */
const resolver = inicioDeSemanaDe;

describe('de quién es el inicio de semana', () => {
  it('manda la sede cuando lo tiene puesto', () => {
    expect(resolver(0, 1)).toBe(0);
  });

  it('con la sede en «igual que la empresa», manda la empresa', () => {
    expect(resolver(null, 0)).toBe(0);
  });

  /**
   * EL CASO QUE IMPORTA PARA NO ROMPER NADA: una sede creada antes de que esto existiera
   * no trae el campo. Tiene que seguir a la empresa, no caer en el lunes de fábrica: una
   * empresa configurada a domingo vería cambiar sus semanas —y sus horas extra— sin que
   * nadie tocara nada.
   */
  it('una sede vieja, sin el campo, sigue a la empresa', () => {
    expect(resolver(undefined, 0)).toBe(0);
  });

  it('sin nada configurado, lunes', () => {
    expect(resolver(null, null)).toBe(1);
  });

  it('el domingo es 0 y no se confunde con «no configurado»', () => {
    // Si la resolución usara un `||` en vez de `??`, el domingo (0) caería a la empresa.
    expect(resolver(0, 3)).toBe(0);
    expect(resolver(null, 0)).toBe(0);
  });

  it('de fábrica una sede hereda: el valor por defecto es null', () => {
    expect(DEFAULT_LOCATION_SETTINGS.weekStartsOn).toBeNull();
  });
});

describe('qué cambia de verdad al cambiarlo', () => {
  it('dos sedes con inicios distintos parten la semana en días distintos', () => {
    // Miércoles 23 de septiembre de 2026.
    const miercoles = '2026-09-23';
    expect(weekStartOfKey(miercoles, 1)).toBe('2026-09-21'); // lunes
    expect(weekStartOfKey(miercoles, 0)).toBe('2026-09-20'); // domingo
  });

  it('y eso mueve el rango sobre el que se cuentan las horas de la semana', () => {
    const ahora = '2026-09-23T15:00:00.000Z';
    const conLunes = currentWeekStart(ahora, 1, 'America/Lima');
    const conDomingo = currentWeekStart(ahora, 0, 'America/Lima');
    expect(conLunes).not.toBe(conDomingo);
  });
});
