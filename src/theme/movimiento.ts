import { Platform } from 'react-native';

/**
 * EL MOVIMIENTO DE LA APP (13-oct). Andree: «no me gusta el diseño… está muy básico, darle
 * animaciones». Hasta aquí solo se movían la campana y el aviso emergente: todo lo demás
 * aparecía de golpe y no respondía al tocarlo.
 *
 * ES CSS, NO REANIMATED, por tres razones. La app es web —el panel, el celular y el reloj
 * son la misma web—; el CSS corre fuera del hilo de JavaScript, así que una tabla de 200
 * filas no se traba por animar; y no toca la lógica de ningún componente: basta con
 * marcarlo (`movimiento('entrada')`) y esta hoja hace el resto. Las 1 400 pruebas de unidad
 * siguen montando los mismos componentes sin saber nada de esto.
 *
 * QUÉ SE MUEVE, Y POR QUÉ CADA COSA:
 *
 *   · `pantalla`  — al abrir una pantalla, sus bloques suben 8 px y aparecen, uno detrás de
 *     otro. Dice «esto es nuevo» sin hacer esperar: 260 ms, y el último empieza a los 150.
 *   · `pulsable`  — lo que se puede tocar se levanta 1 px con el puntero y se hunde al
 *     pulsar. Es la respuesta física que faltaba: «al pulsar solo bajaba la opacidad».
 *   · `boton`     — igual, pero sin levantarse: un botón no flota, se aprieta.
 *   · `hoja`      — las hojas suben desde abajo y el fondo se oscurece con ellas.
 *   · `crecer`    — las barras de horas crecen desde su inicio, como se llena el día.
 *   · `latido`    — la línea de «ahora» late despacio: es lo único vivo de la franja.
 *   · `brillo`    — lo que está cargando tiene un brillo que pasa, para que no parezca roto.
 *   · `aparecer`  — una cifra o un aviso que cambia entra con un pequeño salto de escala.
 *   · `girar`     — el segundero de la esfera del acceso: una vuelta por minuto.
 *
 * NO SE ANIMA EL COLOR DE FONDO de filas y botones, a propósito: `relieve-check` mide el
 * cambio al pasar el puntero a los 160 ms, y una transición de color le haría medir el
 * color a medio camino. Se anima posición, escala y sombra; el color cambia al instante,
 * como hasta ahora.
 *
 * Y CON «REDUCIR MOVIMIENTO» ACTIVADO EN EL SISTEMA, NADA SE MUEVE: ni entradas, ni
 * latidos, ni levantarse. Las cosas siguen apareciendo y respondiendo, solo que quietas.
 */

export type Movimiento =
  | 'pantalla'
  | 'entrada'
  | 'pulsable'
  | 'boton'
  | 'hoja'
  | 'fondo-de-hoja'
  | 'crecer'
  | 'latido'
  | 'brillo'
  | 'aparecer'
  | 'girar';

