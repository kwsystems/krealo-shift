/**
 * Las pruebas que hablan con los emuladores de Firebase, en un Jest aparte.
 *
 * POR QUE NO VALE EL `jest.config.js` DE SIEMPRE, que es lo primero que uno intenta:
 * ese usa el preset `jest-expo`, y ese preset carga los `setupFiles` de React Native
 * en CUALQUIER entorno. Uno de ellos reemplaza el `fetch` global por el polyfill de
 * React Native, que aquí no funciona: devuelve una `Response` con `status` y `url`
 * sin definir y con `text()` que revienta.
 *
 * Eso es lo que hacía fallar las ocho pruebas de las reglas con «Emulator Hub at
 * undefined», un mensaje que parece que el emulador no arrancó cuando sí arrancó. No
 * era el emulador: era que `discoverEmulators` pedía la lista por `fetch` y recibía
 * ese objeto roto. Poner `@jest-environment node` en la cabecera del archivo NO lo
 * arregla —los `setupFiles` corren igual—, y por eso hace falta una configuración
 * entera sin el preset.
 *
 * Aquí no hay React Native que valer: estas pruebas ejercitan reglas de Firestore y
 * Cloud Functions, o sea servidor. Se transpila solo lo justo —quitar los tipos y
 * pasar los módulos a CommonJS— porque Node 22 entiende el resto sin ayuda.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/lib/firebase/__tests__/reglas.test.ts',
    '<rootDir>/functions/src/**/__tests__/emulador/*.test.ts',
  ],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: ['@babel/preset-typescript'],
        plugins: ['@babel/plugin-transform-modules-commonjs'],
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // El SDK de Firebase publica ESM y hay que transpilarlo igual que el código propio.
  transformIgnorePatterns: ['/node_modules/(?!(firebase|@firebase)/)'],
  testTimeout: 30000,
};
