/**
 * Que una zona horaria escrita a mano exista de verdad, y guardarla como se llama.
 *
 * DE DONDE SALE. Al bajar la zona horaria de la empresa a cada sede (pedido de Andree,
 * 2026-09-23: dos sedes en Perú y tres en Canadá) quedó claro que el campo se escribe a
 * mano y NADIE lo comprobaba, ni el de la empresa, que ya existía.
 *
 * POR QUÉ NO ES COSMÉTICO. `Intl.DateTimeFormat` LANZA un `RangeError` con una zona que
 * no existe, y el servidor la usa para decidir a qué día pertenece cada jornada
 * (`claveDeDia`, en `functions/src/views.ts`). Escribir «Lima» o «GMT-5» en vez de
 * «America/Lima» no rompe al guardar: rompe DESPUÉS, al abrir Horas o Reportes de esa
 * sede, y con un error que no menciona la zona por ningún lado.
 *
 * QUÉ ACEPTA DE VERDAD, medido con Node y no supuesto:
 *   America/Lima          OK
 *   america/lima          OK — no distingue mayúsculas
 *   America/Montreal      OK — es un alias antiguo y resuelve a America/Toronto
 *   UTC                   OK
 *   Lima                  LANZA
 *   GMT-5                 LANZA
 *   America/Nowhere       LANZA
 *
 * La primera versión de esto daba por hecho que «America/Montreal» no existía y la
 * prueba lo desmintió. De ahí la tabla: lo que vale es lo que la máquina dice.
 */

/**
 * La zona tal como `Intl` la llama, o `null` si no existe.
 *
 * DEVUELVE EL NOMBRE CANÓNICO y no un booleano, y eso es la mitad del valor: como no
 * distingue mayúsculas y acepta alias, guardar el texto crudo dejaría `america/lima` o
 * `America/Montreal` escrito en la base. Funciona, pero al volver a Ajustes se lee algo
 * que no es lo que nadie escribiría, y dos sedes en el mismo huso parecerían estar en
 * husos distintos. Guardar lo que `Intl` resuelve las deja iguales.
 *
 * Se pregunta a `Intl` en vez de llevar una lista propia: la lista IANA cambia —países
 * que cambian de huso, zonas que se renombran— y una copia nuestra se quedaría vieja en
 * silencio, rechazando algo que el navegador sí entiende. Y `Intl` es además quien la va
 * a usar después, así que lo que él acepte es exactamente lo que funciona.
 */
export function zonaCanonica(zona: string): string | null {
  const limpia = zona.trim();
  if (limpia === '') return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: limpia }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Si esa zona se puede usar sin que nada lance después. */
export function esZonaValida(zona: string): boolean {
  return zonaCanonica(zona) !== null;
}

/**
 * Ejemplos para la ayuda del campo, no una lista cerrada.
 *
 * Son los husos de los dos países donde hay tiendas hoy. Se enseñan porque el error real
 * no es de desconocimiento sino de formato: quien administra una tienda en Toronto sabe
 * dónde está, pero escribe «Toronto» a secas, que es lo único que no vale.
 */
export const ZONAS_DE_EJEMPLO = ['America/Lima', 'America/Toronto', 'America/Vancouver'] as const;