/** La curva de toda la app: arranca rápido y se posa, como algo que se suelta. */
const SOLTAR = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const CSS = `
@keyframes ks-entrada { from { opacity: 0; transform: translateY(8px); } }
@keyframes ks-hoja { from { opacity: 0; transform: translateY(28px) scale(0.985); } }
@keyframes ks-fondo { from { opacity: 0; } }
@keyframes ks-crecer { from { transform: scaleX(0); } }
@keyframes ks-latido { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes ks-brillo { from { background-position: -320px 0; } to { background-position: 320px 0; } }
@keyframes ks-girar { to { transform: rotate(360deg); } }
@keyframes ks-aparecer { 0% { opacity: 0; transform: scale(0.92); } 60% { transform: scale(1.03); } 100% { opacity: 1; transform: none; } }

[data-ks~="entrada"] { animation: ks-entrada 260ms ${SOLTAR} backwards; }

[data-ks~="pantalla"] > * > * { animation: ks-entrada 260ms ${SOLTAR} backwards; }
[data-ks~="pantalla"] > * > *:nth-child(2) { animation-delay: 30ms; }
[data-ks~="pantalla"] > * > *:nth-child(3) { animation-delay: 60ms; }
[data-ks~="pantalla"] > * > *:nth-child(4) { animation-delay: 90ms; }
[data-ks~="pantalla"] > * > *:nth-child(5) { animation-delay: 120ms; }
[data-ks~="pantalla"] > * > *:nth-child(n+6) { animation-delay: 150ms; }

[data-ks~="pulsable"] {
  transition: transform 180ms ${SOLTAR}, box-shadow 220ms ${SOLTAR};
}
[data-ks~="pulsable"]:hover { transform: translateY(-2px); box-shadow: var(--ks-sombra-alta); }
[data-ks~="pulsable"]:active { transform: translateY(0) scale(0.99); transition-duration: 80ms; }

[data-ks~="boton"] { transition: transform 160ms ${SOLTAR}, box-shadow 200ms ${SOLTAR}; }
[data-ks~="boton"]:active { transform: scale(0.97); transition-duration: 70ms; }

[data-ks~="hoja"] { animation: ks-hoja 320ms ${SOLTAR} backwards; }
[data-ks~="fondo-de-hoja"] { animation: ks-fondo 240ms ease-out backwards; }

[data-ks~="crecer"] { transform-origin: left center; animation: ks-crecer 700ms ${SOLTAR} backwards; }
[data-ks~="latido"] { animation: ks-latido 2.4s ease-in-out infinite; }
[data-ks~="aparecer"] { animation: ks-aparecer 380ms ${SOLTAR} backwards; }
[data-ks~="girar"] { animation: ks-girar 60s steps(60, end) infinite; }

[data-ks~="brillo"] {
  background-image: linear-gradient(90deg, transparent 0, var(--ks-brillo) 50%, transparent 100%);
  background-size: 320px 100%;
  background-repeat: no-repeat;
  animation: ks-brillo 1.3s ease-in-out infinite;
}

:root { --ks-brillo: rgba(255, 255, 255, 0.55); --ks-sombra-alta: 0 1px 2px rgba(25, 23, 42, 0.06), 0 12px 28px -8px rgba(25, 23, 42, 0.18); }
:root[data-ks-tema="oscuro"] { --ks-brillo: rgba(255, 255, 255, 0.06); --ks-sombra-alta: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 14px 30px -10px rgba(0, 0, 0, 0.7); }

@media (prefers-reduced-motion: reduce) {
  [data-ks], [data-ks] > * > * {
    animation: none !important;
    transition: none !important;
  }
  [data-ks~="pulsable"]:hover, [data-ks~="pulsable"]:active, [data-ks~="boton"]:active {
    transform: none !important;
  }
}
`;

const ID = 'krealo-movimiento';

/** Instala la hoja una vez, al arrancar. Fuera de la web no hace nada. */
export function aplicarMovimiento(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(ID) !== null) return;
  const hoja = document.createElement('style');
  hoja.id = ID;
  hoja.textContent = CSS;
  document.head.appendChild(hoja);
}

/**
 * El tema en la raíz, para que las sombras y el brillo sean los de su tema. Lo llama la
 * raíz de la app cada vez que el tema cambia.
 */
export function marcarTemaDelMovimiento(oscuro: boolean): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-ks-tema', oscuro ? 'oscuro' : 'claro');
}

/**
 * Las props que marcan un elemento: `<View {...movimiento('entrada')} />`. En la web se
 * vuelven `data-ks="entrada"`; fuera de ella no hacen nada. Admite varios a la vez.
 */
export function movimiento(...cuales: readonly (Movimiento | false | null | undefined)[]) {
  const lista = cuales.filter((cual): cual is Movimiento => typeof cual === 'string');
  if (Platform.OS !== 'web' || lista.length === 0) return {};
  return { dataSet: { ks: lista.join(' ') } } as Record<string, unknown>;
}
