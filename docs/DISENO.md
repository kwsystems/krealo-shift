# La dirección visual de Krealo Shift

Esto no es una guía de estilo genérica: es **la decisión** de cómo se ve esta app y por
qué, para que las pantallas que falten por hacer se deriven de aquí en vez de inventar
una dirección nueva cada vez. Nace el 2026-09-23, de una frase de Andree: «el diseño es
demasiado básico».

## El diagnóstico, medido y no opinado

Se capturó la app publicada en tres anchos y los dos temas —28 capturas— y esto es lo que
se veía:

1. **Una sola superficie.** Todo era una caja blanca con borde de 1 px y el mismo radio:
   el aviso de «no llegó a su turno», las fichas de conteo, la gráfica y las filas de
   gente pesaban lo mismo. El ojo no tenía por dónde entrar.
2. **Una sola cara de letra** (Inter) en cuatro pesos. Correcta y anónima.
3. **Color sin oficio.** Un morado que aparecía en dos sitios —el logotipo y una barra de
   progreso— y por lo demás solo la tríada de estado. O sea que el color únicamente decía
   «alerta», nunca «esto es lo importante».
4. **Cromo apilado.** En Horario, siete filas de controles antes del primer turno: la
   rejilla empezaba en y=700 de 900 px. La mitad de la pantalla era mando.
5. **Siete pestañas en 390 px**, con etiquetas de 9 px.

## La dirección: libro de registro, no tablero

El material de esta app es **el tiempo**, y el objeto de su mundo es **la tarjeta de
fichaje**: una columna de horas selladas que se leen en vertical. De ahí sale todo:
cifras que se alinean, ritmo horizontal de fila, y reglas finas que significan algo
—un límite de día, un corte de periodo— en lugar de rodear cada cosa con un perfil.

**La crítica que hubo que hacerle a esta dirección**, porque es la mitad que se salta:
«reglas finas + libro de registro» roza uno de los clichés del diseño generado por IA, el
pastiche de periódico con reglas de un píxel y radio cero. Así que se toma el camino
contrario a propósito: se mantienen radios y planos suaves, se usan **pocas** reglas, y
la identidad la carga el elemento firma, no el pastiche.

### El elemento firma: la franja del día

Una tira horizontal que enseña el día como bandas —turno programado, fichado de verdad,
pausa, ausencia— sobre una sola escala. El mismo objeto a tres tamaños: mini en la fila de
una persona, completa en Inicio, una por persona en Horas.

Existe porque hoy el tiempo se enseña **siempre como número**: «80:03 / 132:00» en una
barra sin escala, «Lleva 03:05», un «05:30» sin etiqueta debajo de un nombre. Un número se
lee; una forma se reconoce de un vistazo, que es lo que hace falta cuando miras el tablero
entre dos cosas.

## Tipografía

| Papel   | Cara                        | Dónde                                             |
| ------- | --------------------------- | ------------------------------------------------- |
| Display | **Archivo** (500/600/700)   | Títulos de pantalla, secciones, la hora del reloj |
| Texto   | **Inter** (400/500/600/700) | Todo lo demás: párrafos, etiquetas, ayudas        |
| Datos   | Inter con `tabular`         | Horas, totales, duraciones — el prop ya existía   |

**Por qué Archivo y no la de moda.** Bricolage Grotesque era la elección obvia del momento
y por eso mismo se descartó: sus formas juguetonas no dicen nada de una tienda. Archivo es
robusta y algo estrecha —voz de rótulo, de cartel de horario— y aguanta desde los 11 px de
una cabecera de columna hasta los 64 del reloj de la tienda.

**El texto corrido NO cambia.** Para leer una frase Inter es mejor, y cambiarla habría
tocado las 54 pantallas sin ganar nada.

## Superficies: cuatro planos, no uno

| Plano     | Papel                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `canvas`  | La página. Nada se apoya directamente en ella sin razón.                     |
| `surface` | El plano donde vive el contenido.                                            |
| `raised`  | Por encima: barras pegadas, la tarjeta de resultado del reloj, lo que flota. |
| `hundido` | **Dentro** de `surface`, para agrupar sin otro borde.                        |

