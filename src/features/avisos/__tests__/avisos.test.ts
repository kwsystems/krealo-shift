import type { TFunction } from 'i18next';

import es from '@/i18n/locales/es-PE.json';
import type { MarcaDeAviso } from '../api';
import {
  contarSinVer,
  encolarEmergentes,
  juntarMarcas,
  MAXIMO_EN_LA_CAMPANA,
  useAvisosStore,
} from '../avisos-store';
import { claseDeAviso, etiquetaDeClase, textoDelAviso } from '../textos-de-avisos';
import { inicioDelDia } from '../use-vigia-de-avisos';

/**
 * LOS AVISOS DEL PANEL (5-oct). Andree: «cuando alguien marca, cuando alguien va a comer, a
 * mí me debe salir una notificación arriba a la derecha y también un popup arriba».
 */
const t = ((clave: string, valores: Record<string, unknown> = {}) => {
  const texto = clave
    .split('.')
    .reduce<unknown>((nodo, parte) => (nodo as Record<string, unknown> | undefined)?.[parte], es);
  return String(texto ?? clave).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(valores[k] ?? ''),
  );
}) as unknown as TFunction;

function marca(id: string, recibida: string, cambios: Partial<MarcaDeAviso> = {}): MarcaDeAviso {
  return {
    id,
    employee_id: 'ana',
    event_type: 'clock_in',
    reclassified_as: null,
    break_type: null,
    break_reason: null,
    occurred_at: recibida,
    received_at: recibida,
    is_offline: false,
    ...cambios,
  };
}

describe('qué dice cada aviso', () => {
  it('entrada, salida y vuelta', () => {
    expect(textoDelAviso(t, marca('1', 'x'), 'Ana')).toBe('Ana marcó su entrada');
    expect(textoDelAviso(t, marca('1', 'x', { event_type: 'clock_out' }), 'Ana')).toBe(
      'Ana marcó su salida',
    );
    expect(textoDelAviso(t, marca('1', 'x', { event_type: 'break_end' }), 'Ana')).toBe(
      'Ana volvió a trabajar',
    );
  });

  it('salir a comer es comer, también con el tipo viejo sin motivo', () => {
    const comida = marca('1', 'x', { event_type: 'break_start', break_reason: 'meal' });
    expect(textoDelAviso(t, comida, 'Ana')).toBe('Ana salió a comer');
    const vieja = marca('1', 'x', { event_type: 'break_start', break_type: 'meal' });
    expect(claseDeAviso(vieja)).toBe('comida');
  });

  it('descanso, y las demás pausas con su motivo del reloj', () => {
    const descanso = marca('1', 'x', { event_type: 'break_start', break_reason: 'rest' });
    expect(textoDelAviso(t, descanso, 'Ana')).toBe('Ana salió a su descanso');
    const permiso = marca('1', 'x', { event_type: 'break_start', break_reason: 'permit' });
    expect(textoDelAviso(t, permiso, 'Ana')).toBe('Ana hizo una pausa: Permiso');
  });

  it('un motivo desconocido u «otro» no enseña la palabra cruda', () => {
    const rara = marca('1', 'x', { event_type: 'break_start', break_reason: 'algo_nuevo' });
    expect(textoDelAviso(t, rara, 'Ana')).toBe('Ana hizo una pausa');
    const otro = marca('1', 'x', { event_type: 'break_start', break_reason: 'other' });
    expect(textoDelAviso(t, otro, 'Ana')).toBe('Ana hizo una pausa');
  });

  it('cuenta como lo que quien gestiona reclasificó', () => {
    const salida = marca('1', 'x', {
      event_type: 'clock_out',
      reclassified_as: 'break_start',
      break_reason: 'meal',
    });
    expect(textoDelAviso(t, salida, 'Ana')).toBe('Ana salió a comer');
  });

  it('el rótulo del aviso dice qué pasó, en corto (6-oct)', () => {
    const rotulo = (m: MarcaDeAviso) => etiquetaDeClase(t, claseDeAviso(m));
    expect(rotulo(marca('1', 'x'))).toBe('Entrada');
    expect(rotulo(marca('1', 'x', { event_type: 'break_start', break_reason: 'meal' }))).toBe(
      'Sale a comer',
    );
    expect(rotulo(marca('1', 'x', { event_type: 'break_end' }))).toBe('Vuelve');
    expect(rotulo(marca('1', 'x', { event_type: 'clock_out' }))).toBe('Salida');
  });

  it('sin nombre conocido, «Alguien del equipo»', () => {
    expect(textoDelAviso(t, marca('1', 'x'), undefined)).toBe(
      'Alguien del equipo marcó su entrada',
    );
    expect(textoDelAviso(t, marca('1', 'x'), '  ')).toBe('Alguien del equipo marcó su entrada');
  });
});

