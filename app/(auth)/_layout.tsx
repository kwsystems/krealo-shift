import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppScreen } from '@/components/ui/layout';
import { LoadingState } from '@/components/ui/states';
import { useBootResolution } from '@/features/boot/use-boot-resolution';

/**
 * Grupo de acceso (§8).
 *
 * INICIAR SESIÓN CON ÉXITO NO LLEVABA A NINGUNA PARTE.
 *
 * `sign-in.tsx` no navega a propósito, y su comentario explicaba por qué: "el éxito
 * no navega a mano: `onAuthStateChange` mueve la sesión y la ruta raíz redirige
 * según rol". El razonamiento tiene un agujero: la ruta raíz solo redirige MIENTRAS
 * ESTÁ MONTADA, y a esta pantalla se llega con un `<Redirect>` —o sea un
 * `router.replace`— que la desmonta.
 *
 * Así que la sesión se creaba bien, el store se actualizaba, el botón dejaba de
 * girar, no había error... y la persona se quedaba mirando el formulario de acceso.
 * Nada le decía que ya había entrado. Es el fallo más visible de todos los de esta
 * clase, porque impide entrar a la app.
 *
 * La guarda va aquí y no en la pantalla: este layout es el único punto por el que
 * pasa todo el grupo, y funciona igual si mañana hay más pantallas de acceso.
 *
 * NO PUEDE ENTRAR EN BUCLE CON LA RUTA RAÍZ. `app/index.tsx` manda aquí solo cuando
 * la resolución dice `signIn`, y esto sale de aquí solo cuando dice cualquier otra
 * cosa. Al leer las dos la misma función, para un mismo estado se cumple exactamente
 * una de las dos condiciones.
 */
export default function AuthLayout() {
  const { t } = useTranslation();
  const { destination } = useBootResolution();

  // Resolviendo: se espera. Sin esto, quien recarga esta ruta con sesión válida ve
  // el formulario un instante antes de que lo saquen, y quien acaba de escribir su
  // contraseña ve el formulario vacío otra vez, que se lee como un fallo.
  if (destination.kind === 'resolving') {
    return (
      <AppScreen tone="kiosk">
        <LoadingState label={t('boot.resolvingSession')} />
      </AppScreen>
    );
  }

  // Cualquier otro destino se resuelve en la ruta raíz, que es el único sitio donde
  // se decide qué pantalla corresponde a cada uno. Aquí solo se sale.
  if (destination.kind !== 'signIn') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
