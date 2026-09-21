import { AppScreen, ResponsiveContainer } from '@/components/ui/layout';
import { RequestsPanel } from '@/features/requests/requests-panel';

/**
 * Solicitudes (§11.5): «olvidé marcar» y correcciones que esperan respuesta.
 *
 * ERA MEDIA PESTAÑA «MÁS», y esconderla ahí tenía un coste real: para responder a
 * alguien que dice que se le olvidó fichar había que entrar en un cajón llamado
 * «Más» y elegir entre dos secciones. Una bandeja con cosas esperando respuesta es
 * justo lo que no puede estar detrás de un nombre que no dice nada.
 */
export default function ManagerRequestsRoute() {
  return (
    <AppScreen tone="canvas" scroll testID="manager-requests">
      <ResponsiveContainer>
        <RequestsPanel />
      </ResponsiveContainer>
    </AppScreen>
  );
}
