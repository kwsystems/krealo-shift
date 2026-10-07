import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useQueryClient, type Query } from '@tanstack/react-query';

import { isDemoMode } from '@/lib/demo/config';

/**
 * LAS PANTALLAS SE PONEN AL DÍA SOLAS, sin F5 (Andree, 7-oct): «¿por qué tengo que dar F5
 * para que las cosas se actualicen, o es porque mucho no entré a la página?». Eran las dos
 * cosas. Al volver a la pestaña no se pedía nada nuevo, y solo Inicio se refrescaba solo:
 * Horario, Horas, Reportes, Equipo, Bandeja y el celular enseñaban lo que había al abrirlos
 * hasta que alguien cambiaba de pantalla o recargaba.
 *
 * Lo que hace:
 *   - CADA MINUTO, con la pestaña a la vista, vuelve a pedir lo que la pantalla abierta está
 *     enseñando. Solo eso: `refetchType: 'active'`, así que una pantalla que no está
 *     montada no gasta nada. Reportes, que lee el mes entero, cada cinco minutos.
 *   - AL VOLVER A LA PESTAÑA después de medio minuto o más fuera, lo pide en el acto.
 *   - Con la pestaña oculta o sin conexión no pide nada.
 *
 * Una marca del reloj no espera al minuto: el vigía de avisos, que ya pregunta cada quince
 * segundos, refresca las vistas en cuanto llega una (`use-vigia-de-avisos.ts`).
 */
export const INTERVALO_DE_DATOS_MS = isDemoMode ? 5_000 : 60_000;
/** Reportes, una de cada cinco vueltas: es la consulta más grande del panel. */
export const VUELTAS_POR_REPORTE = 5;
/** Volver a la pestaña después de esto pide lo de la pantalla en el acto. */
export const AUSENCIA_QUE_REFRESCA_MS = 30_000;

/**
 * LO QUE NO SE PIDE SOLO, y por qué cada una:
 *   - `revision-de-jornadas` vuelve a medir las jornadas EN EL SERVIDOR, que escribe: se hace
 *     al abrir la semana, no cada minuto;
 *   - `manager` y `settings` son quién eres y la configuración de la sede: no cambian solas;
 *   - `push`, el permiso de notificaciones del aparato;
 *   - la simulación de «Registrar como cumplido» es una función del servidor que se pide al
 *     abrir su hoja, y la hora de inicio del reloj de la sede no cambia en un día.
 */
export function seRefrescaSola(query: Pick<Query, 'queryKey'>, conReportes: boolean): boolean {
  const [raiz, segunda] = query.queryKey as readonly unknown[];
  if (
    raiz === 'revision-de-jornadas' ||
    raiz === 'manager' ||
    raiz === 'settings' ||
    raiz === 'push'
  ) {
    return false;
  }
  if (raiz === 'schedule' && (segunda === 'cumplido' || segunda === 'inicio-del-reloj')) {
    return false;
  }
  if (raiz === 'reports') return conReportes;
  return true;
}

export function useDatosAlDia(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;

    const visible = () => document.visibilityState !== 'hidden';
    const enLinea = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const refrescar = (conReportes: boolean) => {
      void queryClient.invalidateQueries({
        predicate: (query) => seRefrescaSola(query, conReportes),
        refetchType: 'active',
      });
    };

    let vuelta = 0;
    const reloj = setInterval(() => {
      if (!visible() || !enLinea()) return;
      vuelta += 1;
      refrescar(vuelta % VUELTAS_POR_REPORTE === 0);
    }, INTERVALO_DE_DATOS_MS);

    let ocultaDesde: number | null = null;
    const alCambiar = () => {
      if (!visible()) {
        ocultaDesde = Date.now();
        return;
      }
      if (ocultaDesde !== null && Date.now() - ocultaDesde >= AUSENCIA_QUE_REFRESCA_MS) {
        refrescar(true);
      }
      ocultaDesde = null;
    };
    document.addEventListener('visibilitychange', alCambiar);

    return () => {
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alCambiar);
    };
  }, [queryClient]);
}
