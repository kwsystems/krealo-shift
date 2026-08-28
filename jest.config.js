/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@app/(.*)$': '<rootDir>/app/$1',
  },
  // Por defecto Jest no transforma nada de node_modules, y estos paquetes se
  // publican como ESM o con sintaxis moderna: sin transformarlos, importarlos
  // revienta con un error de sintaxis que no dice de donde viene.
  //
  // `standard-navigation` esta aqui porque lo arrastra `expo-router`: cualquier
  // prueba de un componente que importe algo de `app/` lo acaba cargando. Sin el,
  // las pruebas de las pantallas con formulario no se podian escribir.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-navigation|@react-navigation/.*|standard-navigation|@sentry/react-native|native-base|react-native-svg|@supabase/.*)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/i18n/locales/**'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/dist/'],
};
