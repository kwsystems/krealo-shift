// Configuración de Metro (§30, §33)
//
// El proyecto no tenía este archivo y con los valores por defecto de Expo el
// empaquetado para web FALLABA: `expo-sqlite` importa `wa-sqlite.wasm` para correr
// SQLite en el navegador, y Metro no reconoce `.wasm` como asset, así que lo
// buscaba como si fuera un módulo de JavaScript y no lo encontraba.
//
// Eso importa más de lo que parece. La especificación (§33) pide que la
// previsualización web permita recorrer todas las pantallas, y `expo-sqlite` entra
// en el grafo desde `app/index.tsx` a través de `stores/kiosk-store`. O sea: sin
// esto no compilaba NADA en web, ni las pantallas que no tocan la base local.
//
// `tsc` no lo detecta porque los tipos resuelven bien; solo aparece al empaquetar
// de verdad. Es el motivo de que valga la pena correr `expo export` y no confiar
// solo en el typecheck.

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `.wasm` como asset y no como código: Metro lo copia y devuelve su URI, que es lo
// que espera el cargador de wa-sqlite.
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'wasm'])];

// Las fuentes recortadas de la web van en `.woff2` (`src/theme/fuentes.web.ts`, 28-oct).
config.resolver.assetExts.push('woff2');

/*
 * TRES COSAS QUE NO ENTRAN EN LA WEB (28-oct). Metro no descarta lo que no se usa, así que:
 *
 * - Reanimated: ningún archivo de la app lo usa —las animaciones de la web son CSS—, pero
 *   `react-native-gesture-handler` lo pide «por si está» (en un try/catch) y entraban sus
 *   733 KB. Con un módulo vacío gesture-handler sigue como siempre en la web.
 * - Los 53 idiomas de los mensajes de zod (~200 KB): la app no usa ninguno, sus textos son
 *   los de i18next. El índice se cambia por uno con `en` y `es`.
 * - `re2js` (143 KB): Firestore lo importa solo para las expresiones regulares de sus
 *   «pipelines», que la app no usa. Si algún día se usan, el sustituto lo dice al fallar.
 *
 * En iOS y Android no se toca nada.
 */
const IDIOMAS_DE_ZOD = path.join(__dirname, 'scripts', 'metro', 'zod-idiomas.js');
const RE2JS_VACIO = path.join(__dirname, 'scripts', 'metro', 're2js-vacio.js');
const resolverAnterior = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-reanimated') return { type: 'empty' };
  if (platform === 'web' && moduleName === 're2js')
    return { type: 'sourceFile', filePath: RE2JS_VACIO };
  if (
    platform === 'web' &&
    moduleName === '../locales/index.js' &&
    /[\\/]node_modules[\\/]zod[\\/]/.test(context.originModulePath)
  ) {
    return { type: 'sourceFile', filePath: IDIOMAS_DE_ZOD };
  }
  return (resolverAnterior ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
