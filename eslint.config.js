// ESLint 9 flat config. `expo lint` y `npm run lint` usan este archivo.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');
const tseslint = require('typescript-eslint');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'node_modules/*',
      'coverage/*',
      'supabase/.branches/*',
      // Biblioteca de skills de Claude Code: no es codigo de la app.
      '.claude/**',
      // Codigo Deno: se formatea y comprueba con el toolchain de Deno.
      'supabase/functions/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // La especificación prohíbe `any` salvo excepción documentada (§4).
      '@typescript-eslint/no-explicit-any': 'error',
      // Ningún texto visible hardcodeado: los strings van por t() (§18).
      // Se vigila en revisión y con el test de paridad de claves; ESLint no puede
      // distinguir un literal de UI de uno técnico sin falsos positivos constantes.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Los tests pueden usar console y helpers laxos.
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts'],
    rules: { 'no-console': 'off' },
  },
]);
