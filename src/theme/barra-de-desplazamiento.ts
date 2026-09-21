import { Platform } from 'react-native';

/**
 * El aspecto de la barra de desplazamiento en la web.
 *
 * POR QUÉ NO ESTÁ EN `tokens.ts` COMO TODO LO DEMÁS: es lo único de la interfaz que
 * React Native no pinta. `ScrollView` decide si la barra se ve —y eso sí se controla
 * desde el componente—, pero su forma y su color los pone el navegador. La barra de
 * Windows es gris, mide 15 px y lleva dos flechas; al lado de un panel con esquinas
 * redondeadas y tinta teñida de morado, canta. La única forma de darle forma es CSS.
 *
 * POR QUÉ NO ESTÁ EN `app/+html.tsx`, que es donde parece que debería. Se intentó y no
 * sirve: con `output: 'single'` —lo que usa esta app, y el porqué está en
 * `app.config.ts`— Expo genera `index.html` desde su propia plantilla y NO mira
 * `+html.tsx`. El archivo se escribía, el empaquetado salía sin error y el `index.html`
 * publicado seguía siendo el de siempre. No hay aviso de ningún tipo; se ve leyendo el
 * HTML generado.
 *
 * Inyectarlo desde aquí tiene además una ventaja que el HTML estático no podía dar: el
 * HTML se escribe al empaquetar, cuando no se sabe con qué tema va a abrirlo nadie, así
 * que el color tenía que valer para los dos. Esto corre en el navegador y podría leer
 * el tema. Aun así el color sigue siendo un gris con alfa, y no por comodidad: el tema
 * se cambia en caliente desde Ajustes, y un gris translúcido toma el tono de lo que
 * tenga debajo sin que haya que volver a pintar nada. Es lo mismo que hace macOS.
 */

/*
 * LAS DOS FORMAS DE PINTAR UNA BARRA SON EXCLUYENTES, Y ESO NO SE VE VENIR.
 *
 * Hay dos juegos de propiedades: el estándar (`scrollbar-width`, `scrollbar-color`),
 * que solo deja elegir «fina o normal» y dos colores, y los pseudoelementos
 * `::-webkit-scrollbar`, que dejan controlarlo todo. La trampa es que en Chrome NO se
 * suman: en cuanto un elemento tiene `scrollbar-color` o `scrollbar-width`, los
 * `::-webkit-scrollbar` que le tocarían se IGNORAN por completo.
 *
 * La primera versión de esto llevaba `* { scrollbar-color: ... }` delante de las reglas
 * webkit «para que también funcionara en Firefox». El resultado era que Firefox salía
 * bien y Chrome —el navegador con el que se usa el panel— se quedaba con su barra de
 * siempre: 15 px medidos en la ficha del empleado, no los 10 que dicen estas reglas. No
 * falla nada, no avisa nadie, y a simple vista la barra se ve «gris y fina» en los dos.
 *
 * Con `@supports not selector(::-webkit-scrollbar)` cada navegador entra por una sola
 * puerta: Chrome y Safari reconocen el selector, se saltan el bloque y usan los
 * pseudoelementos; Firefox no lo reconoce, entra en el bloque y usa el estándar.
 */
const CSS = `
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-corner { background: transparent; }

/*
 * El borde transparente con \`background-clip: content-box\` es lo que deja un pulgar de
 * 4 px dentro de un canal de 10. Sin él hay que elegir entre una barra gruesa o una que
 * no se puede agarrar con el ratón.
 */
::-webkit-scrollbar-thumb {
  background-color: rgba(120, 116, 134, 0.38);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(120, 116, 134, 0.62); }
::-webkit-scrollbar-thumb:active { background-color: rgba(120, 116, 134, 0.78); }

@supports not selector(::-webkit-scrollbar) {
  * { scrollbar-width: thin; scrollbar-color: rgba(120, 116, 134, 0.38) transparent; }
}
`;

const ID = 'krealo-scrollbar';

/**
 * Se llama una vez al arrancar. Fuera de la web no hace nada, y en la web no repite:
 * con la recarga rápida del desarrollo este módulo se reevalúa, y sin la comprobación
 * del identificador la cabecera acaba con una pila de hojas idénticas.
 *
 * Nada de esto pisa a un `ScrollView` que pida esconder su indicador —las filas de
 * fichas que se arrastran a lo ancho—: React Native lo escribe por elemento y en una
 * clase, así que gana a la regla de `*`. Y debe ganar: aquí se decide el ASPECTO de la
 * barra, y cada `ScrollView` sigue decidiendo si se ve.
 */
export function aplicarBarraDeDesplazamiento(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(ID) !== null) return;

  const hoja = document.createElement('style');
  hoja.id = ID;
  hoja.textContent = CSS;
  document.head.appendChild(hoja);
}
