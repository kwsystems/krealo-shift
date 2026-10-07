import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { isDemoMode } from '@/lib/demo/config';

/**
 * ¿HAY UNA VERSIÓN NUEVA DE LA APP? (Andree, 7-oct: «¿por qué tengo que dar F5?»).
 *
 * Una pestaña abierta sigue con el paquete con el que se abrió: después de cada despliegue,
 * hasta recargar, enseña lo de antes y le faltan los arreglos nuevos. El documento de entrada
 * se sirve sin caché (`firebase.json`), así que pedirlo dice cuál es el paquete de ahora: si
 * su nombre no es el que está cargado, hay una versión nueva.
 *
 * Se mira cada cinco minutos con la pestaña a la vista y al volver a ella. No recarga sola:
 * quien está escribiendo en una hoja perdería lo escrito. Lo dice, y un botón recarga.
 */
export const INTERVALO_DE_VERSION_MS = isDemoMode ? 4_000 : 5 * 60_000;

const PAQUETE = /\/_expo\/static\/js\/web\/entry-[0-9a-f]+\.js/;

/** El paquete que nombra un documento de entrada, o `null` si no nombra ninguno. */
export function paqueteDelDocumento(html: string): string | null {
  return PAQUETE.exec(html)?.[0] ?? null;
}

/** El paquete con el que arrancó esta pestaña. */
function paqueteCargado(): string | null {
  if (typeof document === 'undefined') return null;
  for (const script of Array.from(document.scripts)) {
    const encontrado = paqueteDelDocumento(script.src);
    if (encontrado !== null) return encontrado;
  }
  return null;
}

export function useVersionNueva(): boolean {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const cargado = paqueteCargado();
    // En desarrollo no hay paquete con nombre: nada que comparar.
    if (cargado === null) return undefined;

    let vivo = true;
    const mirar = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const respuesta = await fetch('/', { cache: 'no-store' });
        if (!respuesta.ok) return;
        const servido = paqueteDelDocumento(await respuesta.text());
        if (vivo && servido !== null && servido !== cargado) setHayNueva(true);
      } catch {
        // Sin conexión: se vuelve a mirar en la próxima vuelta.
      }
    };

    const reloj = setInterval(() => void mirar(), INTERVALO_DE_VERSION_MS);
    const alVolver = () => void mirar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      vivo = false;
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);

  return hayNueva;
}
