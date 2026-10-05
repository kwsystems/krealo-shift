import { create } from 'zustand';

import type { MarcaDeAviso } from './api';

/**
 * EL ESTADO DE LOS AVISOS (5-oct), compartido por la campana y el aviso emergente.
 *
 * UN SOLO VIGÍA LO LLENA (`useVigiaDeAvisos`, montado una vez en el panel) y las dos piezas
 * solo lo leen. Con una consulta por pieza, la campana y el emergente se enterarían de
 * la misma marca en momentos distintos, y la sede pagaría dos lecturas por cada vuelta.
 */

/** Cuántas marcas guarda la campana. Un día de tienda no llega; si llegara, se van las viejas. */
export const MAXIMO_EN_LA_CAMPANA = 150;
/** Cuántos emergentes a la vez: más tapan la pantalla que pretenden avisar. */
export const MAXIMO_EMERGENTES = 3;

/**
 * Junta lo que ya había con lo que acaba de llegar: sin repetir (la última consulta
 * devuelve otra vez la marca del cursor), en orden de llegada, desde `desde` en adelante
 * (lo de ayer sale de la campana al cambiar el día) y sin pasar del máximo.
 *
 * Devuelve también cuáles eran NUEVAS DE VERDAD, que son las únicas que pueden avisar.
 */
export function juntarMarcas(
  previas: readonly MarcaDeAviso[],
  llegadas: readonly MarcaDeAviso[],
  desde: string,
): { marcas: MarcaDeAviso[]; nuevas: MarcaDeAviso[] } {
  const vistas = new Set(previas.map((marca) => marca.id));
  const nuevas = llegadas.filter((marca) => !vistas.has(marca.id));
  const marcas = [...previas, ...nuevas]
    .filter((marca) => marca.received_at >= desde)
    .sort((a, b) =>
      a.received_at === b.received_at
        ? a.occurred_at.localeCompare(b.occurred_at)
        : a.received_at.localeCompare(b.received_at),
    )
    .slice(-MAXIMO_EN_LA_CAMPANA);
  return { marcas, nuevas };
}

/** Cuántas llegaron después de la última vista. Sin nada visto en esta sede, todas. */
export function contarSinVer(marcas: readonly MarcaDeAviso[], vistasHasta: string | undefined) {
  if (vistasHasta === undefined) return marcas.length;
  return marcas.filter((marca) => marca.received_at > vistasHasta).length;
}

/**
 * Los emergentes que quedan a la vista tras sumar los nuevos: los más recientes, como
 * mucho `MAXIMO_EMERGENTES`, y cuántos se quedaron sin salir. Una tanda grande —la pestaña
 * vuelve después de una hora— no se convierte en media minuto de avisos en fila: salen los
 * tres últimos y «y N avisos más».
 */
export function encolarEmergentes(
  visibles: readonly string[],
  sinMostrar: number,
  nuevos: readonly string[],
): { emergentes: string[]; sinMostrar: number } {
  const todos = [...visibles, ...nuevos];
  const sobran = Math.max(0, todos.length - MAXIMO_EMERGENTES);
  return { emergentes: todos.slice(sobran), sinMostrar: sinMostrar + sobran };
}

type EstadoDeAvisos = {
  /** La sede de la que son las marcas. Al cambiar de sede se empieza de cero. */
  sede: string | null;
  marcas: MarcaDeAviso[];
  cargado: boolean;
  error: boolean;
  /** Ids de las marcas con emergente a la vista, de la más vieja a la más nueva. */
  emergentes: string[];
  sinMostrar: number;
  panelAbierto: boolean;
  empezar: (sede: string) => void;
  recibir: (
    sede: string,
    llegadas: readonly MarcaDeAviso[],
    opciones: { desde: string; avisar: boolean },
  ) => void;
  fallo: (sede: string) => void;
  cerrarEmergente: (id: string) => void;
  abrirPanel: () => void;
  cerrarPanel: () => void;
};

export const useAvisosStore = create<EstadoDeAvisos>((set, get) => ({
  sede: null,
  marcas: [],
  cargado: false,
  error: false,
  emergentes: [],
  sinMostrar: 0,
  panelAbierto: false,

  empezar: (sede) => {
    if (get().sede === sede) return;
    set({ sede, marcas: [], cargado: false, error: false, emergentes: [], sinMostrar: 0 });
  },

  recibir: (sede, llegadas, { desde, avisar }) => {
    const estado = get();
    // Una respuesta que llega tarde, de la sede de antes, no se mezcla con la nueva.
    if (estado.sede !== sede) return;
    const { marcas, nuevas } = juntarMarcas(estado.marcas, llegadas, desde);
    // Con la campana abierta, lo nuevo ya se ve en la lista: un emergente encima sobra.
    const conEmergente = avisar && !estado.panelAbierto ? nuevas.map((marca) => marca.id) : [];
    const cola = encolarEmergentes(estado.emergentes, estado.sinMostrar, conEmergente);
    set({ marcas, cargado: true, error: false, ...cola });
  },

  fallo: (sede) => {
    if (get().sede !== sede) return;
    set({ error: true });
  },

  cerrarEmergente: (id) => {
    const emergentes = get().emergentes.filter((otro) => otro !== id);
    // El «y N más» se va con el último: sin avisos a la vista no tiene a qué sumarse.
    set({ emergentes, sinMostrar: emergentes.length === 0 ? 0 : get().sinMostrar });
  },

  abrirPanel: () => set({ panelAbierto: true, emergentes: [], sinMostrar: 0 }),
  cerrarPanel: () => set({ panelAbierto: false }),
}));
