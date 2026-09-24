/**
 * EL COLOR DEL ANCLA DE UNA PERSONA: siempre el mismo para la misma persona.
 *
 * POR QUÉ. Las filas de Equipo y de Horas llevan las iniciales de cada persona en un
 * círculo, y todas lo llevaban del MISMO color tenue. O sea que el ancla no anclaba nada:
 * seguía habiendo que leer el nombre para saber de quién era la fila, que es justo lo que
 * el ancla existe para evitar. Lo dijo Andree mirando la app publicada: «no se diferencia
 * entre persona».
 *
 * Con un color por persona, el ojo recorre la columna y se detiene en la forma que
 * reconoce. Leer pasa a ser el segundo paso.
 *
 * DETERMINISTA Y NO ALEATORIO, que es lo que lo hace servir: la misma persona tiene que
 * salir del mismo color hoy, mañana, en Equipo y en Horas. Un color que cambia entre
 * pantallas es peor que no tener color, porque enseña una diferencia donde no la hay.
 *
 * LA SEMILLA ES EL IDENTIFICADOR, NO EL NOMBRE. Dos personas pueden llamarse igual y dos
 * apuntes del mismo nombre tienen que seguir siendo distinguibles; y si alguien se cambia
 * el nombre, su ancla no debería moverse.
 *
 * Y EL COLOR NO ES LA ÚNICA SEÑAL, nunca: dentro del círculo están sus iniciales y al lado
 * su nombre completo. Quien no distinga estos tonos lee exactamente lo mismo que antes.
 */

/** Cuántos tonos hay. Vive aquí para que el cálculo no dependa de la paleta. */
export const TONOS_DE_ANCLA = 5;

export function indiceDeAncla(semilla: string, total: number = TONOS_DE_ANCLA): number {
  if (total <= 0) return 0;

  /*
   * djb2, que es corto y reparte bien para cadenas de este tamaño. No hace falta nada
   * criptográfico: esto elige un color, no protege nada.
   *
   * `>>> 0` en cada vuelta mantiene el número en 32 bits sin signo. Sin eso, JavaScript
   * pasa a coma flotante al superar los 2^53 y el resultado deja de ser estable entre
   * motores: el mismo nombre podría dar colores distintos en iOS y en la web, que es
   * justo lo que esta función existe para impedir.
   */
  let hash = 5381;
  for (const caracter of semilla) {
    hash = ((hash * 33) ^ (caracter.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % total;
}
