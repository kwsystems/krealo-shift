import { AppScreen, ResponsiveContainer } from '@/components/ui/layout';
import { SettingsPanel } from '@/features/settings/settings-panel';

/**
 * Configuración (§11.6): organización, ubicación, accesos, relojes y avisos.
 *
 * Sale de la pestaña «Más» por lo mismo que Solicitudes: un menú llamado «Más» no
 * dice qué hay dentro, así que quien busca algo tiene que abrirlo para averiguarlo.
 * Con dos destinos y nombres propios, se ve desde la barra dónde está cada cosa.
 */
export default function ManagerSettingsRoute() {
  return (
    <AppScreen tone="canvas" scroll testID="manager-settings">
      <ResponsiveContainer>
        <SettingsPanel />
      </ResponsiveContainer>
    </AppScreen>
  );
}
