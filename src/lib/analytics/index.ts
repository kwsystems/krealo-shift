import { isProduction } from '@/lib/env';
import type { AnalyticsEvent } from './events';

export type { AnalyticsEvent, AnalyticsEventName, TimeActionName, SyncFailureReason } from './events';
export { SPEC_EVENTS } from './events';

/**
 * Envío de eventos de producto (§31).
 *
 * DOS REGLAS QUE ESTE ARCHIVO IMPONE
 *
 * 1. `track` NUNCA LANZA Y NUNCA ESPERA. Se llama desde el camino de un fichaje, y un
 *    fichaje no puede fallar —ni tardar— porque la analítica esté caída. Se llama sin
 *    `await` a propósito, y cualquier fallo del sink se traga aquí: un `void promise()`
 *    con un rechazo dentro es una excepción sin capturar, que en React Native es una
 *    pantalla roja.
 *
 * 2. El destino es reemplazable. Hoy no hay servicio contratado: elegirlo y dar sus
 *    credenciales es de Andree. Mientras tanto, en desarrollo se escribe en consola
 *    —sirve de inmediato para seguir la cola offline— y en producción no se hace nada.
 *    Conectar un servicio es una llamada a `setAnalyticsSink`, no tocar los nueve sitios
 *    donde se mide.
 */

export type AnalyticsSink = (event: AnalyticsEvent) => void | Promise<void>;

/**
 * El destino de desarrollo. No es un `console.log` suelto: lleva prefijo para poder
 * filtrarlo y ordena las propiedades para que dos eventos iguales se lean iguales.
 */
const consoleSink: AnalyticsSink = (event) => {
  const { name, ...props } = event;
  const detalle = Object.entries(props)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, valor]) => `${clave}=${String(valor)}`)
    .join(' ');
  /*
   * `console.log` y no `warn`: la regla de lint solo permite warn y error, y con razón
   * —un log suelto en producción es ruido— pero un evento de producto NO es una
   * advertencia. Mandarlo por `warn` ensuciaría el canal donde se miran los problemas de
   * verdad, que es exactamente lo que la regla protege. Este destino solo se usa fuera de
   * producción; `isProduction` elige el que no hace nada.
   */
  // eslint-disable-next-line no-console
  console.log(`[krealo-shift][analytics] ${name}${detalle === '' ? '' : ' ' + detalle}`);
};

/** En producción no hay a dónde enviar todavía, y un console.log sería ruido. */
const noopSink: AnalyticsSink = () => undefined;

let sink: AnalyticsSink = isProduction ? noopSink : consoleSink;

/** Conecta un servicio real. Un `null` vuelve al destino por defecto del entorno. */
export function setAnalyticsSink(nuevo: AnalyticsSink | null): void {
  sink = nuevo ?? (isProduction ? noopSink : consoleSink);
}

export function track(event: AnalyticsEvent): void {
  try {
    const resultado = sink(event);
    // Un sink asíncrono no se espera, pero SÍ se le captura el rechazo.
    if (resultado instanceof Promise) resultado.catch(() => undefined);
  } catch {
    // La analítica no rompe nada. Ni el fichaje, ni la pantalla.
  }
}