`hundido` es el que mata las cajas dentro de cajas: un grupo dentro de una tarjeta se
separa con este plano y con espacio, **nunca con un segundo perfil**.

En el tema claro la elevación la da la sombra; en oscuro tiene que ser color, porque la
sombra no se ve.

## Color

La paleta **no se reinventa**: los nombres de token son papeles, no colores —`surface` no
significa blanco— y el tema oscuro está afinado contra medidas reales. Lo que cambia es la
disciplina de uso:

- El acento (`primary600`) es para **la acción primaria y el «ahora»**. En ningún otro
  sitio. Una pantalla tiene una acción primaria, no cuatro.
- La tríada de estado (verde trabajando / ámbar pausa / rojo tarde) **codifica estado**,
  así que nunca se usa como decoración, y siempre va con icono y etiqueta: nunca color a
  secas, porque quien no distingue el verde del rojo también tiene que poder usar esto.

## Lo que las siete tareas entregaron (2026-09-23 y 24)

| #   | Qué cambió                                                  | La medida                                                      |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Archivo para títulos y reloj; cuatro planos de superficie   | título 28 px en `Archivo_700Bold`, medido en el navegador      |
| 2   | Un plano se ve porque es un plano: fuera los marcos de 1 px | seis recuadros del mismo peso en Inicio → uno                  |
| 3   | Los mandos en una fila, no en una pila                      | Horario 89 % → 59 % de pantalla en mando; Equipo 66 % → 41 %   |
| 4   | **La franja del día**, el elemento firma                    | 13 pruebas de geometría; `inicio:check` vigila que se pinte    |
| 5   | La rejilla del horario deja de gritar                       | 2 → 4 empleados visibles; fuera la insignia que salía en todos |
| 6   | Horas y Equipo vuelven a ser tablas                         | 1 → 8 personas visibles en Equipo                              |
| 7   | El reloj entra en la comprobación de contraste              | 23 textos del reloj, × 2 temas × 2 anchos                      |

### Lo que NO se cambió, y por qué

- **Las siete pestañas del teléfono.** La premisa era que no caben. Medido a 390, 414 y
  360: las etiquetas son de 10 px —el mismo tamaño que usa iOS— y **ninguna está
  cortada**. Y el cajón «Más» ya se había quitado con un motivo escrito: no decía qué
  había dentro. Cambiarlo por una suposición habría desandado una mejora real.
- **La voz de los estados.** Se buscó copy que se disculpa —«lo sentimos», «ups», «algo
  salió mal»— y no hay ninguno: los nueve mensajes de error dicen qué falló y qué hacer.
- **La escala de cifras tabulares.** El prop `tabular` ya estaba puesto donde hacía falta.
  Lo que faltaba era la **etiqueta** del número, no su alineación.

### Siete veces me corrigió una medición

Queda escrito porque es el método, no una anécdota: la fuente que parecía no aplicarse y
era el rastro de la cabecera; el icono que mi selector confundió con un título; el
`minHeight` que me llevé por delante al reescribir un estilo; el hueco de 32 px que
razoné como táctil y no lo era; el `formatClockTime` con la zona y el formato cambiados
de sitio; la prueba que pasaba igual poniendo infinito; y el `minWidth` que cambié en la
tarjeta cuando quien manda es el envoltorio.

**Editar no es lo mismo que cambiar, y ver no es lo mismo que medir.**

## Lo que se verifica, y no se opina

- `tema:check` — los dos temas enteros, y que **Archivo esté cargada y en uso**. Este
  último control se escribió tras comprobar que una fuente que no llega no rompe nada:
  el navegador cae a la del sistema y el título se ve «parecido».
- `contraste:check` — 2966 textos medidos en 8 pantallas × 2 anchos × 2 temas.
- `responsive:check` — que nada se salga ni se recorte.

Las capturas de antes están en la tarea 1/7 del Publisher; el diagnóstico de arriba sale
de ellas.
