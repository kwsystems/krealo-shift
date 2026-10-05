import { useEffect } from 'react';
import { Platform } from 'react-native';

import { dateKeyOf, localDateTimeToInstant } from '@/features/schedules/week';
import { useManagerScope } from '@/hooks/use-manager-scope';
import { isDemoMode } from '@/lib/demo/config';
import { usePreferencesStore } from '@/stores/preferences-store';

import { fetchMarcasRecibidas } from './api';
import { useAvisosStore } from './avisos-store';

/**
 * CADA CUÁNTO SE PREGUNTA (5-oct). Quince segundos: una marca tarda como mucho eso en
 * avisar, y cada vuelta sin novedades cuesta UNA lectura —se pide solo lo llegado
 * después de la última—, o sea unas 240 por hora y pestaña abierta.
 *
 * En la demostración no hay servidor que cuidar y el arnés no debería esperar quince
 * segundos por aviso: tres.
 */
export const INTERVALO_DE_AVISOS_MS = isDemoMode ? 3_000 : 15_000;

/** Medianoche de hoy en la sede: la campana enseña las marcas de hoy. */
export function inicioDelDia(timezone: string, ahora: Date = new Date()): string {
  return (
    localDateTimeToInstant(dateKeyOf(ahora, timezone), '00:00', timezone) ?? ahora.toISOString()
  );
}

function pestanaOculta(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  );
}

/**
 * EL VIGÍA: pregunta por las marcas nuevas de la sede que mira el panel y las deja en el
 * almacén de avisos. Se monta UNA vez, en el panel (`PanelConMarca`), para que la campana
 * y el emergente estén en todas las vistas sin que cada una consulte.
 *
 * LA PRIMERA RESPUESTA NO AVISA. Trae lo que ya pasó hoy, y eso va a la campana, no a la
 * pantalla: abrir el panel a mediodía no puede soltar doce emergentes seguidos. Avisa lo
 * que llega DESPUÉS de esa primera.
 *
 * CON LA PESTAÑA OCULTA NO PREGUNTA, y al volver pregunta en el acto: lo que llegó
 * mientras tanto entra de una vez, y el almacén deja tres emergentes y «y N más».
 */
export function useVigiaDeAvisos(): void {
  const { organization, locationId, timezone } = useManagerScope();
  const organizationId = organization?.id ?? null;

  useEffect(() => {
    if (organizationId === null || locationId === null) return undefined;
    const almacen = useAvisosStore.getState();
    almacen.empezar(locationId);

    let vivo = true;
    let primera = true;
    let enCurso = false;
    let cursor = inicioDelDia(timezone);

    const sondear = async () => {
      if (!vivo || enCurso || (!primera && pestanaOculta())) return;
      enCurso = true;
      try {
        const desde = inicioDelDia(timezone);
        // Al cambiar el día, lo de ayer ya no se pide.
        if (cursor < desde) cursor = desde;
        const llegadas = await fetchMarcasRecibidas({
          organizationId,
          locationId,
          desde: cursor,
        });
        if (!vivo) return;
        const ultima = llegadas[llegadas.length - 1];
        if (ultima !== undefined) cursor = ultima.received_at;
        useAvisosStore.getState().recibir(locationId, llegadas, {
          desde,
          avisar: !primera && usePreferencesStore.getState().avisosEmergentes,
        });
        primera = false;
      } catch {
        if (vivo) useAvisosStore.getState().fallo(locationId);
      } finally {
        enCurso = false;
      }
    };

    void sondear();
    const reloj = setInterval(() => void sondear(), INTERVALO_DE_AVISOS_MS);
    const alVolver = () => {
      if (!pestanaOculta()) void sondear();
    };
    const conDocumento = Platform.OS === 'web' && typeof document !== 'undefined';
    if (conDocumento) document.addEventListener('visibilitychange', alVolver);

    return () => {
      vivo = false;
      clearInterval(reloj);
      if (conDocumento) document.removeEventListener('visibilitychange', alVolver);
    };
  }, [organizationId, locationId, timezone]);
}
