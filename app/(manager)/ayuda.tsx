import { ManualScreen } from '@/features/manual/manual-screen';

/**
 * `/ayuda` — el mismo manual que `/manual`, pero DENTRO del panel, con el menú a la vista.
 *
 * `/manual` sigue existiendo y sigue abierto sin sesión: es el enlace que se le pasa a
 * quien ficha en la tienda. Este es el de quien administra, que lo busca en el menú y no
 * quiere salirse del panel para leerlo. Las dos rutas pintan la MISMA pantalla, así que no
 * pueden contar cosas distintas.
 *
 * No se llama `manual.tsx` porque `(manager)` es un grupo: sus rutas viven en la raíz y
 * chocaría con `app/manual.tsx`.
 */
export default function AyudaRoute() {
  return <ManualScreen />;
}
