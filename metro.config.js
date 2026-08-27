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

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `.wasm` como asset y no como código: Metro lo copia y devuelve su URI, que es lo
// que espera el cargador de wa-sqlite.
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'wasm'])];

module.exports = config;
