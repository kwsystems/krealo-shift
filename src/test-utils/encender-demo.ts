/**
 * Enciende el modo demostración ANTES de que se cargue nada de la app.
 *
 * POR QUÉ ES UN MÓDULO Y NO UNA LÍNEA EN LA PRUEBA
 * Babel iza todos los `import` por encima del cuerpo del módulo, así que
 * `process.env.EXPO_PUBLIC_DEMO = '1'` escrito en la prueba se ejecutaría DESPUÉS de
 * que `config.ts` ya hubiera leído la variable. El orden RELATIVO entre imports sí se
 * respeta, así que importar esto en primer lugar sí funciona.
 *
 * La alternativa era `require()` en la prueba, y se probó: funciona, pero devuelve
 * `any` y desactiva la comprobación de tipos justo donde hace falta. Dos llamadas con
 * la firma equivocada pasaron `tsc` sin una queja y fallaron en ejecución. Con esto,
 * las pruebas vuelven a usar `import` y `tsc` vuelve a mirarlas.
 *
 * VIVE EN `test-utils` Y NO EN `__tests__` porque Jest trata como suite CUALQUIER
 * archivo dentro de `__tests__`, y este no tiene pruebas: ahí dentro rompía la suite
 * entera con "your test suite must contain at least one test".
 */
process.env.EXPO_PUBLIC_DEMO = '1';