describe('la campana junta lo que llega', () => {
  const hoy = '2026-10-05T05:00:00.000Z';

  it('sin repetir la marca del cursor, en orden de llegada, y dice cuáles son nuevas', () => {
    const previas = [marca('a', '2026-10-05T14:00:00.000Z')];
    const llegadas = [
      marca('a', '2026-10-05T14:00:00.000Z'),
      marca('c', '2026-10-05T14:05:00.000Z'),
      marca('b', '2026-10-05T14:02:00.000Z'),
    ];
    const { marcas, nuevas } = juntarMarcas(previas, llegadas, hoy);
    expect(marcas.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(nuevas.map((m) => m.id)).toEqual(['c', 'b']);
  });

  it('lo de ayer sale al cambiar el día', () => {
    const previas = [marca('ayer', '2026-10-04T23:00:00.000Z')];
    const { marcas } = juntarMarcas(previas, [marca('hoy', '2026-10-05T06:00:00.000Z')], hoy);
    expect(marcas.map((m) => m.id)).toEqual(['hoy']);
  });

  it('no crece sin fin', () => {
    const muchas = Array.from({ length: MAXIMO_EN_LA_CAMPANA + 20 }, (_, i) =>
      marca(`m${i}`, new Date(Date.parse(hoy) + (i + 1) * 60_000).toISOString()),
    );
    const { marcas } = juntarMarcas([], muchas, hoy);
    expect(marcas).toHaveLength(MAXIMO_EN_LA_CAMPANA);
    expect(marcas[marcas.length - 1]?.id).toBe(`m${MAXIMO_EN_LA_CAMPANA + 19}`);
  });

  it('cuenta lo que llegó después de lo visto; sin nada visto, todo', () => {
    const marcas = [marca('a', '2026-10-05T14:00:00.000Z'), marca('b', '2026-10-05T14:10:00.000Z')];
    expect(contarSinVer(marcas, undefined)).toBe(2);
    expect(contarSinVer(marcas, '2026-10-05T14:00:00.000Z')).toBe(1);
    expect(contarSinVer(marcas, '2026-10-05T14:10:00.000Z')).toBe(0);
  });
});

describe('el aviso emergente', () => {
  it('como mucho tres, los más nuevos, y cuántos se quedaron sin salir', () => {
    expect(encolarEmergentes(['a'], 0, ['b'])).toEqual({ emergentes: ['a', 'b'], sinMostrar: 0 });
    expect(encolarEmergentes(['a', 'b'], 0, ['c', 'd', 'e'])).toEqual({
      emergentes: ['c', 'd', 'e'],
      sinMostrar: 2,
    });
  });

  beforeEach(() => {
    useAvisosStore.setState({
      sede: null,
      marcas: [],
      cargado: false,
      error: false,
      emergentes: [],
      sinMostrar: 0,
      panelAbierto: false,
    });
  });

  it('la primera respuesta llena la campana y no avisa; lo que llega después, sí', () => {
    const almacen = useAvisosStore.getState();
    almacen.empezar('sede-1');
    almacen.recibir('sede-1', [marca('a', '2026-10-05T14:00:00.000Z')], {
      desde: '2026-10-05T05:00:00.000Z',
      avisar: false,
    });
    expect(useAvisosStore.getState().emergentes).toEqual([]);
    useAvisosStore
      .getState()
      .recibir(
        'sede-1',
        [marca('a', '2026-10-05T14:00:00.000Z'), marca('b', '2026-10-05T14:01:00.000Z')],
        { desde: '2026-10-05T05:00:00.000Z', avisar: true },
      );
    expect(useAvisosStore.getState().emergentes).toEqual(['b']);
    expect(useAvisosStore.getState().marcas).toHaveLength(2);
  });

  it('una respuesta tardía de otra sede no se mezcla', () => {
    useAvisosStore.getState().empezar('sede-2');
    useAvisosStore.getState().recibir('sede-1', [marca('a', '2026-10-05T14:00:00.000Z')], {
      desde: '2026-10-05T05:00:00.000Z',
      avisar: true,
    });
    expect(useAvisosStore.getState().marcas).toEqual([]);
  });

  it('con la campana abierta no salen emergentes, y abrirla quita los que había', () => {
    const almacen = useAvisosStore.getState();
    almacen.empezar('sede-1');
    almacen.recibir('sede-1', [marca('a', '2026-10-05T14:00:00.000Z')], {
      desde: '2026-10-05T05:00:00.000Z',
      avisar: true,
    });
    expect(useAvisosStore.getState().emergentes).toEqual(['a']);
    useAvisosStore.getState().abrirPanel();
    expect(useAvisosStore.getState().emergentes).toEqual([]);
    useAvisosStore.getState().recibir('sede-1', [marca('b', '2026-10-05T14:01:00.000Z')], {
      desde: '2026-10-05T05:00:00.000Z',
      avisar: true,
    });
    expect(useAvisosStore.getState().emergentes).toEqual([]);
  });

  it('el «y N más» se va con el último emergente', () => {
    useAvisosStore.setState({ sede: 's', emergentes: ['a', 'b'], sinMostrar: 4 });
    useAvisosStore.getState().cerrarEmergente('a');
    expect(useAvisosStore.getState().sinMostrar).toBe(4);
    useAvisosStore.getState().cerrarEmergente('b');
    expect(useAvisosStore.getState().sinMostrar).toBe(0);
  });
});

describe('el día de la campana', () => {
  it('empieza a medianoche de la sede, no del navegador', () => {
    // 2 a. m. del 6 en UTC son las 9 p. m. del 5 en Lima.
    expect(inicioDelDia('America/Lima', new Date('2026-10-06T02:00:00.000Z'))).toBe(
      '2026-10-05T05:00:00.000Z',
    );
  });
});
