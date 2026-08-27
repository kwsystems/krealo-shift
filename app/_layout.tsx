import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';

import { NotificationsGate } from '@/features/notifications/notifications-gate';
import { initI18n } from '@/i18n';
import { useKioskStore } from '@/stores/kiosk-store';
import { useNetworkStore } from '@/stores/network-store';
import { usePreferencesStore } from '@/stores/preferences-store';
import { colors } from '@/theme/tokens';

// i18n se inicializa antes del primer render para que ningún texto aparezca en
// blanco durante el arranque.
initI18n();

void SplashScreen.preventAutoHideAsync();

/**
 * TanStack Query gobierna el estado remoto (§4). Los tiempos de obsolescencia son
 * cortos en datos de asistencia, que cambian a cada minuto, y la app debe seguir
 * usable si Realtime está caído: por eso hay reintentos y refetch al reconectar.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Los fichajes son idempotentes en servidor, así que reintentar es seguro.
      retry: 1,
    },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydratePreferences = usePreferencesStore((s) => s.hydrate);
  const hydrateKiosk = useKioskStore((s) => s.hydrate);
  const startNetwork = useNetworkStore((s) => s.start);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    let stopNetwork: (() => void) | undefined;

    const boot = async () => {
      // Orden de arranque de la especificación §6.1: primero idioma y estado
      // seguro local, después si el dispositivo es kiosco.
      await hydratePreferences();
      await hydrateKiosk();
      stopNetwork = await startNetwork();
      setReady(true);
    };

    void boot();
    return () => stopNetwork?.();
  }, [hydratePreferences, hydrateKiosk, startNetwork]);

  // Una fuente que no carga no debe dejar la app en la pantalla de inicio para
  // siempre: seguimos con la fuente del sistema y lo registramos.
  const fontsSettled = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready && fontsSettled) void SplashScreen.hideAsync();
  }, [ready, fontsSettled]);

  if (!ready || !fontsSettled) {
    // Pantalla de inicio de marca sobria: nunca una pantalla equivocada mientras
    // se resuelve la sesión (§6.1).
    return <View style={styles.boot} />;
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: styles.content }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(manager)" />
            <Stack.Screen name="kiosk" />
          </Stack>
          {/*
            Va DESPUES del Stack a proposito. Los efectos de los hermanos corren en
            orden de arbol, y el manejador del toque navega en su efecto: si se
            montara antes, ese `router.push` ocurriria con el navegador raiz todavia
            sin montar y se perderia. No pinta nada (§19).
          */}
          <NotificationsGate />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  boot: { flex: 1, backgroundColor: colors.primary50 },
  content: { backgroundColor: colors.canvas },
});
