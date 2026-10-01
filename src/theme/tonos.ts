import { useTheme } from './use-theme';

/**
 * LOS TONOS DE COLOR DEL PANEL (1-oct). Andree: «utiliza más colores, que se vea mejor la
 * página», mirando Homebase, que pinta cada sección y cada puesto de su color.
 *
 * Cada tono trae CUATRO piezas pensadas para ir juntas, en claro y en oscuro:
 *   - `fondo`: el relleno suave de una píldora o una baldosa;
 *   - `borde`: su filo, un paso más marcado;
 *   - `tinta`: texto e icono SOBRE ese fondo, a 4,5:1 o más en los dos temas;
 *   - `solido`: el color lleno —la baldosa activa del menú, la franja de un turno—, que
 *     nunca lleva texto encima salvo en blanco o negro según el tema.
 *
 * NO SUSTITUYEN A LOS COLORES DE ESTADO (trabajando, descanso, tarde): esos siguen en
 * `tokens.ts`. Estos dicen QUÉ ES algo —una sección, un puesto, una clase de
 * disponibilidad—, no cómo va.
 */

export const TONOS = [
  'violeta',
  'azul',
  'turquesa',
  'verde',
  'ambar',
  'naranja',
  'rosa',
  'rojo',
  'pizarra',
] as const;
export type Tono = (typeof TONOS)[number];

export type PiezasDelTono = { fondo: string; borde: string; tinta: string; solido: string };

const CLARO: Record<Tono, PiezasDelTono> = {
  violeta: { fondo: '#F3F0FF', borde: '#C9BCFF', tinta: '#5B32C8', solido: '#7C5CE6' },
  azul: { fondo: '#EAF2FF', borde: '#B6D0FB', tinta: '#1D4FC4', solido: '#3B78E7' },
  turquesa: { fondo: '#E5F7F5', borde: '#A7E3DC', tinta: '#0D6B63', solido: '#1AA597' },
  verde: { fondo: '#EAF8EE', borde: '#AEE2BE', tinta: '#17703A', solido: '#2FA35A' },
  ambar: { fondo: '#FFF5E1', borde: '#F6D48F', tinta: '#8F4F07', solido: '#E09A1B' },
  naranja: { fondo: '#FFEFE6', borde: '#F9C4A6', tinta: '#B23C0A', solido: '#F07434' },
  rosa: { fondo: '#FDEDF5', borde: '#F5BBD6', tinta: '#B0175A', solido: '#E04A8E' },
  rojo: { fondo: '#FDEEEE', borde: '#F4B9B9', tinta: '#B42323', solido: '#E04848' },
  pizarra: { fondo: '#EEF1F5', borde: '#C9D1DC', tinta: '#465467', solido: '#6B7A90' },
};

const OSCURO: Record<Tono, PiezasDelTono> = {
  violeta: { fondo: '#251C45', borde: '#4A3A86', tinta: '#C9BCFF', solido: '#8F74F2' },
  azul: { fondo: '#14254A', borde: '#2C4D8E', tinta: '#A9C8FA', solido: '#4F8BF0' },
  turquesa: { fondo: '#0D2E2B', borde: '#1F5D57', tinta: '#8BE0D5', solido: '#26B8A8' },
  verde: { fondo: '#10301B', borde: '#255E37', tinta: '#9BDDB0', solido: '#3BB566' },
  ambar: { fondo: '#3A2A0B', borde: '#6E5216', tinta: '#F6D48F', solido: '#E5A42C' },
  naranja: { fondo: '#3A1D0E', borde: '#743A1C', tinta: '#F9C4A6', solido: '#F2844A' },
  rosa: { fondo: '#3B1028', borde: '#76284F', tinta: '#F5BBD6', solido: '#E75F9C' },
  rojo: { fondo: '#3B1414', borde: '#7A2C2C', tinta: '#F4B9B9', solido: '#E85D5D' },
  pizarra: { fondo: '#222A35', borde: '#3D4A5C', tinta: '#C9D1DC', solido: '#8492A6' },
};

export function useTonos(): Record<Tono, PiezasDelTono> {
  const { isDark } = useTheme();
  return isDark ? OSCURO : CLARO;
}

export function tonosDelTema(isDark: boolean): Record<Tono, PiezasDelTono> {
  return isDark ? OSCURO : CLARO;
}

/**
 * UN TONO FIJO POR PUESTO, en el orden de la lista de puestos: Cajero siempre del mismo
 * color esta semana y la siguiente. Nunca por rango o por cuántos turnos tiene —eso
 * repintaría los puestos al cambiar de semana—. Sin rojo, que ya dice «no puede».
 */
const TONOS_DE_PUESTO: readonly Tono[] = [
  'azul',
  'turquesa',
  'ambar',
  'rosa',
  'violeta',
  'verde',
  'naranja',
  'pizarra',
];

export function tonoDelPuesto(idsDePuestos: readonly string[], puesto: string | null): Tono {
  if (puesto === null) return 'pizarra';
  const ordenados = [...idsDePuestos].sort();
  const indice = ordenados.indexOf(puesto);
  return TONOS_DE_PUESTO[(indice < 0 ? 0 : indice) % TONOS_DE_PUESTO.length] ?? 'pizarra';
}
