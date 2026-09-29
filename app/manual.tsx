import { ManualScreen } from '@/features/manual/manual-screen';

/**
 * `/manual` — el manual de uso, sin sesión.
 *
 * VIVE EN LA RAÍZ Y NO DENTRO DE `(manager)` NI DE `kiosk`, y eso es lo que lo hace
 * abierto: las guardas de sesión están en el layout de cada grupo. Es el mismo sitio del
 * que cuelga `kiosk/setup`, que tampoco puede pedir credencial porque es quien la crea.
 */
export default function ManualRoute() {
  return <ManualScreen />;
}
